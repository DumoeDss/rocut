/**
 * CLI verb tests (S08 R group 3): `target reap` hygiene, `--project` routing
 * under ambiguity, the removed `--mode`, the usage snapshot, and
 * `target list`'s lastActive column — all through the real `runCli` entry.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createServer, type Server } from "node:http";
import { TargetRegistry, osBootTimeMs } from "../target-registry";
import { USAGE_LINES, runCli } from "../main";
import { startHost } from "../host";

const tempRoots: string[] = [];
async function tempRoot(prefix = "rocut-r08v-"): Promise<string> {
	const root = await mkdtemp(path.join(tmpdir(), prefix));
	tempRoots.push(root);
	return root;
}
const servers: Server[] = [];
afterAll(async () => {
	for (const server of servers) {
		await new Promise<void>((resolve) => {
			server.close(() => resolve());
			server.closeAllConnections();
		});
	}
	for (const root of tempRoots) {
		await rm(root, { recursive: true, force: true });
	}
});

/** Capture process.stdout.write for one runCli invocation. */
async function captureStdout(run: () => Promise<void>): Promise<string> {
	const original = process.stdout.write.bind(process.stdout);
	let out = "";
	process.stdout.write = ((chunk: string | Uint8Array) => {
		out += Buffer.from(chunk).toString();
		return true;
	}) as typeof process.stdout.write;
	try {
		await run();
	} finally {
		process.stdout.write = original;
	}
	return out;
}

/** A genuinely-exited child pid (post-fix, real ESRCH — no monkeypatch). */
async function deadPid(): Promise<number> {
	const child = spawn(process.execPath, ["-e", "process.exit(0)"], {
		stdio: "ignore",
	});
	const pid = child.pid as number;
	await new Promise<void>((resolve) => child.once("exit", () => resolve()));
	return pid;
}

async function writeEntry(
	targetsRoot: string,
	entry: Record<string, unknown>,
	token = "tok",
): Promise<void> {
	await mkdir(path.join(targetsRoot, "targets"), { recursive: true });
	const index = path.join(targetsRoot, "targets.json");
	const existing = await readFile(index, "utf8")
		.then((text) => JSON.parse(text) as unknown[])
		.catch(() => [] as unknown[]);
	await writeFile(index, JSON.stringify([...existing, entry]), "utf8");
	await writeFile(
		path.join(targetsRoot, "targets", `${String(entry.id)}.json`),
		JSON.stringify({ id: entry.id, port: entry.port, token }),
		"utf8",
	);
}

describe("target reap (task 3.3)", () => {
	test("dead pid, pre-boot, and squatter entries are removed; live and unverified survive", async () => {
		const targetsRoot = await tempRoot();
		const registry = new TargetRegistry(targetsRoot);
		const host = await startHost({
			projectRoot: await tempRoot("rocut-reap-live-"),
			registry,
		});
		// squatter: a foreign daemon positively answering on the entry's port
		const squatter = createServer((_request, response) => {
			response.writeHead(200, { "content-type": "application/json" });
			response.end(JSON.stringify({ id: "someone-else" }));
		});
		servers.push(squatter);
		const squatterPort = await new Promise<number>((resolve) => {
			squatter.listen(0, "127.0.0.1", () =>
				resolve((squatter.address() as { port: number }).port),
			);
		});
		// a refused port (bound then released) makes the probe inconclusive
		const held = createServer((_request, response) => response.end("{}"));
		servers.push(held);
		const refusedPort = await new Promise<number>((resolve) => {
			held.listen(0, "127.0.0.1", () =>
				resolve((held.address() as { port: number }).port),
			);
		});
		await new Promise<void>((resolve) => {
			held.close(() => resolve());
			held.closeAllConnections();
		});
		await writeEntry(targetsRoot, {
			id: "dead-pid",
			port: 1,
			pid: await deadPid(),
			projectPath: "/nowhere/dead-pid",
			startedAt: Date.now(),
		});
		await writeEntry(targetsRoot, {
			id: "pre-boot",
			port: 1,
			pid: process.pid, // alive unrelated process — but the entry predates boot
			projectPath: "/nowhere/pre-boot",
			startedAt: osBootTimeMs() - 60_000,
		});
		await writeEntry(targetsRoot, {
			id: "squatter",
			port: squatterPort,
			pid: process.pid,
			projectPath: "/nowhere/squatter",
			startedAt: Date.now(),
		});
		await writeEntry(targetsRoot, {
			id: "unverified",
			port: refusedPort,
			pid: process.pid,
			projectPath: "/nowhere/unverified",
			startedAt: Date.now(),
		});
		try {
			const out = await captureStdout(() =>
				runCli(["target", "reap", "--targets-root", targetsRoot]),
			);
			expect(out).toContain("dead-pid: dead (pid-gone) — removed");
			expect(out).toContain("pre-boot: dead (pre-boot) — removed");
			expect(out).toContain("squatter: dead (foreign-id) — removed");
			expect(out).toContain("unverified: unverified");
			expect(out).toContain(`pid ${process.pid} alive but identity inconclusive`);
			expect(out).toContain(`${host.targetId}: live`);
			const remaining = (await registry.list()).map((entry) => entry.id);
			expect(remaining.sort()).toEqual(
				[host.targetId, "unverified"].sort(),
			);
		} finally {
			await host.close();
		}
	});
	test("--dry-run reports the same verdicts but writes nothing", async () => {
		const targetsRoot = await tempRoot();
		await writeEntry(targetsRoot, {
			id: "dead-pid",
			port: 1,
			pid: await deadPid(),
			projectPath: "/nowhere/dead-pid",
			startedAt: Date.now(),
		});
		const before = await readFile(path.join(targetsRoot, "targets.json"), "utf8");
		const out = await captureStdout(() =>
			runCli(["target", "reap", "--targets-root", targetsRoot, "--dry-run"]),
		);
		expect(out).toContain("dead-pid: dead (pid-gone) — dry-run, kept");
		expect(await readFile(path.join(targetsRoot, "targets.json"), "utf8")).toBe(
			before,
		);
	});
	test("--project scopes the reap to one project's entries only", async () => {
		const targetsRoot = await tempRoot();
		const registry = new TargetRegistry(targetsRoot);
		const projectDir = await tempRoot("rocut-reap-scope-");
		await writeEntry(targetsRoot, {
			id: "scoped-dead",
			port: 1,
			pid: await deadPid(),
			projectPath: path.resolve(projectDir), // this project's own entry
			startedAt: Date.now(),
		});
		await writeEntry(targetsRoot, {
			id: "other-dead",
			port: 1,
			pid: await deadPid(),
			projectPath: "/nowhere/unrelated",
			startedAt: Date.now(),
		});
		const out = await captureStdout(() =>
			runCli([
				"target",
				"reap",
				"--project",
				projectDir,
				"--targets-root",
				targetsRoot,
			]),
		);
		expect(out).toContain("scoped-dead: dead (pid-gone) — removed");
		expect(out).not.toContain("other-dead");
		const remaining = (await registry.list()).map((entry) => entry.id);
		expect(remaining).toEqual(["other-dead"]); // only the scoped one went
	});
});

describe("--project routing under ambiguity (task 3.4)", () => {
	test("two live targets: bare auto fails listing both; --project routes each", async () => {
		const targetsRoot = await tempRoot();
		const registry = new TargetRegistry(targetsRoot);
		const projectA = await tempRoot("rocut-route-a-");
		const projectB = await tempRoot("rocut-route-b-");
		const hostA = await startHost({ projectRoot: projectA, registry });
		const hostB = await startHost({ projectRoot: projectB, registry });
		try {
			let message = "";
			await runCli(["read", "--targets-root", targetsRoot]).catch(
				(error: Error) => {
					message = error.message;
				},
			);
			expect(message).toContain("auto is ambiguous");
			expect(message).toContain(hostA.targetId);
			expect(message).toContain(hostB.targetId);
			expect(message).toContain("Pass --project <dir> or --target <id>");

			const readA = await captureStdout(() =>
				runCli(["read", "--project", projectA, "--targets-root", targetsRoot]),
			);
			expect(readA).toContain(`"target": "${hostA.targetId}"`);
			expect(readA).not.toContain(hostB.targetId);
			const readB = await captureStdout(() =>
				runCli(["read", "--project", projectB, "--targets-root", targetsRoot]),
			);
			expect(readB).toContain(`"target": "${hostB.targetId}"`);
			expect(readB).not.toContain(hostA.targetId);
		} finally {
			await hostA.close();
			await hostB.close();
		}
	});
});

describe("draft verbs (task 3.5)", () => {
	test("draft begin opens a manual-approval draft; --mode errors loudly and opens nothing", async () => {
		const targetsRoot = await tempRoot();
		const registry = new TargetRegistry(targetsRoot);
		const host = await startHost({
			projectRoot: await tempRoot("rocut-draft-p-"),
			registry,
		});
		// capture request bodies crossing the CLI's fetch
		const bodies: { url: string; body?: string }[] = [];
		const realFetch = globalThis.fetch;
		globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
			bodies.push({
				url: String(input),
				body: typeof init?.body === "string" ? init.body : undefined,
			});
			return realFetch(input as Parameters<typeof fetch>[0], init);
		}) as typeof fetch;
		try {
			const out = await captureStdout(() =>
				runCli(["draft", "begin", "--targets-root", targetsRoot]),
			);
			const draftId = out.trim().split("\n").pop() ?? "";
			expect(draftId.length).toBeGreaterThan(0); // a draft id was printed
			const posted = bodies.find((call) => call.url.endsWith("/api/drafts"));
			expect(posted).toBeDefined();
			expect(JSON.parse(posted?.body ?? "{}")).toEqual({
				approvalMode: "manual", // the CLI's fixed mode — never caller-set
			});

			bodies.length = 0;
			let message = "";
			await runCli([
				"draft",
				"begin",
				"--mode",
				"auto",
				"--targets-root",
				targetsRoot,
			]).catch((error: Error) => {
				message = error.message;
			});
			expect(message).toBe(
				"--mode has been removed from the CLI; approval mode is set by the editor surface",
			);
			expect(bodies).toEqual([]); // nothing was opened
		} finally {
			globalThis.fetch = realFetch;
			await host.close();
		}
	});
});

describe("usage and listing surfaces (task 3.6)", () => {
	test("the usage block documents ensure, reap, --project — and no --mode anywhere", () => {
		const usage = USAGE_LINES.join("\n");
		expect(usage).toContain("host ensure <project-dir>");
		expect(usage).toContain("target reap [--project <dir>] [--dry-run]");
		expect(usage).toContain("[--project <dir>]");
		expect(usage).not.toContain("--mode");
	});
	test("target list shows lastActive only for entries that have one", async () => {
		const targetsRoot = await tempRoot();
		await writeEntry(targetsRoot, {
			id: "with-activity",
			port: 1,
			pid: 1,
			projectPath: "/nowhere/a",
			startedAt: 1_000,
			lastActivityAt: 9_999,
		});
		await writeEntry(targetsRoot, {
			id: "without-activity",
			port: 2,
			pid: 2,
			projectPath: "/nowhere/b",
			startedAt: 2_000,
		});
		const out = await captureStdout(() =>
			runCli(["target", "list", "--targets-root", targetsRoot]),
		);
		expect(out).toContain("with-activity");
		expect(out).toContain("lastActive=9999");
		expect(out).toContain("without-activity");
		expect(out).not.toContain("lastActive=undefined");
		const withoutLine = out
			.split("\n")
			.find((line) => line.startsWith("without-activity"));
		expect(withoutLine).toBeDefined();
		expect(withoutLine?.includes("lastActive")).toBe(false);
	});
});
