/**
 * Daemon surface tests (S08 R group 2): the bearer-authenticated `/health`
 * identity route, `api/status` with the activity signals, and the throttled
 * in-place registry activity sync.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { TargetRegistry } from "../target-registry";
import { startHost } from "../host";
import {
	ACTIVITY_SYNC_INTERVAL_MS,
	createActivityTracker,
	createRegistryActivitySync,
} from "../host-activity";

const tempRoots: string[] = [];
async function tempRoot(prefix = "rocut-r08h-"): Promise<string> {
	const root = await mkdtemp(path.join(tmpdir(), prefix));
	tempRoots.push(root);
	return root;
}
afterAll(async () => {
	for (const root of tempRoots) {
		await rm(root, { recursive: true, force: true });
	}
});

describe("GET /health (task 2.1)", () => {
	test("the correct bearer gets the id echoed; a wrong or absent bearer gets a 401 with no id", async () => {
		const targetsRoot = await tempRoot();
		const registry = new TargetRegistry(targetsRoot);
		const host = await startHost({
			projectRoot: await tempRoot("rocut-health-p-"),
			registry,
		});
		try {
			const base = `http://127.0.0.1:${host.port}`;
			const ok = await fetch(`${base}/health`, {
				headers: { authorization: `Bearer ${host.token}` },
			});
			expect(ok.status).toBe(200);
			const body = (await ok.json()) as {
				id: string;
				startedAt: number;
				lastActivityAt: number | null;
				lastProbeAt: number | null;
			};
			expect(body.id).toBe(host.targetId);
			expect(typeof body.startedAt).toBe("number");

			const wrong = await fetch(`${base}/health`, {
				headers: { authorization: "Bearer nope" },
			});
			expect(wrong.status).toBe(401);
			expect(await wrong.text()).not.toContain(host.targetId);

			const absent = await fetch(`${base}/health`);
			expect(absent.status).toBe(401);
		} finally {
			await host.close();
		}
	});
});

describe("api/status and activity recording (task 2.2)", () => {
	test("status exposes id/startedAt/lastActivityAt/lastProbeAt/revision; lastActivityAt advances", async () => {
		const targetsRoot = await tempRoot();
		const registry = new TargetRegistry(targetsRoot);
		const host = await startHost({
			projectRoot: await tempRoot("rocut-status-p-"),
			registry,
		});
		try {
			const url = `http://127.0.0.1:${host.port}/${host.token}/api/status`;
			const first = (await (await fetch(url)).json()) as {
				id: string;
				startedAt: number;
				lastActivityAt: number;
				lastProbeAt: number | null;
				revision: number;
			};
			expect(first.id).toBe(host.targetId);
			expect(first.revision).toBe(0);
			expect(first.lastActivityAt).toBeGreaterThanOrEqual(first.startedAt);
			expect(first.lastProbeAt).toBe(null); // no probe has arrived yet

			// a probe advances lastProbeAt but NOT lastActivityAt
			const before = first.lastActivityAt;
			await fetch(`http://127.0.0.1:${host.port}/health`, {
				headers: { authorization: `Bearer ${host.token}` },
			});
			const probed = (await (await fetch(url)).json()) as {
				lastActivityAt: number;
				lastProbeAt: number;
			};
			expect(probed.lastProbeAt).toBeGreaterThanOrEqual(before);
			// the status fetch itself IS activity, so lastActivityAt also moves —
			// assert the probe did not regress it below `before`.
			expect(probed.lastActivityAt).toBeGreaterThanOrEqual(before);

			// further authenticated traffic advances activity again
			await new Promise((resolve) => setTimeout(resolve, 5));
			await fetch(`http://127.0.0.1:${host.port}/${host.token}/api/context`);
			const after = (await (await fetch(url)).json()) as {
				lastActivityAt: number;
			};
			expect(after.lastActivityAt).toBeGreaterThan(before);
		} finally {
			await host.close();
		}
	});
	test("revision-stream emissions count as activity (seam: bun's HTTP client cannot consume its own SSE responses — verified pre-existing against the pre-S08 host)", async () => {
		const { revisionEventWriter } = await import("../host");
		const { readFile: readSource } = await import("node:fs/promises");
		let noted = 0;
		const chunks: string[] = [];
		let flushed = 0;
		const emit = revisionEventWriter({
			noteActivity: () => {
				noted += 1;
			},
			write: (chunk) => {
				chunks.push(chunk);
			},
			flush: () => {
				flushed += 1;
			},
		});
		emit(3);
		expect(noted).toBe(1); // the emission itself is activity
		expect(chunks).toEqual([`data: ${JSON.stringify({ revision: 3 })}\n\n`]);
		expect(flushed).toBe(1);
		emit(4);
		expect(noted).toBe(2);
		// structural: the events route wires noteActivity through the writer —
		// the structural-import lesson (tsc is blind to wiring like this)
		const { fileURLToPath } = await import("node:url");
		const source = await readSource(
			fileURLToPath(new URL("../host.ts", import.meta.url)),
			"utf8",
		);
		expect(source).toContain("revisionEventWriter({");
		expect(source).toContain("noteActivity: () => context.noteActivity()");
	});
});

describe("throttled registry activity sync (task 2.3)", () => {
	test("the daemon patches lastActivityAt in place, at most once per window", async () => {
		const targetsRoot = await tempRoot();
		const registry = new TargetRegistry(targetsRoot);
		const host = await startHost({
			projectRoot: await tempRoot("rocut-sync-p-"),
			registry,
			activitySyncIntervalMs: 60_000,
		});
		try {
			const url = `http://127.0.0.1:${host.port}/${host.token}/api/status`;
			await fetch(url); // activity
			// The 60 s window means the registry is NOT rewritten yet.
			const entries = await registry.list();
			expect(entries.length).toBe(1);
			expect(entries[0].lastActivityAt).toBeUndefined();
		} finally {
			await host.close();
		}
	});
	test("with the window elapsed, the entry updates in place without reordering", async () => {
		const targetsRoot = await tempRoot();
		const registry = new TargetRegistry(targetsRoot);
		const host = await startHost({
			projectRoot: await tempRoot("rocut-sync2-p-"),
			registry,
			activitySyncIntervalMs: 0,
		});
		// register() PREPENDS — so this second registration pushes the daemon
		// off the head, making any reorder-by-re-register visible.
		await registry.register({
			entry: {
				id: "aaa-head",
				port: 1,
				pid: 1,
				projectPath: "/nowhere/head",
				startedAt: 1,
			},
			secret: { id: "aaa-head", port: 1, token: "t-head" },
		});
		try {
			const url = `http://127.0.0.1:${host.port}/${host.token}/api/status`;
			const status = (await (await fetch(url)).json()) as {
				lastActivityAt: number;
			};
			expect(status.lastActivityAt).toBeGreaterThan(0);
			// the patch is async relative to the response — poll for it
			let entries = await registry.list();
			for (let attempt = 0; attempt < 40 && entries[1]?.lastActivityAt === undefined; attempt += 1) {
				await new Promise((resolve) => setTimeout(resolve, 25));
				entries = await registry.list();
			}
			expect(entries.map((entry) => entry.id)).toEqual([
				"aaa-head",
				host.targetId,
			]); // in place — register() prepends, the sync must not reorder
			const patched = entries[1];
			expect(patched.lastActivityAt).toBe(status.lastActivityAt);
			expect(patched.port).toBe(host.port); // other fields untouched
			// a second fetch within intervalMs=0 still patches — but never moves
			await fetch(url);
			let again = await registry.list();
			for (let attempt = 0; attempt < 40 && again[1].lastActivityAt === patched.lastActivityAt; attempt += 1) {
				await new Promise((resolve) => setTimeout(resolve, 25));
				again = await registry.list();
			}
			expect(again.map((entry) => entry.id)).toEqual([
				"aaa-head",
				host.targetId,
			]);
			expect(again[1].lastActivityAt).toBeGreaterThan(patched.lastActivityAt);
		} finally {
			await host.close();
		}
	});
	test("unit: activity inside the window does not rewrite, outside it does", async () => {
		const targetsRoot = await tempRoot();
		const registry = new TargetRegistry(targetsRoot);
		await registry.register({
			entry: {
				id: "unit",
				port: 1,
				pid: 1,
				projectPath: "/nowhere/unit",
				startedAt: 1,
			},
			secret: { id: "unit", port: 1, token: "t" },
		});
		let clock = 10_000;
		const tracker = createActivityTracker({ id: "unit", startedAt: 0, now: () => clock });
		const sync = createRegistryActivitySync({
			registry,
			targetId: "unit",
			snapshot: tracker.snapshot,
			intervalMs: 5_000,
			now: () => clock,
		});
		tracker.note();
		await sync.note(); // first: writes
		let entries = await registry.list();
		expect(entries[0].lastActivityAt).toBe(10_000);
		const raw = await readFile(path.join(targetsRoot, "targets.json"), "utf8");

		clock = 12_000;
		tracker.note();
		await sync.note(); // inside the 5 s window: no write
		expect(await readFile(path.join(targetsRoot, "targets.json"), "utf8")).toBe(raw);

		clock = 18_000;
		tracker.note();
		await sync.note(); // outside: writes
		entries = await registry.list();
		expect(entries[0].lastActivityAt).toBe(18_000);
		expect(entries.length).toBe(1); // still in place, still one row
	});
	test("the default throttle constant is 60 s", () => {
		expect(ACTIVITY_SYNC_INTERVAL_MS).toBe(60_000);
	});
});
