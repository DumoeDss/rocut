/**
 * Where a change's browser evidence belongs *right now*.
 *
 * A change's `evidence/` directory only exists while the change is active;
 * `rasen archive` moves the whole change under `rasen/changes/archive/`. A path
 * frozen at authoring time therefore stops meaning what it said the moment the
 * change ships, and does so silently: the writer recreates the archived
 * change's directory and fills it with fresh output. That output looks like an
 * active change to anyone reading `rasen/changes/`, and — if the change had
 * *not* yet been archived — a later slice's regression run would have
 * overwritten evidence that was still live.
 *
 * So the destination is resolved, never assumed:
 *
 * - the change is **active** → its own `evidence/` directory, as before;
 * - the change is **archived** → a neutral regression directory, because a run
 *   after the ship is a check that nothing regressed, not new evidence for a
 *   closed change. It must never be mistaken for the committed record, and it
 *   must never touch it.
 *
 * A resurrected directory containing only `evidence/` is *not* an active
 * change: activeness is decided by the change manifest `.openspec.yaml`, so a
 * directory this resolver previously created cannot make itself look live.
 */
import { existsSync } from "node:fs";
import { resolve } from "node:path";

export interface EvidenceDestination {
	/** Absolute directory to write into. */
	readonly dir: string;
	/** True when the change has shipped and this is regression output. */
	readonly archived: boolean;
}

/** The change directory counts as active only with its manifest present. */
function activeChangeDir(args: {
	readonly repoRoot: string;
	readonly change: string;
}): string | null {
	const dir = resolve(args.repoRoot, "rasen/changes", args.change);
	return existsSync(resolve(dir, ".openspec.yaml")) ? dir : null;
}

/**
 * @param leaf path under the change's `evidence/`, e.g. `browser-agent/vite`.
 */
export function evidenceDestination(args: {
	readonly repoRoot: string;
	readonly change: string;
	readonly leaf: string;
}): EvidenceDestination {
	const active = activeChangeDir(args);
	if (active !== null) {
		return { dir: resolve(active, "evidence", args.leaf), archived: false };
	}
	return {
		dir: resolve(
			args.repoRoot,
			"apps/vite-example/tests/parity-artifacts/regression",
			args.change,
			args.leaf,
		),
		archived: true,
	};
}

/**
 * The same destination as a path relative to `apps/vite-example`, which is what
 * Playwright's `reporter` option resolves against.
 */
export function evidenceOutputFile(args: {
	readonly repoRoot: string;
	readonly change: string;
	readonly leaf: string;
	readonly file: string;
}): string {
	const { dir } = evidenceDestination(args);
	return resolve(dir, args.file);
}
