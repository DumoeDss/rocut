/**
 * The host's editor plane (S06 follow-on: web-surface wiring, ruled
 * 2026-08-17 — one plane, one file).
 *
 * The dual-plane question resolved on UNIFY: the reference host persists the
 * SAME record the editor session reads and writes — the full `TProject`
 * payload at `CURRENT_PROJECT_VERSION` carrying the
 * `__opencutTransaction` envelope — by composing the automation core over
 * editor-classic's adapter instead of the minimal native one. The automation
 * API agents see is unchanged; only the file format becomes the editor's.
 *
 * Three host-side duties live here:
 *
 * - `prepareEditorProjectRecord` — seed a fresh record, or bring a persisted
 *   one forward through the published migration chain (lazy: the chain's
 *   wasm closure only initializes when a legacy record actually needs it).
 * - `createAdoptingStore` — keep the adapter's in-memory base record in
 *   lockstep with successful saves, so sequential agent applies always
 *   overlay the freshest editor payload (the adopt discipline the in-editor
 *   router performs through its persistence coordinator).
 * - `openEditorPlaneAutomation` — the one composition, reused verbatim when
 *   an external editor save (the pane's HTTP store) invalidates the
 *   long-lived engine's in-memory state and the host reopens over the file
 *   SSOT.
 */
import type {
	LibraryRecord,
	ProjectAttachment,
	ProjectId,
	ProjectRecord,
	ProjectStore,
	ProjectStoreClearScope,
	ProjectStoreInspection,
	ProjectSummary,
} from "@opencut/editor-ports";
import { createAutomation } from "@opencut/editor-automation";
import type { AutomationApi } from "@opencut/editor-automation";
import {
	createOpenCutProjectRecord,
	createOpenCutTransactionDocumentAdapter,
	CURRENT_PROJECT_VERSION,
} from "@opencut/editor-classic/transactions";
import type { OpenCutTransactionDocumentAdapter } from "@opencut/editor-classic/transactions";
import type { StorageMigration } from "@opencut/editor-classic/storage/migrations";

/** Lazy migration source — the published chain only initializes on demand. */
export type MigrationSource = () => Promise<{
	readonly migrations: readonly StorageMigration[];
}>;

const defaultMigrationSource: MigrationSource = () =>
	import("@opencut/editor-classic/storage/migrations");

function sameJson(left: unknown, right: unknown): boolean {
	return JSON.stringify(left) === JSON.stringify(right);
}

/**
 * Bring a persisted record forward through the published transform chain,
 * sequencing exactly as `FilesystemProjectStore.runMigration` does: transform
 * in memory first, write only on success, refuse (throw) on any skip or gap.
 */
export async function migrateEditorRecord(args: {
	readonly record: ProjectRecord;
	readonly migrations: readonly StorageMigration[];
}): Promise<ProjectRecord> {
	const to = CURRENT_PROJECT_VERSION;
	if (args.record.schemaVersion >= to) return args.record;
	if (
		typeof args.record.data !== "object" ||
		args.record.data === null ||
		Array.isArray(args.record.data)
	) {
		throw new Error("The persisted project payload is not migratable");
	}
	let current = args.record.schemaVersion;
	let project: Record<string, unknown> = {
		...(args.record.data as Record<string, unknown>),
		version: current,
	};
	const ordered = [...args.migrations].sort((a, b) => a.from - b.from);
	for (const migration of ordered) {
		if (migration.from !== current) continue;
		const result = await migration.run({
			projectId: String(args.record.id),
			project,
		});
		if (result.skipped) {
			throw new Error(
				"A published transform refused a required schema step",
			);
		}
		project = result.project;
		current = migration.to;
	}
	if (current !== to) {
		throw new Error(
			"The published transform chain did not reach the current schema",
		);
	}
	return { ...args.record, schemaVersion: to, data: project };
}

/**
 * Seed or load the project's editor-plane record. A fresh root gets a
 * revision-0 editor record; a persisted record below the current schema is
 * migrated through the (lazily imported) published chain and written back
 * before anything decodes it.
 */
export async function prepareEditorProjectRecord(args: {
	readonly store: ProjectStore;
	readonly projectId: ProjectId;
	readonly name: string;
	readonly migrationSource?: MigrationSource;
}): Promise<ProjectRecord> {
	const existing = await args.store.list();
	if (existing.length === 0) {
		const seed = createOpenCutProjectRecord({
			projectId: args.projectId,
			name: args.name,
		});
		await args.store.save({ record: seed.record, summary: seed.summary });
		return seed.record;
	}
	const summary = existing.find((entry) => entry.id === args.projectId);
	if (summary === undefined) {
		throw new Error("The project store holds a different project");
	}
	const loaded = await args.store.load({ id: args.projectId });
	if (loaded === null) {
		throw new Error("The project summary has no record behind it");
	}
	if (loaded.schemaVersion >= CURRENT_PROJECT_VERSION) return loaded;
	const source = args.migrationSource ?? defaultMigrationSource;
	const { migrations } = await source();
	const migrated = await migrateEditorRecord({ record: loaded, migrations });
	await args.store.save({ record: migrated, summary });
	return migrated;
}

/**
 * A store wrapper that adopts every successfully saved record into the
 * adapter's base — the host-side twin of the editor router's
 * `adoptCommittedRecord` discipline, so the next encode always overlays the
 * freshest editor payload instead of the seed.
 */
export function createAdoptingStore(args: {
	readonly store: ProjectStore;
	readonly adapter: OpenCutTransactionDocumentAdapter;
}): ProjectStore {
	const { store, adapter } = args;
	const persistedSchemaVersion = store.persistedSchemaVersion?.bind(store);
	return {
		schemaVersion: store.schemaVersion,
		list: (options) => store.list(options),
		load: (options) => store.load(options),
		save: async (options) => {
			await store.save(options);
			adapter.adoptCommittedRecord(options.record);
		},
		remove: (options) => store.remove(options),
		listAttachments: (options) => store.listAttachments(options),
		loadAttachment: (options) => store.loadAttachment(options),
		saveAttachment: (options) => store.saveAttachment(options),
		removeAttachment: (options) => store.removeAttachment(options),
		listLibraryRecords: (options) => store.listLibraryRecords(options),
		loadLibraryRecord: (options) => store.loadLibraryRecord(options),
		saveLibraryRecord: (options) => store.saveLibraryRecord(options),
		removeLibraryRecord: (options) => store.removeLibraryRecord(options),
		inspect: (options) => store.inspect(options),
		clear: (options) => store.clear(options),
		persistedSchemaVersion,
	};
}

/**
 * Open the automation over the file's CURRENT editor-plane record. Used both
 * at `host start` and, verbatim, when an external editor save lands through
 * the record endpoint and the long-lived engine's in-memory state is stale —
 * the file is the SSOT, so reopen is resync.
 */
export async function openEditorPlaneAutomation(args: {
	readonly baseStore: ProjectStore;
	readonly projectId: ProjectId;
}): Promise<{
	readonly automation: AutomationApi;
	readonly adapter: OpenCutTransactionDocumentAdapter;
	readonly store: ProjectStore;
}> {
	const record = await args.baseStore.load({ id: args.projectId });
	if (record === null) {
		throw new Error(
			"The editor plane requires a prepared record; call prepareEditorProjectRecord first",
		);
	}
	const adapter = createOpenCutTransactionDocumentAdapter({
		initialRecord: record,
		initialAssets: [],
	});
	const store = createAdoptingStore({ store: args.baseStore, adapter });
	const automation = await createAutomation({
		store,
		projectId: args.projectId,
		documentAdapter: adapter,
	});
	return { automation, adapter, store };
}

/** JSON-equality helper reused by the record endpoint's parent-chain check. */
export { sameJson };
