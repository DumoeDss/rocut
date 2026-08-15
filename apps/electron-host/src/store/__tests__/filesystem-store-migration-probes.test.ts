/**
 * s05-second-host — filesystem migration probes (task 4.4): the
 * mechanism-neutral analogs of the C5 browser migration probes, run under
 * `bun test` over seeded on-disk envelopes.
 *
 * Stated non-coverage: the C5 browser probes themselves (IndexedDB seeding,
 * stage-database cleanup, recovery journals) are IndexedDB-specific and are
 * NOT claimed for this store. The browser store keeps its own probes; these
 * probes prove the same contracts in the filesystem medium.
 *
 * The published transform chain comes from `@opencut/editor-classic/storage`,
 * whose module graph statically reaches the real `opencut-wasm` package —
 * under `bun test` that init throws. Like the conformance file beside this
 * one, the real probes run in an isolated child process whose first sequential
 * import installs `evidence/wasm-test-mock` (repo pattern; see
 * `apps/web/src/editor/host/__tests__/production-composition.test.ts`).
 *
 * Probes:
 *  1. forward migration — a v29 record (two published transform steps) and a
 *     v30 record (one step) both reach the current version through the
 *     published transform chain, and progress is reported;
 *  2. failure preservation — a throwing transform and a refusing (`skipped`)
 *     transform each leave the source record byte-identical on disk and
 *     report `failed`;
 *  3. no-opt-in refusal — a non-default identity without an explicit
 *     disposable policy refuses to migrate (both the default-disabled and the
 *     production-on-custom-identity flavors) and touches nothing;
 *  4. no stray files — after a successful migration the root contains only
 *     the design-E4 layout (the afterDatabases equivalent).
 */
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, expect, test } from "bun:test";
import type { StorageMigration } from "@opencut/editor-classic/storage";

if (process.env.OPENCUT_FS_STORE_TEST_ISOLATED !== "1") {
	test("filesystem migration probes run in an isolated wasm-mock process", () => {
		const result = Bun.spawnSync({
			cmd: [process.execPath, "test", fileURLToPath(import.meta.url)],
			cwd: process.cwd(),
			env: {
				...process.env,
				OPENCUT_FS_STORE_TEST_ISOLATED: "1",
			},
			stderr: "pipe",
			stdout: "pipe",
		});
		if (result.exitCode !== 0) {
			throw new Error(
				`isolated filesystem migration probe suite failed:\n${result.stdout.toString()}\n${result.stderr.toString()}`,
			);
		}
	});
} else {
	await import("@opencut/editor-classic/evidence/wasm-test-mock");
	const { NodeFsStoreBridge } = await import("../node-fs-store-bridge");
	const { DEFAULT_FILESYSTEM_STORE_IDENTITY, FilesystemProjectStore } =
		await import("../filesystem-project-store");
	// A destructured dynamic-import const carries no type meaning; alias the
	// class type through an import type for the annotations below.
	type FilesystemProjectStoreInstance = import("../filesystem-project-store").FilesystemProjectStore;
	type ProjectStoreFiles = import("../project-store-files").ProjectStoreFiles;

	const prefix = "opencut-fs-disposable-";
	const roots: string[] = [];

	function disposableRoot(): string {
		const root = mkdtempSync(join(tmpdir(), "opencut-fs-migration-"));
		roots.push(root);
		return root;
	}

	function disposableStore(
		options: {
			identity?: string;
			migrations?: readonly StorageMigration[];
		} = {},
	): {
		store: FilesystemProjectStoreInstance;
		bridge: ProjectStoreFiles;
		root: string;
		identity: string;
	} {
		const identity = options.identity ?? `${prefix}probe-${roots.length}`;
		const root = disposableRoot();
		const bridge = new NodeFsStoreBridge({ root, identity });
		const store = new FilesystemProjectStore(bridge, {
			identity,
			migrationPolicy: { kind: "disposable", identity, prefix },
			migrations: options.migrations,
		});
		return { store, bridge, root, identity };
	}

	interface SeedProject {
		readonly id: string;
		readonly name: string;
		readonly version: number;
	}

	/** A minimal legacy-shaped project the published transforms accept. */
	function seedPayload(project: SeedProject): Record<string, unknown> {
		return {
			metadata: { id: project.id, name: project.name },
			scenes: [
				{
					id: `${project.id}-scene`,
					name: "Main scene",
					isMain: true,
					tracks: { main: { id: "main", elements: [] }, overlay: [], audio: [] },
					bookmarks: [],
				},
			],
			currentSceneId: `${project.id}-scene`,
			settings: { fps: 30 },
			version: project.version,
		};
	}

	async function seed(
		store: FilesystemProjectStoreInstance,
		project: SeedProject,
	): Promise<void> {
		await store.save({
			record: {
				id: project.id,
				schemaVersion: project.version,
				data: seedPayload(project),
			},
			summary: {
				id: project.id,
				name: project.name,
				createdAt: "2026-08-01T00:00:00.000Z",
				updatedAt: "2026-08-01T00:00:00.000Z",
			},
		});
	}

	const reportSink: Array<{ completed: number; total: number }> = [];
	const reportProgress = (progress: { completed: number; total: number }) => {
		reportSink.push({ completed: progress.completed, total: progress.total });
	};

	afterAll(() => {
		for (const root of roots) rmSync(root, { recursive: true, force: true });
	});

	test("probe 1: seeded old-version records migrate forward through the published chain", async () => {
		const { store } = disposableStore();
		await seed(store, { id: "probe-chain", name: "Chain", version: 29 });
		await seed(store, { id: "probe-step", name: "Step", version: 30 });

		const outcome = await store.migrate({
			from: 29,
			to: store.schemaVersion,
			report: reportProgress,
		});

		expect(outcome.status).toBe("migrated");
		if (outcome.status !== "migrated") return;
		expect(outcome.from).toBe(29);
		expect(outcome.to).toBe(store.schemaVersion);
		expect(outcome.recordsMigrated).toBe(2);
		expect(reportSink.length).toBeGreaterThan(0);
		expect(reportSink.at(-1)).toEqual({ completed: 2, total: 2 });

		const chain = await store.load({ id: "probe-chain" });
		const step = await store.load({ id: "probe-step" });
		expect(chain?.schemaVersion).toBe(store.schemaVersion);
		expect(step?.schemaVersion).toBe(store.schemaVersion);
		const chainData = chain?.data as { version?: number; metadata?: { id?: string } };
		expect(chainData.version).toBe(store.schemaVersion);
		expect(chainData.metadata?.id).toBe("probe-chain");

		// Idempotent: a second run against the now-current store is not-needed.
		const second = await store.migrate({
			from: store.schemaVersion,
			to: store.schemaVersion,
			report: () => {},
		});
		expect(second.status).toBe("not-needed");
	});

	class ThrowingMigration implements StorageMigration {
		readonly from = 30;
		readonly to = 31;
		async run(): Promise<{ project: Record<string, unknown>; skipped: boolean }> {
			throw new Error("probe: deliberate transform failure");
		}
	}

	class RefusingMigration implements StorageMigration {
		readonly from = 30;
		readonly to = 31;
		async run(): Promise<{
			project: Record<string, unknown>;
			skipped: boolean;
			reason?: string;
		}> {
			return { project: {}, skipped: true, reason: "probe: deliberate refusal" };
		}
	}

	test("probe 2a: a throwing transform preserves the source record and reports failed", async () => {
		const { store, root } = disposableStore({ migrations: [new ThrowingMigration()] });
		await seed(store, { id: "probe-throw", name: "Throw", version: 30 });
		const recordPath = `${root}/projects/probe-throw/record.json`;
		const bytesBefore = readFileSync(recordPath);

		const outcome = await store.migrate({
			from: 30,
			to: store.schemaVersion,
			report: () => {},
		});

		expect(outcome.status).toBe("failed");
		if (outcome.status !== "failed") return;
		expect(outcome.reason).toContain("unchanged");
		const reloaded = await store.load({ id: "probe-throw" });
		expect(reloaded?.schemaVersion).toBe(30);
		expect(readFileSync(recordPath).equals(bytesBefore)).toBe(true);
	});

	test("probe 2b: a refusing (skipped) transform preserves the source record and reports failed", async () => {
		const { store } = disposableStore({ migrations: [new RefusingMigration()] });
		await seed(store, { id: "probe-refuse", name: "Refuse", version: 30 });

		const outcome = await store.migrate({
			from: 30,
			to: store.schemaVersion,
			report: () => {},
		});

		expect(outcome.status).toBe("failed");
		const reloaded = await store.load({ id: "probe-refuse" });
		expect(reloaded?.schemaVersion).toBe(30);
		const payload = reloaded?.data as { version?: number };
		expect(payload.version).toBe(30);
	});

	test("probe 3: migration without disposable opt-in is refused and touches nothing", async () => {
		// 3a: a non-default identity with no explicit policy defaults to disabled.
		const rootA = disposableRoot();
		const identityA = "opencut-fs-unrelated-identity";
		const storeA = new FilesystemProjectStore(
			new NodeFsStoreBridge({ root: rootA, identity: identityA }),
			{ identity: identityA },
		);
		await seed(storeA, { id: "probe-refused", name: "Refused", version: 30 });
		const recordPath = `${rootA}/projects/probe-refused/record.json`;
		const bytesBefore = readFileSync(recordPath);

		const refused = await storeA.migrate({
			from: 30,
			to: storeA.schemaVersion,
			report: () => {},
		});
		expect(refused.status).toBe("failed");
		if (refused.status !== "failed") return;
		expect(refused.reason).toContain("not enabled");
		expect(readFileSync(recordPath).equals(bytesBefore)).toBe(true);

		// 3b: an explicit production policy on a non-default identity also refuses.
		const rootB = disposableRoot();
		const identityB = "opencut-fs-other-identity";
		const storeB = new FilesystemProjectStore(
			new NodeFsStoreBridge({ root: rootB, identity: identityB }),
			{ identity: identityB, migrationPolicy: { kind: "production" } },
		);
		const misbound = await storeB.migrate({
			from: null,
			to: storeB.schemaVersion,
			report: () => {},
		});
		expect(misbound.status).toBe("failed");
		if (misbound.status !== "failed") return;
		expect(misbound.reason).toContain("opt-in");

		// 3c: the default production identity is exactly one string — anything
		// else must not silently inherit production migration rights.
		expect(DEFAULT_FILESYSTEM_STORE_IDENTITY).toBe("opencut-fs-production");
	});

	test("probe 4: a migrated root holds only the design-E4 layout (no stray files)", async () => {
		const { store, root } = disposableStore();
		await seed(store, { id: "probe-layout", name: "Layout", version: 30 });
		await store.saveAttachment({
			projectId: "probe-layout",
			key: "seed-media",
			metadata: { origin: "probe" },
			body: new Uint8Array([1, 2, 3]).buffer,
		});
		await store.saveLibraryRecord({
			namespace: "probe-ns",
			key: "probe-key",
			schemaVersion: 1,
			data: { keep: true },
		});

		const outcome = await store.migrate({
			from: 30,
			to: store.schemaVersion,
			report: () => {},
		});
		expect(outcome.status).toBe("migrated");

		const stray: string[] = [];
		// Absent directories are legitimate (a project with no attachments, an
		// empty root); read them as empty rather than throwing.
		const list = (directory: string): string[] => {
			try {
				return readdirSync(directory);
			} catch {
				return [];
			}
		};

		// Top level: exactly the design-E4 trees plus the advisory store file.
		for (const entry of list(root)) {
			if (entry !== "projects" && entry !== "library" && entry !== "store.json") {
				stray.push(`${root}/${entry}`);
			}
		}
		// projects/<id>/ holds record.json and attachments/ only; attachment
		// bodies and their .meta.json siblings are both legal inside attachments/.
		for (const projectEntry of readdirSync(`${root}/projects`, {
			withFileTypes: true,
		})) {
			const projectPath = `${root}/projects/${projectEntry.name}`;
			if (!projectEntry.isDirectory()) {
				stray.push(projectPath);
				continue;
			}
			for (const entry of list(projectPath)) {
				if (entry !== "record.json" && entry !== "attachments") {
					stray.push(`${projectPath}/${entry}`);
				}
			}
			for (const entry of list(`${projectPath}/attachments`)) {
				if (entry.includes(".tmp-")) {
					stray.push(`${projectPath}/attachments/${entry}`);
				}
			}
		}
		// library/<namespace>/ directories hold only *.json record files.
		for (const nsEntry of readdirSync(`${root}/library`, { withFileTypes: true })) {
			const namespacePath = `${root}/library/${nsEntry.name}`;
			if (!nsEntry.isDirectory()) {
				stray.push(namespacePath);
				continue;
			}
			for (const entry of list(namespacePath)) {
				if (!entry.endsWith(".json") || entry.includes(".tmp-")) {
					stray.push(`${namespacePath}/${entry}`);
				}
			}
		}
		expect(stray).toEqual([]);

		// No atomic-write temp files survived anywhere in the root.
		const collectTemps = (directory: string): string[] => {
			const found: string[] = [];
			for (const entry of readdirSync(directory, { withFileTypes: true })) {
				const target = `${directory}/${entry.name}`;
				if (entry.isDirectory()) found.push(...collectTemps(target));
				else if (entry.name.includes(".tmp-")) found.push(target);
			}
			return found;
		};
		expect(collectTemps(root)).toEqual([]);
	});
}
