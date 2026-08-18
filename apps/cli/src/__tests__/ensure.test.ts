/**
 * `host ensure` tests (S08 R group 3): in-process reuse, the fail-closed
 * unverified path, the bounded-wait timeout, and the real detached spawn
 * round-trip with tree-kill cleanup.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createServer, type Server } from "node:http";
import { TargetRegistry, pidAlive } from "../target-registry";
import { ensureHost } from "../ensure";
import { startHost } from "../host";

const tempRoots: string[] = [];
async function tempRoot(prefix = "rocut-r08e-"): Promise<string> {
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

/** Tree-kill a daemon and assert the kill succeeded (win32 taskkill order matters). */
function treeKill(pid: number): void {
	if (process.platform === "win32") {
		const result = spawnSync("taskkill", ["/pid", String(pid), "/t", "/f"], {
			encoding: "utf8",
		});
		if (result.status !== 0) {
			throw new Error(
				`taskkill /pid ${pid} failed (${result.status}): ${result.stdout} ${result.stderr}`,
			);
		}
		return;
	}
	try {
		process.kill(-pid, "SIGKILL"); // detached ⇒ its own process group
	} catch {
		// already gone — the test asserts liveness separately before this
	}
}

describe("host ensure (tasks 3.1, 3.2)", () => {
	test("reuse: a live daemon for the project path is returned, nothing is created", async () => {
		const targetsRoot = await tempRoot();
		const registry = new TargetRegistry(targetsRoot);
		const projectRoot = await tempRoot("rocut-ens-reuse-");
		const host = await startHost({ projectRoot, registry });
		try {
			const before = await registry.list();
			const ensured = await ensureHost({ projectRoot, registry });
			expect(ensured.state).toBe("reused");
			expect(ensured.targetId).toBe(host.targetId);
			expect(ensured.editorUrl).toBe(host.editorUrl); // reconstructed from the secret
			expect(ensured.pid).toBe(before[0].pid);
			const after = await registry.list();
			expect(after.length).toBe(1); // no second entry
		} finally {
			await host.close();
		}
	});
	test("fail closed: an unverified entry for the project blocks, naming the pid and remediation", async () => {
		const targetsRoot = await tempRoot();
		const registry = new TargetRegistry(targetsRoot);
		const projectRoot = await tempRoot("rocut-ens-unv-");
		// an entry whose pid is alive but whose port answers nothing
		const held = createServer((_request, response) => {
			response.writeHead(200).end("{}");
		});
		servers.push(held);
		const heldPort = await new Promise<number>((resolve) => {
			held.listen(0, "127.0.0.1", () =>
				resolve((held.address() as { port: number }).port),
			);
		});
		await new Promise<void>((resolve) => {
			held.close(() => resolve());
			held.closeAllConnections();
		});
		await mkdir(path.join(targetsRoot, "targets"), { recursive: true });
		const entry = {
			id: "unverified-one",
			port: heldPort,
			pid: process.pid, // alive
			projectPath: path.resolve(projectRoot),
			startedAt: Date.now(),
		};
		await writeFile(
			path.join(targetsRoot, "targets.json"),
			JSON.stringify([entry]),
			"utf8",
		);
		await writeFile(
			path.join(targetsRoot, "targets", `${entry.id}.json`),
			JSON.stringify({ id: entry.id, port: heldPort, token: "tok-unv" }),
			"utf8",
		);
		let message = "";
		await ensureHost({ projectRoot, registry }).catch((error: Error) => {
			message = error.message;
		});
		expect(message).toContain("unverified");
		expect(message).toContain(`pid ${process.pid}`);
		expect(message).toContain("reap");
		// and nothing was reaped or started
		const entries = await registry.list();
		expect(entries.length).toBe(1);
	});
	test("timeout: a fast-dying child surfaces the bounded-wait failure without hanging", async () => {
		const targetsRoot = await tempRoot();
		const registry = new TargetRegistry(targetsRoot);
		const projectRoot = await tempRoot("rocut-ens-tmo-");
		let message = "";
		await ensureHost({
			projectRoot,
			registry,
			execPath: process.execPath,
			scriptPath: path.join(targetsRoot, "definitely-not-here.ts"),
			timeoutMs: 1_200,
		}).catch((error: Error) => {
			message = error.message;
		});
		expect(message).toContain("timed out after 1200 ms");
		expect(message).toMatch(/child pid \d+/);
		expect(message).toContain("exited"); // the daemon's exit info, when available
		// F3: no log was captured → the error says so and names the remedy
		expect(message).toContain("no daemon log was captured");
		expect(message).toContain("--log <file>");
		expect(await registry.list()).toEqual([]); // no entry appeared
	});
	test("timeout with --log: the error names the log file — a pointer, never content (F3)", async () => {
		const targetsRoot = await tempRoot();
		const registry = new TargetRegistry(targetsRoot);
		const projectRoot = await tempRoot("rocut-ens-tlog-");
		const logFile = path.join(targetsRoot, "missing-daemon.log");
		let message = "";
		await ensureHost({
			projectRoot,
			registry,
			execPath: process.execPath,
			scriptPath: path.join(targetsRoot, "definitely-not-here.ts"),
			logFile,
			timeoutMs: 1_200,
		}).catch((error: Error) => {
			message = error.message;
		});
		expect(message).toContain("timed out after 1200 ms");
		expect(message).toContain(`daemon log: ${logFile}`);
	});
	test("real spawn: detached daemon survives, second ensure reuses, one entry, tree-killed", async () => {
		const targetsRoot = await tempRoot();
		const registry = new TargetRegistry(targetsRoot);
		const parent = await tempRoot("rocut-ens-real-");
		const projectRoot = path.join(parent, "realproj");
		await mkdir(projectRoot, { recursive: true });
		const scriptPath = path.resolve(import.meta.dir, "..", "main.ts");
		const first = await ensureHost({
			projectRoot,
			registry,
			execPath: process.execPath,
			scriptPath,
			timeoutMs: 30_000,
		});
		expect(first.state).toBe("started");
		// the daemon-must-survive-the-caller property: ensure has returned,
		// unref'd the child, and the pid is still alive
		expect(pidAlive(first.pid)).toBe(true);

		const second = await ensureHost({
			projectRoot,
			registry,
			execPath: process.execPath,
			scriptPath,
			timeoutMs: 30_000,
		});
		expect(second.state).toBe("reused");
		expect(second.targetId).toBe(first.targetId);
		expect(second.editorUrl).toBe(first.editorUrl);
		expect(second.pid).toBe(first.pid);
		const entries = await registry.list();
		expect(entries.length).toBe(1); // exactly one entry exists
		expect(entries[0].id).toBe(first.targetId);

		// the registry file the new daemon wrote passes the numeric contract
		const raw = JSON.parse(
			await readFile(path.join(targetsRoot, "targets.json"), "utf8"),
		) as { startedAt: unknown }[];
		expect(typeof raw[0].startedAt).toBe("number");

		treeKill(first.pid);
		// a killed pid lingers in a terminating state briefly on win32 — poll
		let dead = false;
		for (let attempt = 0; attempt < 40 && !dead; attempt += 1) {
			await new Promise((resolve) => setTimeout(resolve, 250));
			dead = !pidAlive(first.pid);
		}
		expect(dead).toBe(true);
	}, 60_000);
	test("log file: --log is truncated on open and receives the child's output", async () => {
		const targetsRoot = await tempRoot();
		const registry = new TargetRegistry(targetsRoot);
		const parent = await tempRoot("rocut-ens-log-");
		const projectRoot = path.join(parent, "logproj");
		await mkdir(projectRoot, { recursive: true });
		const logFile = path.join(parent, "daemon.log");
		await writeFile(logFile, "stale token-bearing content from an older run\n", "utf8");
		const scriptPath = path.resolve(import.meta.dir, "..", "main.ts");
		const ensured = await ensureHost({
			projectRoot,
			registry,
			execPath: process.execPath,
			scriptPath,
			logFile,
			timeoutMs: 30_000,
		});
		try {
			// the daemon's three lines land slightly after the registry entry
			// ensure resolves on — poll for the log content
			let log = "";
			for (let attempt = 0; attempt < 40 && !log.includes(ensured.targetId); attempt += 1) {
				await new Promise((resolve) => setTimeout(resolve, 250));
				log = await readFile(logFile, "utf8");
			}
			expect(log).not.toContain("stale token-bearing content");
			// host start prints its three lines into the log
			expect(log).toContain(`target ${ensured.targetId}`);
		} finally {
			treeKill(ensured.pid);
		}
	}, 60_000);
});
