/**
 * Registry core tests (S08 R group 1): the numeric startedAt contract with
 * the landed elftia supervisor's validating reader, the EPERM-safe liveness
 * predicates, probeIdentity against stub servers, the two-predicate
 * classification per leg, project-identity resolution, the narrowed `auto`,
 * in-place patchEntry, and the target-id collision digest.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { spawn } from "node:child_process";
import { createServer, type Server } from "node:http";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { existsSync } from "node:fs";
import { TargetRegistry } from "../target-registry";
import {
	AmbiguousTargetsError,
	classifyEntry,
	normalizeProjectKey,
	osBootTimeMs,
	pidAlive,
	probeIdentity,
	projectIdDigest,
	PROBE_TIMEOUT_FAST_MS,
	PROBE_TIMEOUT_SLOW_MS,
} from "../target-registry";
import { startHost } from "../host";

const tempRoots: string[] = [];
async function tempRoot(prefix = "rocut-r08-"): Promise<string> {
	const root = await mkdtemp(path.join(tmpdir(), prefix));
	tempRoots.push(root);
	return root;
}
const servers: Server[] = [];
async function stubServer(
	handler: (
		request: import("node:http").IncomingMessage,
		response: import("node:http").ServerResponse,
	) => void,
): Promise<{ port: number; close: () => Promise<void> }> {
	const server = createServer(handler);
	servers.push(server);
	const port = await new Promise<number>((resolve) => {
		server.listen(0, "127.0.0.1", () => {
			resolve((server.address() as { port: number }).port);
		});
	});
	return {
		port,
		close: () =>
			new Promise<void>((resolve) => {
				server.close(() => resolve());
				server.closeAllConnections();
			}),
	};
}

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

/** The landed elftia reader's validating filter (toolHostRegistryFile.ts). */
function elftiaIsToolHostTarget(value: unknown): boolean {
	if (typeof value !== "object" || value === null) return false;
	const record = value as Record<string, unknown>;
	return (
		typeof record.id === "string" &&
		typeof record.port === "number" &&
		typeof record.pid === "number" &&
		typeof record.projectPath === "string" &&
		typeof record.startedAt === "number"
	);
}

/** Monkeypatch process.kill for one classification (pid leg fakes). */
async function withKillFake<T>(
	fake: (pid: number, signal?: number | string) => void,
	run: () => Promise<T>,
): Promise<T> {
	const original = process.kill;
	(process as { kill: unknown }).kill = fake;
	try {
		return await run();
	} finally {
		(process as { kill: unknown }).kill = original;
	}
}

const esrch = (): never => {
	throw Object.assign(new Error("no such process"), { code: "ESRCH" });
};
const eperm = (): never => {
	throw Object.assign(new Error("operation not permitted"), {
		code: "EPERM",
	});
};

describe("pidAlive (task 1.2)", () => {
	test("EPERM counts as alive — a process exists, we may not signal it", async () => {
		const verdict = await withKillFake(() => eperm(), async () =>
			pidAlive(4242),
		);
		expect(verdict).toBe(true);
	});
	test("ESRCH is the only dead verdict", async () => {
		const verdict = await withKillFake(() => esrch(), async () =>
			pidAlive(4242),
		);
		expect(verdict).toBe(false);
	});
	test("the caller's own pid is alive (real probe)", () => {
		expect(pidAlive(process.pid)).toBe(true);
	});
	test("a really-exited child is dead without any monkeypatch (real ESRCH)", async () => {
		// regression: bun ≤1.2.2 on Windows reports code "" from kill(pid, 0),
		// so a code-only check read every dead pid as alive — reap went inert.
		const child = spawn(process.execPath, ["-e", "process.exit(0)"], {
			stdio: "ignore",
		});
		const childPid = child.pid as number;
		await new Promise<void>((resolve) => child.once("exit", () => resolve()));
		expect(pidAlive(childPid)).toBe(false);
	});
	test("win32: an unsignalable system process counts as alive (real EPERM)", () => {
		if (process.platform !== "win32") return; // pid 4 is System, Windows-only
		expect(pidAlive(4)).toBe(true);
	});
});

describe("probeIdentity (task 1.3)", () => {
	test("echoes the id for a correct bearer; wrong id and garbage are distinguishable", async () => {
		const stub = await stubServer((request, response) => {
			if (request.headers.authorization !== "Bearer tok-1") {
				response.writeHead(401).end("{}");
				return;
			}
			response.writeHead(200, { "content-type": "application/json" });
			response.end(JSON.stringify({ id: "stub-id" }));
		});
		try {
			expect(await probeIdentity(stub.port, "tok-1")).toBe("stub-id");
			// wrong bearer → non-2xx → null
			expect(await probeIdentity(stub.port, "wrong")).toBe(null);
		} finally {
			await stub.close();
		}
	});
	test("a different id answering is a positive foreign answer, not null", async () => {
		const stub = await stubServer((_request, response) => {
			response.writeHead(200, { "content-type": "application/json" });
			response.end(JSON.stringify({ id: "someone-else" }));
		});
		try {
			expect(await probeIdentity(stub.port, "tok-1")).toBe("someone-else");
		} finally {
			await stub.close();
		}
	});
	test("a garbage body resolves null", async () => {
		const stub = await stubServer((_request, response) => {
			response.writeHead(200, { "content-type": "application/json" });
			response.end("<html>not json");
		});
		try {
			expect(await probeIdentity(stub.port, "tok-1")).toBe(null);
		} finally {
			await stub.close();
		}
	});
	test("a refused port resolves null on both timeout variants", async () => {
		// Bind then close: the port is free and loopback connects refuse.
		const held = await stubServer((_request, response) => {
			response.writeHead(200).end("{}");
		});
		const deadPort = held.port;
		await held.close();
		expect(await probeIdentity(deadPort, "tok-1")).toBe(null);
		expect(
			await probeIdentity(deadPort, "tok-1", PROBE_TIMEOUT_SLOW_MS),
		).toBe(null);
	});
	test("the fast timeout bounds a slow responder", async () => {
		const stub = await stubServer((_request, response) => {
			setTimeout(() => {
				try {
					response.writeHead(200, { "content-type": "application/json" });
					response.end(JSON.stringify({ id: "slow-id" }));
				} catch {
					// the probing client already tore the socket down — fine
				}
			}, PROBE_TIMEOUT_FAST_MS + 600);
		});
		try {
			expect(
				await probeIdentity(stub.port, "tok-1", PROBE_TIMEOUT_FAST_MS),
			).toBe(null);
		} finally {
			await stub.close();
		}
	});
});

describe("registry serialization (tasks 1.1, 5.3)", () => {
	test("registered entries pass the elftia-shaped validating reader (numeric startedAt)", async () => {
		const targetsRoot = await tempRoot();
		const projectRoot = await tempRoot();
		const registry = new TargetRegistry(targetsRoot);
		const host = await startHost({ projectRoot, registry });
		try {
			const raw = JSON.parse(
				await readFile(path.join(targetsRoot, "targets.json"), "utf8"),
			) as unknown[];
			expect(raw.length).toBe(1);
			expect(elftiaIsToolHostTarget(raw[0])).toBe(true);
			const entry = raw[0] as { startedAt: unknown };
			expect(typeof entry.startedAt).toBe("number");
			// the three-legged predicate, elftia shape: boot + pid + bearer {id}
			const parsed = await registry.list();
			expect(parsed[0].startedAt).toBeGreaterThanOrEqual(
				osBootTimeMs() - 60_000,
			);
			expect(pidAlive(parsed[0].pid)).toBe(true);
			expect(await probeIdentity(parsed[0].port, host.token)).toBe(
				parsed[0].id,
			);
		} finally {
			await host.close();
		}
	});
	test("a legacy ISO-string startedAt reads tolerantly: unroutable, reap-eligible once the pid is gone", async () => {
		const targetsRoot = await tempRoot();
		const registry = new TargetRegistry(targetsRoot);
		await mkdir(path.join(targetsRoot, "targets"), { recursive: true });
		await writeFile(
			path.join(targetsRoot, "targets.json"),
			JSON.stringify([
				{
					id: "legacy",
					port: 1,
					pid: process.pid,
					projectPath: "/nowhere/legacy",
					startedAt: "2026-08-01T00:00:00.000Z",
				},
			]),
			"utf8",
		);
		const readStartedAt = Date.now();
		const entries = await registry.list();
		expect(entries.length).toBe(1);
		expect(entries[0].legacyStartedAt).toBe("2026-08-01T00:00:00.000Z");
		// the conversion moment, not a pre-boot sentinel (F1): a 0 stamp would
		// persist as numeric 0 through any index rewrite
		expect(entries[0].startedAt).toBeGreaterThanOrEqual(readStartedAt);
		// live pid (our own) → unverified: fail closed, never routed, never reaped
		expect(
			(await classifyEntry(entries[0], null)).verdict,
		).toBe("unverified");
		expect(await registry.resolve("auto")).toBe(null);
		// pid gone → dead, reap-eligible
		await withKillFake((pid) => {
			if (pid === process.pid) esrch();
		}, async () => {
			expect((await classifyEntry(entries[0], null)).verdict).toBe("dead");
		});
		// and the raw on-disk shape is exactly what elftia filters out
		const raw = JSON.parse(
			await readFile(path.join(targetsRoot, "targets.json"), "utf8"),
		) as unknown[];
		expect(elftiaIsToolHostTarget(raw[0])).toBe(false);
	});
	test("legacy write-back does not manufacture death: a running pre-contract daemon survives an index rewrite (F1)", async () => {
		const targetsRoot = await tempRoot();
		const registry = new TargetRegistry(targetsRoot);
		await mkdir(path.join(targetsRoot, "targets"), { recursive: true });
		await writeFile(
			path.join(targetsRoot, "targets.json"),
			JSON.stringify([
				{
					id: "legacy-live",
					port: 1,
					pid: process.pid, // the pre-contract daemon, still running
					projectPath: "/nowhere/legacy-live",
					startedAt: "2026-08-01T00:00:00.000Z",
				},
			]),
			"utf8",
		);
		// an unrelated register rewrites the whole index — the realistic
		// conversion vector (any register/remove/patchEntry would do)
		await registry.register({
			entry: {
				id: "newcomer",
				port: 2,
				pid: 4242,
				projectPath: "/nowhere/newcomer",
				startedAt: Date.now(),
			},
			secret: { id: "newcomer", port: 2, token: "t-new" },
		});
		// re-read from disk: the still-running pre-contract daemon must be
		// unverified (fail closed), never pre-boot-dead
		const reread = await registry.list();
		expect(reread.length).toBe(2);
		const converted = reread.find((entry) => entry.id === "legacy-live");
		if (converted === undefined) {
			throw new Error("legacy entry lost in the rewrite");
		}
		expect(converted.startedAt).toBeGreaterThanOrEqual(osBootTimeMs());
		expect((await classifyEntry(converted, null)).verdict).toBe("unverified");
		// the written-back form is numeric (the elftia reader's shape) and
		// keeps the original ISO for display
		const raw = JSON.parse(
			await readFile(path.join(targetsRoot, "targets.json"), "utf8"),
		) as { id: string; startedAt: unknown; legacyStartedAt?: unknown }[];
		const rawConverted = raw.find((entry) => entry.id === "legacy-live");
		if (rawConverted === undefined) {
			throw new Error("legacy row missing on disk");
		}
		expect(typeof rawConverted.startedAt).toBe("number");
		expect(rawConverted.legacyStartedAt).toBe("2026-08-01T00:00:00.000Z");
	});
});

describe("classifyEntry legs (task 1.4)", () => {
	test("pre-boot startedAt with a live unrelated pid is dead (PID reuse across reboot)", async () => {
		const entry = {
			id: "reuse",
			port: 1,
			pid: process.pid, // alive — some unrelated process holds the number
			projectPath: "/nowhere/reuse",
			startedAt: osBootTimeMs() - 60_000,
		};
		const classification = await classifyEntry(entry, null);
		expect(classification.verdict).toBe("dead");
		expect(classification.reason).toBe("pre-boot");
	});
	test("a foreign id answering on the port is a squatter: dead", async () => {
		const stub = await stubServer((_request, response) => {
			response.writeHead(200, { "content-type": "application/json" });
			response.end(JSON.stringify({ id: "someone-else" }));
		});
		try {
			const classification = await classifyEntry(
				{
					id: "mine",
					port: stub.port,
					pid: process.pid,
					projectPath: "/nowhere/mine",
					startedAt: Date.now(),
				},
				{ id: "mine", port: stub.port, token: "tok-1" },
			);
			expect(classification.verdict).toBe("dead");
			expect(classification.reason).toBe("foreign-id");
		} finally {
			await stub.close();
		}
	});
	test("a live pid whose probe is inconclusive is unverified — never routed, never reaped", async () => {
		const held = await stubServer((_request, response) => {
			response.writeHead(200).end("{}");
		});
		const deadPort = held.port;
		await held.close();
		const classification = await classifyEntry(
			{
				id: "refused",
				port: deadPort,
				pid: process.pid,
				projectPath: "/nowhere/refused",
				startedAt: Date.now(),
			},
			{ id: "refused", port: deadPort, token: "tok-1" },
		);
		expect(classification.verdict).toBe("unverified");
	});
	test("a live host with its own secret classifies live on all three legs", async () => {
		const targetsRoot = await tempRoot();
		const projectRoot = await tempRoot();
		const registry = new TargetRegistry(targetsRoot);
		const host = await startHost({ projectRoot, registry });
		try {
			const entries = await registry.list();
			const secret = await registry.readSecret(entries[0].id);
			expect(
				(await classifyEntry(entries[0], secret, {
					timeoutMs: PROBE_TIMEOUT_SLOW_MS,
				})).verdict,
			).toBe("live");
		} finally {
			await host.close();
		}
	});
});

describe("resolveForProject (task 1.5)", () => {
	test("the right one of two live hosts wins regardless of index order", async () => {
		const targetsRoot = await tempRoot();
		const registry = new TargetRegistry(targetsRoot);
		const projectA = await tempRoot("rocut-proja-");
		const projectB = await tempRoot("rocut-projb-");
		const hostB = await startHost({ projectRoot: projectB, registry });
		const hostA = await startHost({ projectRoot: projectA, registry });
		try {
			// B registered first (index head); A must still win for its path.
			const resolved = await registry.resolveForProject(projectA);
			expect(resolved?.entry.id).toBe(hostA.targetId);
			expect(resolved?.secret.token).toBe(hostA.token);
			const resolvedB = await registry.resolveForProject(projectB);
			expect(resolvedB?.entry.id).toBe(hostB.targetId);
		} finally {
			await hostA.close();
			await hostB.close();
		}
	});
	test("win32-style case differences do not defeat the match on win32", async () => {
		const targetsRoot = await tempRoot();
		const registry = new TargetRegistry(targetsRoot);
		const project = await tempRoot("rocut-case-");
		const host = await startHost({ projectRoot: project, registry });
		try {
			const name = path.basename(project);
			const flippedName =
				name.slice(0, 1).toUpperCase() === name.slice(0, 1)
					? name.replace(/r/, "R")
					: name.replace(/R/, "r");
			const flipped = path.join(path.dirname(project), flippedName);
			if (process.platform === "win32") {
				const resolved = await registry.resolveForProject(flipped);
				expect(resolved?.entry.id).toBe(host.targetId);
			} else {
				// verbatim elsewhere — the flipped spelling must not match
				expect(await registry.resolveForProject(flipped)).toBe(null);
			}
		} finally {
			await host.close();
		}
	});
	test("a dead entry for the path resolves to nothing", async () => {
		const targetsRoot = await tempRoot();
		const registry = new TargetRegistry(targetsRoot);
		await mkdir(path.join(targetsRoot, "targets"), { recursive: true });
		const projectPath = path.join(await tempRoot("rocut-dead-"), "");
		await writeFile(
			path.join(targetsRoot, "targets.json"),
			JSON.stringify([
				{
					id: "deadpath",
					port: 1,
					pid: process.pid,
					projectPath,
					startedAt: Date.now(),
				},
			]),
			"utf8",
		);
		await withKillFake((pid) => {
			if (pid === process.pid) esrch();
		}, async () => {
			expect(await registry.resolveForProject(projectPath)).toBe(null);
		});
	});
});

describe("auto narrowing (task 1.6)", () => {
	test("exactly one live target resolves", async () => {
		const targetsRoot = await tempRoot();
		const registry = new TargetRegistry(targetsRoot);
		const host = await startHost({
			projectRoot: await tempRoot("rocut-solo-"),
			registry,
		});
		try {
			const resolved = await registry.resolve("auto");
			expect(resolved?.entry.id).toBe(host.targetId);
		} finally {
			await host.close();
		}
	});
	test("two live targets throw the ambiguity error listing both — never a silent pick", async () => {
		const targetsRoot = await tempRoot();
		const registry = new TargetRegistry(targetsRoot);
		const hostA = await startHost({
			projectRoot: await tempRoot("rocut-two-a-"),
			registry,
		});
		const hostB = await startHost({
			projectRoot: await tempRoot("rocut-two-b-"),
			registry,
		});
		try {
			let caught: unknown;
			try {
				await registry.resolve("auto");
			} catch (error) {
				caught = error;
			}
			expect(caught).toBeInstanceOf(AmbiguousTargetsError);
			const error = caught as AmbiguousTargetsError;
			expect(error.candidates.length).toBe(2);
			expect(error.candidates.map((candidate) => candidate.id).sort()).toEqual(
				[hostA.targetId, hostB.targetId].sort(),
			);
			for (const candidate of error.candidates) {
				expect(error.message).toContain(candidate.projectPath);
			}
		} finally {
			await hostA.close();
			await hostB.close();
		}
	});
	test("zero live targets resolves null", async () => {
		const registry = new TargetRegistry(await tempRoot());
		expect(await registry.resolve("auto")).toBe(null);
	});
});

describe("patchEntry (task 1.7)", () => {
	test("patches in place: same position, other fields untouched, no reorder", async () => {
		const targetsRoot = await tempRoot();
		const registry = new TargetRegistry(targetsRoot);
		const first = {
			entry: {
				id: "first",
				port: 11,
				pid: 111,
				projectPath: "/nowhere/first",
				startedAt: 1_000,
			},
			secret: { id: "first", port: 11, token: "t1" },
		};
		const second = {
			entry: {
				id: "second",
				port: 22,
				pid: 222,
				projectPath: "/nowhere/second",
				startedAt: 2_000,
			},
			secret: { id: "second", port: 22, token: "t2" },
		};
		await registry.register(first);
		await registry.register(second); // register PREPENDS: [second, first]
		const patched = await registry.patchEntry("first", {
			lastActivityAt: 3_000,
		});
		expect(patched).toBe(true);
		const entries = await registry.list();
		expect(entries.map((entry) => entry.id)).toEqual(["second", "first"]);
		expect(entries[1]).toEqual({
			id: "first",
			port: 11,
			pid: 111,
			projectPath: "/nowhere/first",
			startedAt: 1_000,
			lastActivityAt: 3_000,
		});
		// no leftover temp files from the atomic write
		const files = await (
			await import("node:fs/promises")
		).readdir(targetsRoot);
		expect(files.filter((name) => name.endsWith(".tmp"))).toEqual([]);
	});
	test("patching an unknown id returns false and writes nothing", async () => {
		const targetsRoot = await tempRoot();
		const registry = new TargetRegistry(targetsRoot);
		await registry.register({
			entry: {
				id: "only",
				port: 1,
				pid: 1,
				projectPath: "/nowhere/only",
				startedAt: 1,
			},
			secret: { id: "only", port: 1, token: "t" },
		});
		const before = await readFile(
			path.join(targetsRoot, "targets.json"),
			"utf8",
		);
		expect(await registry.patchEntry("ghost", { lastActivityAt: 9 })).toBe(
			false,
		);
		expect(
			await readFile(path.join(targetsRoot, "targets.json"), "utf8"),
		).toBe(before);
	});
});

describe("target-id collision rule (task 1.8)", () => {
	test("a different live project claiming the basename forces the digest suffix; the incumbent is untouched", async () => {
		const targetsRoot = await tempRoot();
		const registry = new TargetRegistry(targetsRoot);
		// two DIFFERENT directories sharing the same basename — the collision
		const parentA = await tempRoot("rocut-coll-a-");
		const parentB = await tempRoot("rocut-coll-b-");
		const projectA = path.join(parentA, "demo");
		const projectB = path.join(parentB, "demo");
		await mkdir(projectA, { recursive: true });
		await mkdir(projectB, { recursive: true });
		const hostA = await startHost({ projectRoot: projectA, registry });
		const hostB = await startHost({ projectRoot: projectB, registry });
		try {
			expect(hostA.targetId).toBe("demo");
			const expectedSuffix = projectIdDigest(normalizeProjectKey(projectB));
			expect(hostB.targetId).toBe(`demo-${expectedSuffix}`);
			// deterministic: the same derivation rule, recomputed, matches
			expect(projectIdDigest(normalizeProjectKey(projectB))).toBe(
				expectedSuffix,
			);
			// the incumbent's entry and secret are intact
			const entries = await registry.list();
			expect(entries.map((entry) => entry.id).sort()).toEqual(
				["demo", `demo-${expectedSuffix}`].sort(),
			);
			const secretA = await registry.readSecret("demo");
			expect(secretA?.token).toBe(hostA.token);
		} finally {
			await hostA.close();
			await hostB.close();
		}
	});
	test("a dead same-id entry does not block reuse of the unsuffixed id", async () => {
		const targetsRoot = await tempRoot();
		const registry = new TargetRegistry(targetsRoot);
		await mkdir(path.join(targetsRoot, "targets"), { recursive: true });
		await writeFile(
			path.join(targetsRoot, "targets.json"),
			JSON.stringify([
				{
					id: "demo", // the new project's basename id, held by a dead entry
					port: 1,
					pid: process.pid,
					projectPath: "/nowhere/different-project",
					startedAt: Date.now(),
				},
			]),
			"utf8",
		);
		const parent = await tempRoot("rocut-coll-dead-");
		const project = path.join(parent, "demo");
		await mkdir(project, { recursive: true });
		const host = await withKillFake((pid) => {
			if (pid === process.pid) esrch();
		}, async () => startHost({ projectRoot: project, registry }));
		try {
			// the stale entry's pid is dead in this fake → not live → no suffix
			expect(host.targetId).toBe("demo");
			const entries = await registry.list();
			expect(entries.length).toBe(1); // register replaced the dead same-id row
			expect(entries[0].projectPath).toBe(path.resolve(project));
		} finally {
			await host.close();
		}
	});
	test("an unverified same-basename incumbent occupies the id: the newcomer suffixes and the incumbent survives (F2)", async () => {
		const targetsRoot = await tempRoot();
		const registry = new TargetRegistry(targetsRoot);
		// a refused port (bound then released) leaves the probe inconclusive —
		// the incumbent is live-but-slow, not dead
		const held = await stubServer((_request, response) => {
			response.writeHead(200).end("{}");
		});
		const stalledPort = held.port;
		await held.close();
		await mkdir(path.join(targetsRoot, "targets"), { recursive: true });
		await writeFile(
			path.join(targetsRoot, "targets.json"),
			JSON.stringify([
				{
					id: "demo", // held by a DIFFERENT project, unverified
					port: stalledPort,
					pid: process.pid, // alive — a busy incumbent, not a dead one
					projectPath: "/nowhere/incumbent-project",
					startedAt: Date.now(),
				},
			]),
			"utf8",
		);
		await writeFile(
			path.join(targetsRoot, "targets", "demo.json"),
			JSON.stringify({ id: "demo", port: stalledPort, token: "tok-incumbent" }),
			"utf8",
		);
		const parent = await tempRoot("rocut-coll-unv-");
		const project = path.join(parent, "demo");
		await mkdir(project, { recursive: true });
		const host = await startHost({ projectRoot: project, registry });
		try {
			// the newcomer gets the digest-suffixed id, never the bare basename
			expect(host.targetId).toBe(
				`demo-${projectIdDigest(normalizeProjectKey(project))}`,
			);
			// the incumbent's row and secret are untouched — no silent replace
			const incumbent = (await registry.list()).find(
				(entry) => entry.id === "demo",
			);
			expect(incumbent?.projectPath).toBe("/nowhere/incumbent-project");
			expect(await registry.readSecret("demo")).toEqual({
				id: "demo",
				port: stalledPort,
				token: "tok-incumbent",
			});
		} finally {
			await host.close();
		}
	});
});
