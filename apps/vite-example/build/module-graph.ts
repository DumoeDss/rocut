import { relative } from "node:path";
import type { Plugin } from "vite";

/**
 * Emits `dist/module-graph.json`: every module Rollup pulled into the production
 * bundle, as a repo-relative path.
 *
 * This is the authoritative input to `script/check-distributable-boundary.mjs`
 * (design D5). The alternative — grepping the emitted JavaScript — was tried and
 * is actively misleading: `next/image` matches twice in the built output, both
 * times inside `@huggingface/transformers`' `convnext/image_processing_convnext.js`,
 * where the substring falls across `conv` + `next/image`. Minification also
 * renames identifiers, so text search produces false positives and false
 * negatives in both directions. The Rollup module-id set is exactly "what got
 * into the bundle" and is diffable between builds.
 */
export function moduleGraph({ repoRoot }: { repoRoot: string }): Plugin {
	return {
		name: "opencut-module-graph",
		// Emitting from `generateBundle` puts the file through Rollup's own asset
		// pipeline, so it lands in `dist/` under whatever `outDir` is configured
		// rather than at a path this plugin has to guess.
		generateBundle() {
			const ids = [...this.getModuleIds()];

			const modules = ids
				.map((id) => normalizeId({ id, repoRoot }))
				.sort((a, b) => a.localeCompare(b));

			this.emitFile({
				type: "asset",
				fileName: "module-graph.json",
				source: `${JSON.stringify(
					{
						generatedBy: "apps/vite-example/build/module-graph.ts",
						note:
							"Every module id Rollup included in the production build, relative to " +
							"the repo root where possible. Virtual and plugin-generated ids are " +
							"kept verbatim so they remain assertable.",
						moduleCount: modules.length,
						modules,
					},
					null,
					2,
				)}\n`,
			});
		},
	};
}

/**
 * Rollup ids are absolute OS paths for real files, but plugins also produce
 * virtual ids (conventionally `\0`-prefixed) and query-suffixed ids such as
 * `…/worker.ts?worker`. Real paths become repo-relative POSIX so the check is
 * machine-independent; everything else is kept verbatim, because a virtual
 * module is exactly the kind of thing the boundary check needs to be able to
 * see — `content-collections` would appear this way.
 */
function normalizeId({ id, repoRoot }: { id: string; repoRoot: string }): string {
	if (id.startsWith("\0")) return id;

	const [path, query] = splitQuery(id);
	const rel = relative(repoRoot, path);
	if (rel.startsWith("..") || rel === "") return id;

	return rel.split("\\").join("/") + query;
}

function splitQuery(id: string): [string, string] {
	const index = id.search(/[?#]/);
	return index === -1 ? [id, ""] : [id.slice(0, index), id.slice(index)];
}
