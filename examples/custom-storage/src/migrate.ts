/**
 * Migration by replication (S05 P3, design E7).
 *
 * The published classic package owns the migration chain; this adapter walks
 * that chain over ITS OWN records -- snapshot, transform each outdated record
 * step by step, replace all-or-nothing. A transform that declines (skipped) is
 * a typed failure, never a silent break: fail-closed is the contract, and the
 * disposable demo below proves the adapter honors it.
 *
 * The classic specifier appears ONLY in this module, behind a dynamic import:
 * if the chain cannot load in a given environment (the historical
 * phantom-dependency finding, fixed by the LEAD ruling of 2026-08-15 --
 * culori + opencut-wasm declared, react-free entry added), the failure is
 * confined to the migration leg and reported as a finding, not a crash of
 * the whole run.
 */
import type {
	MigrationContext,
	MigrationOutcome,
	ProjectId,
} from "@opencut/editor-ports";

import { AlienProjectStore } from "./alien-store";

/** The step surface the walk needs -- classic's StorageMigration satisfies it. */
export interface LegacyMigrationStep {
	readonly from: number;
	readonly to: number;
	run(args: {
		projectId: string;
		project: Record<string, unknown>;
	}): Promise<{
		project: Record<string, unknown>;
		skipped: boolean;
		reason?: string;
	}>;
}

export interface LegacyMigrationChain {
	readonly steps: readonly LegacyMigrationStep[];
	readonly target: number;
}

/**
 * Load the published chain from the classic package. Returns `null` when the
 * package cannot resolve or initialize -- the caller records that as a
 * finding, with the observed reason attached.
 */
export async function loadClassicMigrationChain(): Promise<
	LegacyMigrationChain | null
> {
	try {
		// The LEAD-ruled react-free entry (2026-08-15): this consumer has no
		// react anywhere in its tree, so the migration chain loads through
		// ./storage/migrations, never the react-carrying ./storage barrel.
		const classic = (await import(
			"@opencut/editor-classic/storage/migrations"
		)) as {
			migrations: readonly LegacyMigrationStep[];
			CURRENT_PROJECT_VERSION: number;
		};
		return {
			steps: classic.migrations,
			target: classic.CURRENT_PROJECT_VERSION,
		};
	} catch (error) {
		classicChainFailure = error instanceof Error ? error.message : String(error);
		return null;
	}
}

/** The observed reason the classic chain could not be loaded, if it failed. */
export let classicChainFailure: string | null = null;

/**
 * Build the store's `migrate` over a published chain: all-or-nothing,
 * fail-closed, monotone progress, and `not-needed` once everything is current.
 */
export function createLegacyMigrator(args: {
	store: AlienProjectStore;
	chain: LegacyMigrationChain;
}): (ctx: MigrationContext) => Promise<MigrationOutcome> {
	const { store, chain } = args;
	const byFrom = new Map<number, LegacyMigrationStep>();
	for (const step of chain.steps) byFrom.set(step.from, step);

	return async (ctx: MigrationContext): Promise<MigrationOutcome> => {
		const snapshot = store.legacySnapshot();
		const outdated = snapshot.filter(
			(entry) => entry.schemaVersion < chain.target,
		);
		if (outdated.length === 0) {
			return { status: "not-needed" };
		}

		const from = Math.min(...outdated.map((entry) => entry.schemaVersion));
		const updated: {
			id: ProjectId;
			schemaVersion: number;
			data: unknown;
		}[] = [];
		let completed = 0;
		for (const entry of snapshot) {
			if (entry.schemaVersion >= chain.target) {
				updated.push({
					id: entry.id,
					schemaVersion: entry.schemaVersion,
					data: entry.data,
				});
				continue;
			}
			// The classic chain consumes the record as one legacy document with
			// the identity at the top level; our store keeps it inside `data`.
			let legacy: Record<string, unknown>;
			if (
				typeof entry.data === "object" &&
				entry.data !== null &&
				!Array.isArray(entry.data)
			) {
				legacy = { ...(entry.data as Record<string, unknown>), id: entry.id };
			} else {
				legacy = { id: entry.id };
			}
			let version = entry.schemaVersion;
			while (version < chain.target) {
				const step = byFrom.get(version);
				if (!step) {
					return {
						status: "failed",
						from,
						to: chain.target,
						reason: `no published migration step from version ${version}`,
					};
				}
				let outcome: {
					project: Record<string, unknown>;
					skipped: boolean;
					reason?: string;
				};
				try {
					outcome = await step.run({
						projectId: entry.id,
						project: legacy,
					});
				} catch (error) {
					return {
						status: "failed",
						from,
						to: chain.target,
						reason: `migration step ${version}->${step.to} threw: ${
							error instanceof Error ? error.message : String(error)
						}`,
					};
				}
				if (outcome.skipped) {
					return {
						status: "failed",
						from,
						to: chain.target,
						reason:
							outcome.reason ??
							`migration step ${version}->${step.to} declined the record`,
					};
				}
				legacy = outcome.project;
				version = step.to;
			}
			updated.push({
				id: entry.id,
				schemaVersion: chain.target,
				data: legacy,
			});
			completed += 1;
			ctx.report({ completed, total: outdated.length });
		}
		store.legacyReplace(updated);
		return {
			status: "migrated",
			from,
			to: chain.target,
			recordsMigrated: outdated.length,
		};
	};
}

/**
 * A disposable migration demonstration, on its own store:
 *
 * 1. A legacy-shaped record at the previous published version migrates to the
 *    target and reports monotone progress to completion.
 * 2. A second call is `not-needed`.
 * 3. A record the chain declines (no project identity) is a typed `failed`
 *    outcome -- fail-closed, not a break.
 *
 * Returns a textual transcript for the run log; throws only if the semantics
 * are wrong.
 */
export async function demonstrateLegacyMigration(
	chain: LegacyMigrationChain,
): Promise<string> {
	const lines: string[] = [];

	const good = new AlienProjectStore({ schemaVersion: chain.target });
	const goodIdentity = "alien-legacy-demo-good";
	await good.seedLegacy({
		id: goodIdentity as ProjectId,
		schemaVersion: chain.target - 1,
		data: { version: chain.target - 1, title: "Alien legacy record" },
	});
	good.migrate = createLegacyMigrator({ store: good, chain });
	const progress: { completed: number; total: number }[] = [];
	const migrated = await good.migrate({
		from: null,
		to: good.schemaVersion,
		report: (p) => progress.push({ completed: p.completed, total: p.total }),
	});
	if (migrated.status !== "migrated") {
		throw new Error(
			`legacy demo: expected migrated, got ${migrated.status}${
				migrated.status === "failed" ? ` (${migrated.reason})` : ""
			}`,
		);
	}
	const record = await good.load({ id: goodIdentity as ProjectId });
	if (!record || record.schemaVersion !== chain.target) {
		throw new Error("legacy demo: record did not reach the target version");
	}
	lines.push(
		`disposable legacy record: migrated ${migrated.from}->${migrated.to}, ` +
			`progress ${progress.map((p) => `${p.completed}/${p.total}`).join(" ")}`,
	);
	const second = await good.migrate({
		from: good.schemaVersion,
		to: good.schemaVersion,
		report: () => {},
	});
	if (second.status !== "not-needed") {
		throw new Error(
			`legacy demo: second call should be not-needed, got ${second.status}`,
		);
	}
	lines.push("second migration call: not-needed");

	const bad = new AlienProjectStore({ schemaVersion: chain.target });
	const badIdentity = "alien-legacy-demo-declined";
	await bad.seedLegacy({
		id: badIdentity as ProjectId,
		schemaVersion: chain.target - 1,
		// A version the published transform must decline: not a number. The
		// real chain says "invalid version" and the walk turns that into a
		// typed failure -- fail-closed against the published artifact itself.
		data: { version: "thirty", title: "Alien declined record" },
	});
	bad.migrate = createLegacyMigrator({ store: bad, chain });
	const failed = await bad.migrate({
		from: null,
		to: bad.schemaVersion,
		report: () => {},
	});
	if (failed.status !== "failed") {
		throw new Error(
			`legacy demo: a declining transform must fail closed, got ${failed.status}`,
		);
	}
	lines.push(`declining transform: failed closed (${failed.reason})`);

	return lines.join("\n");
}
