import { afterAll, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { existsSync } from "node:fs";
import { frameRate, projectId, revisionOf } from "@opencut/editor-contracts";
import type { Project } from "@opencut/editor-contracts";
import {
	createTransactionNativeProjectSeed,
} from "@opencut/editor-contracts/engine";
import { CURRENT_PROJECT_VERSION } from "@opencut/editor-classic/transactions";
import { FileProjectStore } from "../file-store";
import { openEditorPlaneAutomation } from "../editor-plane";
import { TargetRegistry } from "../target-registry";
import { startHost } from "../host";

const tempRoots: string[] = [];
async function tempRoot(): Promise<string> {
	const root = await mkdtemp(path.join(tmpdir(), "rocut-s06-"));
	tempRoots.push(root);
	return root;
}
afterAll(async () => {
	for (const root of tempRoots)
		await rm(root, { recursive: true, force: true });
});

const PROJECT: Project = {
	id: projectId("host-test-project"),
	name: "Host tests",
	frameRate: frameRate({ numerator: 30, denominator: 1 }),
	canvasWidth: 1920,
	canvasHeight: 1080,
};

function createTrack(id: string) {
	return {
		kind: "create-track" as const,
		track: {
			id: id as never,
			kind: "graphic" as const,
			name: id,
			hidden: false,
		},
	};
}

describe("FileProjectStore (S06 C3)", () => {
	test("round-trips a seeded project and survives as plain JSON on disk", async () => {
		const root = await tempRoot();
		const store = new FileProjectStore({ root, schemaVersion: 1 });
		const seed = createTransactionNativeProjectSeed({
			projectId: PROJECT.id,
			project: PROJECT,
		});
		await store.save({ record: seed.record, summary: seed.summary });
		expect(existsSync(path.join(root, "project.json"))).toBe(true);
		const loaded = await store.load({ id: PROJECT.id });
		expect(loaded?.id).toBe(PROJECT.id);
		const raw = JSON.parse(
			await readFile(path.join(root, "project.json"), "utf8"),
		);
		expect(raw.wrapperVersion).toBe(1);
	});

	test("rejects record/summary id mismatch as a pre-commit conflict", async () => {
		const root = await tempRoot();
		const store = new FileProjectStore({ root, schemaVersion: 1 });
		const seed = createTransactionNativeProjectSeed({
			projectId: PROJECT.id,
			project: PROJECT,
		});
		expect(
			store.save({
				record: seed.record,
				summary: { ...seed.summary, id: projectId("other") },
			}),
		).rejects.toThrow("must match");
	});

	test("library records round-trip under sanitized segments", async () => {
		const root = await tempRoot();
		const store = new FileProjectStore({ root, schemaVersion: 1 });
		await store.saveLibraryRecord({
			namespace: "ns/1",
			key: "k..y",
			schemaVersion: 2,
			data: { a: 1 },
		});
		const loaded = await store.loadLibraryRecord({
			namespace: "ns/1",
			key: "k..y",
		});
		expect(loaded?.data).toEqual({ a: 1 });
	});
});

describe("host start (S06 C3)", () => {
	test("serves an authenticated loopback API: token grants, wrong token 401s", async () => {
		const projectRoot = await tempRoot();
		const targetsRoot = await tempRoot();
		const host = await startHost({
			projectRoot,
			registry: new TargetRegistry(targetsRoot),
		});
		try {
			const base = `http://127.0.0.1:${host.port}`;
			const denied = await fetch(`${base}/not-the-token/api/context`);
			expect(denied.status).toBe(401);
			const context = (await (
				await fetch(`${base}/${host.token}/api/context`)
			).json()) as { revision: number; project: { name: string } };
			expect(context.revision).toBe(0);
			expect(context.project.name).toBe("Untitled project");

			const applied = (await (
				await fetch(`${base}/${host.token}/api/apply`, {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({ operations: [createTrack("t1")] }),
				})
			).json()) as {
				accepted: boolean;
				revision: number;
				createdIds: string[];
			};
			expect(applied.accepted).toBe(true);
			expect(applied.createdIds).toContain("t1");

			const tracks = (await (
				await fetch(`${base}/${host.token}/api/tracks`)
			).json()) as { name: string }[];
			expect(tracks.map((track) => track.name)).toEqual([
				"Main Track",
				"t1",
			]);

			const invalid = (await (
				await fetch(`${base}/${host.token}/api/apply`, {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({ operations: [{ kind: "nonsense" }] }),
				})
			).json()) as { accepted: boolean };
			expect(invalid.accepted).toBe(false);
		} finally {
			await host.close();
		}
	});

	test("the registry lists targets without credentials and resolve(auto) reconnects", async () => {
		const projectRoot = await tempRoot();
		const targetsRoot = await tempRoot();
		const registry = new TargetRegistry(targetsRoot);
		const host = await startHost({ projectRoot, registry });
		try {
			const entries = await registry.list();
			expect(entries.length).toBe(1);
			expect(entries[0].id).toBe(path.basename(projectRoot));
			const indexText = await readFile(
				path.join(targetsRoot, "targets.json"),
				"utf8",
			);
			expect(indexText).not.toContain(host.token);
			const resolved = await registry.resolve("auto");
			expect(resolved?.secret.token).toBe(host.token);
			expect(resolved?.entry.port).toBe(host.port);
		} finally {
			await host.close();
		}
	});

	test("crash recovery: state applied through the host reopens intact from the file", async () => {
		const projectRoot = await tempRoot();
		const targetsRoot = await tempRoot();
		const host = await startHost({
			projectRoot,
			registry: new TargetRegistry(targetsRoot),
		});
		await fetch(`http://127.0.0.1:${host.port}/${host.token}/api/apply`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ operations: [createTrack("survivor")] }),
		});
		await host.close(); // simulate the host dying

		// Reopen on the editor plane (the dual-plane unification): the same
		// record the pane's session reads.
		const { automation } = await openEditorPlaneAutomation({
			baseStore: new FileProjectStore({
				root: projectRoot,
				schemaVersion: CURRENT_PROJECT_VERSION,
			}),
			projectId: projectId(path.basename(projectRoot)),
		});
		expect(await automation.revision()).toBe(revisionOf(1));
		expect((await automation.tracks()).map((track) => track.name)).toEqual([
			"survivor",
			"Main Track",
		]);
		expect((await readdir(projectRoot)).sort()).toEqual(["project.json"]);
	});

	test("a static dir serves index.html at the authenticated root", async () => {
		const projectRoot = await tempRoot();
		const staticRoot = await tempRoot();
		const { writeFile } = await import("node:fs/promises");
		await writeFile(
			path.join(staticRoot, "index.html"),
			"<html>surface</html>",
			"utf8",
		);
		const host = await startHost({
			projectRoot,
			staticDir: staticRoot,
			registry: new TargetRegistry(await tempRoot()),
		});
		try {
			const page = await fetch(host.editorUrl);
			expect(page.status).toBe(200);
			expect(await page.text()).toBe("<html>surface</html>");
			const escape = await fetch(`http://127.0.0.1:${host.port}/../etc/passwd`);
			expect([401, 404]).toContain(escape.status);
		} finally {
			await host.close();
		}
	});
});
