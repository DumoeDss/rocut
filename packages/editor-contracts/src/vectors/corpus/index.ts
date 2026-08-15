/**
 * The published corpus entry — data-reachability for an installed consumer
 * (S05 P3, spec §3.5's installed-consumption scenario).
 *
 * The runner, loader and coverage gate take **text and data, never paths** —
 * that is what keeps them runnable anywhere. The file-READING layer was
 * test-only (`vectors/__tests__/corpus-fixture.ts`, unreachable from a
 * declared entry), so an installed consumer could reach the runner and not the
 * data it runs. This entry is the published form of that layer: a Node/bun
 * fs-read of the corpus JSONs shipped beside this module (`files: ["src", …]`
 * packs them into the tarball), relative to `import.meta.url`.
 *
 * **Node/bun shaped by design.** `readPublishedCorpusText` is deliberately the
 * path-taking edge the runner refuses to be: it uses `node:fs`, so it loads in
 * Node, bun and any bundler that shims `node:fs` — not in a bare browser. A
 * browser consumer composes from the data-taking surface instead
 * (`loadTransactionVectorCorpus({ manifestText, files, contract })` with the
 * texts fetched by its own means); that surface is unchanged.
 *
 * Exact bytes, deliberately not a static JSON import: the manifest's corpus
 * digest is computed over the committed file bytes, and a parsed-then-
 * re-stringified object serializes to different bytes — a consumer whose
 * published corpus fails its own manifest is a self-inflicted §3.5 failure.
 * `readFileSync` returns the file as it sits on disk.
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type { ContractSurface } from "../contract-surface";

const HERE = dirname(fileURLToPath(import.meta.url));

/**
 * The committed corpus as exact file bytes: the manifest text plus every
 * corpus file keyed by its bare filename (the manifest's own `path` form).
 */
export interface PublishedCorpusText {
	readonly manifestText: string;
	readonly files: Readonly<Record<string, string>>;
}

/**
 * Read the shipped corpus JSONs beside this module, returning their exact
 * bytes. Pass the result to `loadTransactionVectorCorpus` together with
 * {@link PUBLISHED_CONTRACT_SURFACE} (or a surface you derived yourself) — the
 * loader recomputes every digest and refuses drift, so this function's
 * contract is simply "the bytes that are committed".
 */
export function readPublishedCorpusText(): PublishedCorpusText {
	const manifestText = readFileSync(join(HERE, "manifest.json"), "utf8");
	const files: Record<string, string> = {};
	for (const name of readdirSync(HERE)) {
		if (!name.endsWith(".json") || name === "manifest.json") continue;
		files[name] = readFileSync(join(HERE, name), "utf8");
	}
	return { manifestText, files };
}

/**
 * The frozen contract surface as data: the operation kinds the contract
 * exports, its transaction error codes, and the engine's issue codes.
 *
 * Static data rather than a parse, because a browser or data-only consumer
 * should not have to read the contract's TypeScript sources to know what the
 * corpus may reference. Guarded against drift in-repository: the committed
 * test asserts this equals `parseContractSurface(readContractSources())`, so a
 * contract export added without updating this constant fails the suite.
 */
export const PUBLISHED_CONTRACT_SURFACE: ContractSurface = {
	operationKinds: [
		"create-track",
		"update-track",
		"delete-track",
		"create-clip",
		"update-clip",
		"delete-clip",
		"create-asset",
		"delete-asset",
		"create-marker",
		"update-marker",
		"delete-marker",
		"update-project",
	],
	errorCodes: [
		"conflict",
		"validation",
		"not-found",
		"duplicate",
		"unsupported",
	],
	issueCodes: [
		"empty-batch",
		"duplicate-id",
		"missing-relation",
		"not-found",
		"unsupported-operation",
		"expected-revision-conflict",
		"idempotency-conflict",
		"invalid-entity",
		"non-positive-duration",
		"timebase-misaligned",
		"collision",
		"lane-incompatible",
		"source-out-of-bounds",
	],
};
