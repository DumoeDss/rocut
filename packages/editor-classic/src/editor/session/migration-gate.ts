import type { ResolvedEditorHost } from "@opencut/editor-ports/host";
import type { MigrationProgress, SessionDiagnostics } from "@opencut/editor-ports";

/** One in-flight or completed migration promise per injected store identity. */
const migrationRuns = new WeakMap<object, Promise<void>>();

/** Raised when the store reports that its migration failed. */
export class MigrationFailedError extends Error {
	constructor({
		from,
		to,
		reason,
	}: {
		from: number | null;
		to: number;
		reason: string;
	}) {
		super(
			`The project store's migration failed (${from ?? "unknown"} -> ${to}): ${reason}. ` +
				"The session was not created; the editor must not run against data the store " +
				"reports as un-migrated.",
		);
		this.name = "MigrationFailedError";
	}
}

/**
 * Bring one Host store to its declared schema version before either kind of
 * session can observe project data or construct an editor.
 */
export function runStoreMigrationOnce(args: {
	host: ResolvedEditorHost;
	diagnostics: SessionDiagnostics;
	onProgress: (progress: MigrationProgress) => void;
}): Promise<void> {
	const { host, diagnostics, onProgress } = args;
	const store = host.store;
	if (!store.migrate) return Promise.resolve();

	const existing = migrationRuns.get(store);
	if (existing) return existing;

	const run = (async () => {
		const to = store.schemaVersion;
		const from = (await store.persistedSchemaVersion?.()) ?? null;

		diagnostics.event({ event: { kind: "migration-started", from, to } });
		const outcome = await store.migrate!({
			from,
			to,
			report: (progress) => {
				onProgress(progress);
				diagnostics.event({ event: { kind: "migration-progress", progress } });
			},
		});

		if (outcome.status === "failed") {
			diagnostics.event({
				event: {
					kind: "migration-failed",
					from: outcome.from,
					to: outcome.to,
					reason: outcome.reason,
				},
			});
			throw new MigrationFailedError({
				from: outcome.from,
				to: outcome.to,
				reason: outcome.reason,
			});
		}

		diagnostics.event({
			event: {
				kind: "migration-finished",
				from: outcome.status === "migrated" ? outcome.from : from,
				to: outcome.status === "migrated" ? outcome.to : to,
				recordsMigrated:
					outcome.status === "migrated" ? outcome.recordsMigrated : 0,
			},
		});
	})();

	const memoized = run.catch((error: unknown) => {
		migrationRuns.delete(store);
		throw error;
	});
	migrationRuns.set(store, memoized);
	return memoized;
}
