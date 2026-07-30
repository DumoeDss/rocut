import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, posix, relative, resolve } from "node:path";
import type { Plugin } from "vite";

/**
 * Runtime assets the editor fetches by absolute path at run time, and therefore
 * cannot be discovered by bundling.
 *
 * This list is the whole mechanism (design D7). `publicDir` is disabled and
 * nothing is copied except what appears here, so an asset the editor needs but
 * this list omits fails loudly with a 404 during the smoke run instead of being
 * shipped by accident. The same list is emitted as `dist/asset-manifest.json`,
 * which is why there is no second inventory to drift out of sync — the
 * allowlist *is* the §3.4 manifest.
 *
 * Copying all of `apps/web/public` instead would work in one line and ship
 * 5.4 MB, most of it landing-page screenshots and open-graph images belonging to
 * the marketing site, with no inventory to show for it.
 */
export interface EditorAsset {
	/** Path under `apps/web/public`, also the served path. */
	path: string;
	/** Whether `path` names a single file or a directory copied wholesale. */
	kind: "file" | "directory";
	/** The module that requests it, so a future reader can re-verify the claim. */
	requiredBy: string;
}

export const EDITOR_RUNTIME_ASSETS: EditorAsset[] = [
	{
		path: "fonts",
		kind: "directory",
		requiredBy: "apps/web/src/fonts/google-fonts.ts — fetches /fonts/font-atlas.json then /fonts/font-chunk-<n>.avif",
	},
	{
		path: "flags",
		kind: "directory",
		requiredBy: "apps/web/src/stickers/providers/flags.ts — builds /flags/<iso-code>.svg per country",
	},
	{
		path: "effects/preview.jpg",
		kind: "file",
		requiredBy: "apps/web/src/services/renderer/effect-preview.ts — the effect thumbnail source image",
	},
	{
		path: "logos/opencut",
		kind: "directory",
		requiredBy: "apps/vite-example/src/host/vite-editor-host.tsx — supplies /logos/opencut/svg/logo.svg as branding.logoUrl",
	},
	{
		path: "favicon.ico",
		kind: "file",
		// Not an editor asset. Browsers request it unprompted, and without it the
		// §3.4 network capture carries a 404 that has to be explained away every
		// time someone reads it.
		requiredBy: "apps/vite-example/index.html — host chrome, not an editor runtime asset",
	},
];

/**
 * Deliberately excluded, recorded so the omission reads as a decision rather
 * than an oversight. Confirmed unreferenced by scanning `apps/web/src` for
 * absolute paths, and re-confirmed by the network capture of the served build.
 */
export const EXCLUDED_PUBLIC_PATHS = [
	{ path: "shapes", reason: "The shapes sticker provider generates SVG presets in code (stickers/providers/shapes.ts); nothing fetches /shapes." },
	{ path: "platform-guides", reason: "Platform guide artwork is loaded from the remote cdn.brandfetch.io, a §3.7 diagnostic-only dependency." },
	{ path: "open-graph", reason: "Social preview images for the marketing site; no editor code path reads them." },
	{ path: "landing-page-dark.png", reason: "Landing page screenshot; the landing page is excluded from the distributable graph." },
	{ path: "logos/others", reason: "Sponsor logos, referenced only by site/sponsors.ts, which is product-shell code." },
	{ path: "icons", reason: "PWA icon set referenced from manifest.json; the example ships no web app manifest." },
	{ path: "manifest.json", reason: "PWA manifest for the marketing site." },
	{ path: "browserconfig.xml", reason: "Legacy IE/Edge tile configuration." },
	{ path: "_headers", reason: "Cloudflare Pages header rules for the deployed site, not an asset." },
];

/**
 * Copies the allowlist out of `apps/web/public` and emits the manifest.
 *
 * Both happen through Rollup's asset pipeline rather than direct filesystem
 * writes, so the copied files are part of the build's own output accounting and
 * land under whatever `outDir` is configured.
 */
export function editorAssets({ publicRoot, repoRoot }: { publicRoot: string; repoRoot: string }): Plugin {
	return {
		name: "opencut-editor-assets",
		generateBundle(_options, bundle) {
			const entries: Array<{ path: string; bytes: number; sha256: string; requiredBy: string }> = [];

			for (const asset of EDITOR_RUNTIME_ASSETS) {
				const source = resolve(publicRoot, asset.path);
				const files =
					asset.kind === "directory"
						? listFiles(source).map((absolute) => ({
								absolute,
								served: posix.join(asset.path, relative(source, absolute).split("\\").join("/")),
							}))
						: [{ absolute: source, served: asset.path }];

				if (files.length === 0) {
					this.error(
						`editor-assets: "${asset.path}" matched no files under ${publicRoot}. ` +
							"The allowlist is the manifest, so an entry that copies nothing is a defect, not a no-op.",
					);
				}

				for (const file of files) {
					const contents = readFileSync(file.absolute);
					this.emitFile({ type: "asset", fileName: file.served, source: contents });
					entries.push({
						path: `/${file.served}`,
						bytes: contents.byteLength,
						sha256: createHash("sha256").update(contents).digest("hex"),
						requiredBy: asset.requiredBy,
					});
				}
			}

			entries.sort((a, b) => a.path.localeCompare(b.path));

			this.emitFile({
				type: "asset",
				fileName: "asset-manifest.json",
				source: `${JSON.stringify(
					{
						generatedBy: "apps/vite-example/build/editor-assets.ts",
						note:
							"Two inventories. `files` are runtime assets copied from apps/web/public by the " +
							"explicit allowlist — the editor fetches them by absolute path, so bundling " +
							"cannot discover them. `emitted` is what the bundler produced. Sizes are " +
							"recorded measurements only; this Slice makes no claim that any of them is " +
							"adequate (spec §5 excludes performance claims).",
						source: relative(repoRoot, publicRoot).split("\\").join("/"),
						fileCount: entries.length,
						totalBytes: entries.reduce((sum, entry) => sum + entry.bytes, 0),
						files: entries,
						excluded: EXCLUDED_PUBLIC_PATHS,
						emitted: summarizeBundle(bundle),
					},
					null,
					2,
				)}\n`,
			});
		},
	};
}

/**
 * What the bundler itself produced, so the inventory covers the whole
 * distributable rather than only the copied half.
 *
 * `isEntry` is the load-path signal that matters here. The largest artifact by
 * far is `ort-wasm-simd-threaded.jsep.wasm` (~21.6 MB) from
 * `@huggingface/transformers`, reached only through the transcription Worker.
 * It is emitted into `dist/` but is not referenced by the entry chunk and is not
 * fetched on load — the Worker is constructed on demand inside
 * `services/transcription/service.ts`. Recorded, not judged.
 */
function summarizeBundle(bundle: Record<string, unknown>) {
	const items = Object.values(bundle).map((item) => {
		const output = item as {
			type: string;
			fileName: string;
			code?: string;
			source?: string | Uint8Array;
			isEntry?: boolean;
			isDynamicEntry?: boolean;
		};

		const bytes =
			output.type === "chunk"
				? Buffer.byteLength(output.code ?? "")
				: typeof output.source === "string"
					? Buffer.byteLength(output.source)
					: (output.source?.byteLength ?? 0);

		return {
			path: `/${output.fileName}`,
			kind: output.type,
			bytes,
			isEntry: output.isEntry === true,
			isDynamicEntry: output.isDynamicEntry === true,
		};
	});

	items.sort((a, b) => b.bytes - a.bytes);
	return { fileCount: items.length, totalBytes: items.reduce((sum, i) => sum + i.bytes, 0), files: items };
}

function listFiles(root: string): string[] {
	let stat;
	try {
		stat = statSync(root);
	} catch {
		return [];
	}
	if (!stat.isDirectory()) return [root];

	return readdirSync(root, { withFileTypes: true }).flatMap((entry) =>
		entry.isDirectory() ? listFiles(join(root, entry.name)) : [join(root, entry.name)],
	);
}
