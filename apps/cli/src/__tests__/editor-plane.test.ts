import { afterAll, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { projectId } from "@opencut/editor-contracts";
import {
	CURRENT_PROJECT_VERSION,
	readOpenCutEnvelopeSummary,
} from "@opencut/editor-classic/transactions";
import type { StorageMigration } from "@opencut/editor-classic/storage/migrations";
import type { ProjectRecord } from "@opencut/editor-ports";
import { FileProjectStore } from "../file-store";
import {
	migrateEditorRecord,
	openEditorPlaneAutomation,
	prepareEditorProjectRecord,
} from "../editor-plane";
import { TargetRegistry } from "../target-registry";
import { startHost } from "../host";
import type { RunningHost } from "../host";

const tempRoots: string[] = [];
async function tempRoot(): Promise<string> {
	const root = await mkdtemp(path.join(tmpdir(), "rocut-plane-"));
	tempRoots.push(root);
	return root;
}
afterAll(async () => {
	for (const root of tempRoots)
		await rm(root, { recursive: true, force: true });
});

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

/** A fabricated transform chain step, in the published chain's shape. */
function fakeMigration(from: number, to: number, tag: string): StorageMigration {
	return {
		from,
		to,
		async run({ project }) {
			return {
				project: { ...project, migrated: [...(project.migrated as string[] ?? []), tag] },
				skipped: false,
			};
		},
	} as unknown as StorageMigration;
}

describe("editor plane: seed and reopen (the unification's file contract)", () => {
	test("a fresh root seeds an editor record at the current schema with a revision-0 envelope", async () => {
		const root = await tempRoot();
		const store = new FileProjectStore({
			root,
			schemaVersion: CURRENT_PROJECT_VERSION,
		});
		const projectIdentifier = projectId("seed-probe");
		const record = await prepareEditorProjectRecord({
			store,
			projectId: projectIdentifier,
			name: "Seed probe",
		});
		expect(record.schemaVersion).toBe(CURRENT_PROJECT_VERSION);
		expect(record.id).toBe(projectIdentifier);
		const envelope = readOpenCutEnvelopeSummary(record.data);
		expect(envelope?.revision).toBe(0);
		const raw = JSON.parse(
			await readFile(path.join(root, "project.json"), "utf8"),
		) as { record: ProjectRecord; summary: { name: string } };
		expect(raw.summary.name).toBe("Seed probe");
		expect(readOpenCutEnvelopeSummary(raw.record.data)?.revision).toBe(0);
		// The seed decodes through the editor adapter: the plane the pane's
		// session will read.
		const { automation } = await openEditorPlaneAutomation({
			baseStore: store,
			projectId: projectIdentifier,
		});
		expect((await automation.tracks()).length).toBe(1); // the default main track
		expect((await automation.project())?.name).toBe("Seed probe");
	});

	test("sequential applies keep the file an editor record (payload + envelope, not a bare engine document)", async () => {
		const root = await tempRoot();
		const store = new FileProjectStore({
			root,
			schemaVersion: CURRENT_PROJECT_VERSION,
		});
		const projectIdentifier = projectId("apply-probe");
		await prepareEditorProjectRecord({
			store,
			projectId: projectIdentifier,
			name: "Apply probe",
		});
		const { automation } = await openEditorPlaneAutomation({
			baseStore: store,
			projectId: projectIdentifier,
		});
		await automation.apply({ operations: [createTrack("t1")] });
		await automation.apply({ operations: [createTrack("t2")] });
		const record = await store.load({ id: projectIdentifier });
		expect(record?.schemaVersion).toBe(CURRENT_PROJECT_VERSION);
		expect(readOpenCutEnvelopeSummary(record?.data)?.revision).toBe(2);
		const data = record?.data as Record<string, unknown>;
		expect(typeof data.metadata).toBe("object"); // the editor payload survived
		expect(Array.isArray(data.scenes)).toBe(true);
		expect(data.transactionEngine).toBeUndefined(); // NOT the native plane
		const reopened = await openEditorPlaneAutomation({
			baseStore: store,
			projectId: projectIdentifier,
		});
		expect(
			(await reopened.automation.tracks()).map((track) => track.name),
		).toEqual(["t1", "t2", "Main Track"]);
	});

	test("a UI-field-only external save survives the next agent apply (the adopt discipline)", async () => {
		const root = await tempRoot();
		const store = new FileProjectStore({
			root,
			schemaVersion: CURRENT_PROJECT_VERSION,
		});
		const projectIdentifier = projectId("adopt-probe");
		await prepareEditorProjectRecord({
			store,
			projectId: projectIdentifier,
			name: "Adopt probe",
		});
		const first = await openEditorPlaneAutomation({
			baseStore: store,
			projectId: projectIdentifier,
		});
		await first.automation.apply({ operations: [createTrack("kept")] });
		// The pane saves a record whose only change is a UI field (thumbnail),
		// at the same revision — write it through the raw store, as PUT does.
		const stored = await store.load({ id: projectIdentifier });
		const summary = (await store.list())[0];
		await store.save({
			record: {
				...stored!,
				data: {
					...((stored!.data as Record<string, unknown>)),
					metadata: {
						...((stored!.data as { metadata: Record<string, unknown> })
							.metadata),
						thumbnail: "data:image/png;base64,pane",
					},
				},
			},
			summary,
		});
		// A REBUILT automation (what the host does after an external save)
		// applies on top without losing the thumbnail.
		const rebuilt = await openEditorPlaneAutomation({
			baseStore: store,
			projectId: projectIdentifier,
		});
		await rebuilt.automation.apply({ operations: [createTrack("after")] });
		const final = await store.load({ id: projectIdentifier });
		const metadata = (final!.data as { metadata: Record<string, unknown> })
			.metadata;
		expect(metadata.thumbnail).toBe("data:image/png;base64,pane");
		expect(
			(await rebuilt.automation.tracks()).map((track) => track.name),
		).toEqual(["kept", "Main Track", "after"]);
	});
});

describe("editor plane: migration walk", () => {
	test("walks an injected chain to the current version and writes the record back", async () => {
		const root = await tempRoot();
		const store = new FileProjectStore({
			root,
			schemaVersion: CURRENT_PROJECT_VERSION,
		});
		const projectIdentifier = projectId("legacy-probe");
		const legacy: ProjectRecord = {
			id: projectIdentifier,
			schemaVersion: 29,
			data: { version: 29, scenes: [] },
		};
		await store.save({
			record: legacy,
			summary: {
				id: projectIdentifier,
				name: "Legacy",
				createdAt: "2026-01-01T00:00:00.000Z",
				updatedAt: "2026-01-01T00:00:00.000Z",
			},
		});
		const chain = [fakeMigration(29, 30, "a"), fakeMigration(30, 31, "b")];
		const migrated = await prepareEditorProjectRecord({
			store,
			projectId: projectIdentifier,
			name: "Legacy",
			migrationSource: async () => ({ migrations: chain }),
		});
		expect(migrated.schemaVersion).toBe(CURRENT_PROJECT_VERSION);
		expect((migrated.data as { migrated: string[] }).migrated).toEqual([
			"a",
			"b",
		]);
		const onDisk = await store.load({ id: projectIdentifier });
		expect(onDisk?.schemaVersion).toBe(CURRENT_PROJECT_VERSION);
	});

	test("a gap in the chain refuses and leaves the file untouched", async () => {
		const record: ProjectRecord = {
			id: projectId("gap"),
			schemaVersion: 29,
			data: { version: 29 },
		};
		expect(
			migrateEditorRecord({
				record,
				migrations: [fakeMigration(30, 31, "late")],
			}),
		).rejects.toThrow("did not reach the current schema");
	});

	test("a refusing transform refuses the whole walk", async () => {
		const refusing: StorageMigration = {
			from: 29,
			to: 30,
			async run() {
				return { project: {} as never, skipped: true, reason: "no" };
			},
		} as unknown as StorageMigration;
		const record: ProjectRecord = {
			id: projectId("refuse"),
			schemaVersion: 29,
			data: { version: 29 },
		};
		expect(
			migrateEditorRecord({ record, migrations: [refusing] }),
		).rejects.toThrow("refused a required schema step");
	});
});

describe("editor plane: external record saves over HTTP", () => {
	async function openHost(): Promise<RunningHost> {
		return startHost({
			projectRoot: await tempRoot(),
			registry: new TargetRegistry(await tempRoot()),
		});
	}

	async function applyTrack(
		host: RunningHost,
		id: string,
	): Promise<{ accepted: boolean; revision?: number }> {
		return (await (
			await fetch(
				`http://127.0.0.1:${host.port}/${host.token}/api/apply`,
				{
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({
						operations: [createTrack(id)],
						idempotencyKey: `agent:${id}`,
					}),
				},
			)
		).json()) as { accepted: boolean; revision?: number };
	}

	async function getRecord(host: RunningHost): Promise<{
		record: ProjectRecord;
		summary: unknown;
	}> {
		return (await (
			await fetch(
				`http://127.0.0.1:${host.port}/${host.token}/api/record`,
			)
		).json()) as { record: ProjectRecord; summary: unknown };
	}

	async function putRecord(
		host: RunningHost,
		body: unknown,
	): Promise<{ status: number; payload: Record<string, unknown> }> {
		const response = await fetch(
			`http://127.0.0.1:${host.port}/${host.token}/api/record`,
			{
				method: "PUT",
				headers: { "content-type": "application/json" },
				body: JSON.stringify(body),
			},
		);
		return {
			status: response.status,
			payload: (await response.json()) as Record<string, unknown>,
		};
	}

	test("a UI-field-only save (same revision, same history) is accepted and the engine resyncs", async () => {
		const host = await openHost();
		try {
			expect((await applyTrack(host, "one")).accepted).toBe(true);
			const { record, summary } = await getRecord(host);
			const saved = await putRecord(host, {
				record: {
					...record,
					data: {
						...(record.data as Record<string, unknown>),
						metadata: {
							...((record.data as { metadata: Record<string, unknown> })
								.metadata),
							thumbnail: "pane-thumb",
						},
					},
				},
				summary,
			});
			expect(saved.status).toBe(200);
			// The agent's next apply builds on the pane's record.
			const applied = await applyTrack(host, "two");
			expect(applied.accepted).toBe(true);
			const after = await getRecord(host);
			const metadata = (
				after.record.data as { metadata: Record<string, unknown> }
			).metadata;
			expect(metadata.thumbnail).toBe("pane-thumb");
			const tracks = (await (
				await fetch(
					`http://127.0.0.1:${host.port}/${host.token}/api/tracks`,
				)
			).json()) as { name: string }[];
			expect(tracks.map((track) => track.name)).toEqual([
				"one",
				"Main Track",
				"two",
			]);
		} finally {
			await host.close();
		}
	});

	test("a stale-revision save is a deterministic refusal, not a silent clobber", async () => {
		const host = await openHost();
		try {
			const { record, summary } = await getRecord(host); // revision 0
			expect((await applyTrack(host, "agent-first")).accepted).toBe(true);
			const stale = await putRecord(host, {
				record: {
					...record,
					data: {
						...(record.data as Record<string, unknown>),
						timelineViewState: { zoomLevel: 9, scrollLeft: 0, playheadTime: 0 },
					},
				},
				summary,
			});
			expect(stale.status).toBe(409);
			expect(stale.payload.error).toBe("revision-conflict");
			// The agent's work survived the refused save.
			const tracks = (await (
				await fetch(
					`http://127.0.0.1:${host.port}/${host.token}/api/tracks`,
				)
			).json()) as { name: string }[];
			expect(tracks.map((track) => track.name)).toEqual([
				"Main Track",
				"agent-first",
			]);
		} finally {
			await host.close();
		}
	});

	test("an accepted external save invalidates open agent drafts deterministically", async () => {
		const host = await openHost();
		try {
			const begun = (await (
				await fetch(`http://127.0.0.1:${host.port}/${host.token}/api/drafts`, {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({ approvalMode: "manual" }),
				})
			).json()) as { draftId: string };
			const { record, summary } = await getRecord(host);
			const saved = await putRecord(host, { record, summary });
			expect(saved.status).toBe(200);
			const staged = await fetch(
				`http://127.0.0.1:${host.port}/${host.token}/api/drafts/${begun.draftId}/stage`,
				{
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({ operations: [createTrack("stale-draft")] }),
				},
			);
			expect(staged.status).toBe(404);
		} finally {
			await host.close();
		}
	});

	test("a record without an envelope is refused", async () => {
		const host = await openHost();
		try {
			const { record, summary } = await getRecord(host);
			const data = { ...(record.data as Record<string, unknown>) };
			delete data.__opencutTransaction;
			const refused = await putRecord(host, {
				record: { ...record, data },
				summary,
			});
			expect(refused.status).toBe(409);
			expect(refused.payload.error).toBe("envelope-missing");
		} finally {
			await host.close();
		}
	});
});

describe("editor plane: the ./transactions entry stays wasm-free and react-free", () => {
	test("the entry's static import closure touches neither opencut-wasm nor react", async () => {
		const packageSrc = path.resolve(
			__dirname,
			"../../../../packages/editor-classic/src",
		);
		const entry = path.join(packageSrc, "transactions.ts");
		const forbidden = /opencut-wasm|[\\/]wasm([\\/.]|$)|react/i;
		const seen = new Set<string>();
		const queue = [entry];
		const exists = async (file: string): Promise<boolean> => {
			try {
				await readFile(file, "utf8");
				return true;
			} catch {
				return false;
			}
		};
		while (queue.length > 0) {
			const file = queue.shift()!;
			if (seen.has(file)) continue;
			seen.add(file);
			expect(
				forbidden.test(file),
				`The transactions entry closure reached ${file}`,
			).toBe(false);
			const source = await readFile(file, "utf8");
			// `import type` statements are erased at runtime — they are not
			// closure members.
			const runtimeSource = source.replace(/^import\s+type\s+[^;]+;/gm, "");
			const specifiers = [...runtimeSource.matchAll(/from\s+"(\.[^"]+)"/g)]
				.map((match) => match[1])
				.filter((specifier) => !specifier.endsWith(".css"));
			for (const specifier of specifiers) {
				const resolved = path.resolve(path.dirname(file), specifier);
				for (const candidate of [
					`${resolved}.ts`,
					path.join(resolved, "index.ts"),
				]) {
					if (await exists(candidate)) {
						queue.push(candidate);
						break;
					}
				}
			}
		}
		expect(
			seen.has(
				path.join(
					packageSrc,
					"editor",
					"persistence",
					"project-codec.ts",
				),
			),
		).toBe(true);
	});

	test("the seed's inline main-track name stays pinned to MAIN_TRACK_NAME", async () => {
		const source = await readFile(
			path.resolve(
				__dirname,
				"../../../../packages/editor-classic/src/timeline/placement/main-track.ts",
			),
			"utf8",
		);
		expect(source).toContain('export const MAIN_TRACK_NAME = "Main Track"');
		const entry = await readFile(
			path.resolve(
				__dirname,
				"../../../../packages/editor-classic/src/transactions.ts",
			),
			"utf8",
		);
		expect(entry).toContain('"Main Track"');
	});
});
