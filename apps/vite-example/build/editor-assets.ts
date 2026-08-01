import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { extname, join, posix, relative, resolve } from "node:path";
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
 * 4.71 MB across 335 files, the extra being landing-page screenshots and
 * open-graph images belonging to the marketing site, with no inventory to show
 * for it.
 */
export interface EditorAsset {
	/** Path under `apps/web/public`, also the served path. */
	path: string;
	/** Whether `path` names a single file or a directory copied wholesale. */
	kind: "file" | "directory";
	category: "fonts" | "flags" | "effects" | "branding" | "favicon" | "worker-fixture";
	/** Current logical-path consumer description emitted as `requiredBy`. */
	consumer: string;
	/** The module that requests it, so a future reader can re-verify the claim. */
	requiredBy: string;
}

export const EDITOR_RUNTIME_ASSETS: EditorAsset[] = [
	{
		path: "fonts",
		kind: "directory",
		category: "fonts",
		consumer: "apps/web/src/fonts/google-fonts.ts — Host-loaded logical atlas and chunks",
		requiredBy: "apps/web/src/fonts/google-fonts.ts — fetches /fonts/font-atlas.json then /fonts/font-chunk-<n>.avif",
	},
	{
		path: "flags",
		kind: "directory",
		category: "flags",
		consumer: "apps/web/src/stickers/providers/flags.ts — Host-resolved logical flag paths",
		requiredBy: "apps/web/src/stickers/providers/flags.ts — builds /flags/<iso-code>.svg per country",
	},
	{
		path: "effects/preview.jpg",
		kind: "file",
		category: "effects",
		consumer: "apps/web/src/services/renderer/effect-preview.ts — resolver-scoped preview image",
		requiredBy: "apps/web/src/services/renderer/effect-preview.ts — the effect thumbnail source image",
	},
	{
		path: "logos/opencut",
		kind: "directory",
		category: "branding",
		consumer: "Next and Vite Host composition — resolver-owned branding.logoUrl",
		requiredBy: "apps/vite-example/src/host/vite-editor-host.tsx — supplies /logos/opencut/svg/logo.svg as branding.logoUrl",
	},
	{
		path: "favicon.ico",
		kind: "file",
		category: "favicon",
		consumer: "apps/vite-example/index.html — base-aware Host favicon",
		// Not an editor asset. Browsers request it unprompted, and without it the
		// §3.4 network capture carries a 404 that has to be explained away every
		// time someone reads it.
		requiredBy: "apps/vite-example/index.html — host chrome, not an editor runtime asset",
	},
	{
		path: "workers/c4-worker-fixture.js",
		kind: "file",
		category: "worker-fixture",
		consumer: "apps/vite-example/src/c4-worker-harness.tsx — Host rewrite and registry round trip",
		requiredBy: "C4 production verification fixture",
	},
];

export const REQUIRED_ASSET_CATEGORIES = [
	"fonts",
	"flags",
	"effects",
	"branding",
	"favicon",
	"worker-fixture",
] as const;

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
type CopiedManifestEntry = {
	path: string;
	category: EditorAsset["category"];
	expectedMime: string;
	bytes: number;
	sha256: string;
	sourcePath: string;
	requiredBy: string;
};

export function editorAssets({ publicRoot, repoRoot }: { publicRoot: string; repoRoot: string }): Plugin {
	let copiedEntries: CopiedManifestEntry[] = [];
	const manifestSource = (emitted: ReturnType<typeof summarizeBundle>) =>
		`${JSON.stringify(
			{
				generatedBy: "apps/vite-example/build/editor-assets.ts",
				build: {
					marker: process.env.VITE_C4_BUILD_MARKER ?? "development",
					base: process.env.OPENCUT_PUBLIC_BASE ?? "/",
				},
				note:
					"Two inventories. `files` are copied runtime assets; `emitted` is the distinct bundler graph. " +
					"Sizes are recorded measurements only; this Slice makes no adequacy claim.",
				source: relative(repoRoot, publicRoot).split("\\").join("/"),
				requiredCategories: REQUIRED_ASSET_CATEGORIES,
				fileCount: copiedEntries.length,
				totalBytes: copiedEntries.reduce((sum, entry) => sum + entry.bytes, 0),
				files: copiedEntries,
				excluded: EXCLUDED_PUBLIC_PATHS,
				emitted,
			},
			null,
			2,
		)}\n`;
	return {
		name: "opencut-editor-assets",
		generateBundle(_options, bundle) {
			const entries: CopiedManifestEntry[] = [];

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
						path: file.served,
						category: asset.category,
						expectedMime: expectedMime(file.served),
						bytes: contents.byteLength,
						sha256: createHash("sha256").update(contents).digest("hex"),
						sourcePath: relative(repoRoot, file.absolute).split("\\").join("/"),
						requiredBy: asset.consumer,
					});
				}
			}

			entries.sort((a, b) => a.path.localeCompare(b.path));
			copiedEntries = entries;

			this.emitFile({
				type: "asset",
				fileName: "asset-manifest.json",
				source: manifestSource(
					summarizeBundle(bundle, new Set(entries.map((entry) => entry.path))),
				),
			});
		},
		writeBundle(options, bundle) {
			if (!options.dir) this.error("editor-assets: Vite output directory is required");
			const outputDir = resolve(options.dir);
			writeFileSync(
				resolve(outputDir, "asset-manifest.json"),
				manifestSource(
					summarizeBundle(
						bundle,
						new Set(copiedEntries.map((entry) => entry.path)),
						outputDir,
					),
				),
			);
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
function summarizeBundle(
	bundle: Record<string, unknown>,
	copiedPaths: ReadonlySet<string>,
	outputDir?: string,
) {
	const items = Object.values(bundle).flatMap((item) => {
		const output = item as {
			type: string;
			fileName: string;
			code?: string;
			source?: string | Uint8Array;
			isEntry?: boolean;
			isDynamicEntry?: boolean;
		};
		if (
			copiedPaths.has(output.fileName) ||
			output.fileName === "asset-manifest.json" ||
			output.fileName === "module-graph.json"
		) {
			return [];
		}

		const writtenPath = outputDir ? resolve(outputDir, output.fileName) : null;
		const contents = writtenPath
			? readFileSync(writtenPath)
			: output.type === "chunk"
				? Buffer.from(output.code ?? "")
				: typeof output.source === "string"
					? Buffer.from(output.source)
					: Buffer.from(output.source ?? new Uint8Array());

		return [{
			path: output.fileName,
			kind: output.type,
			classification: classifyEmitted(output.fileName, output.isEntry === true),
			expectedMime: expectedMime(output.fileName),
			bytes: contents.byteLength,
			sha256: createHash("sha256").update(contents).digest("hex"),
			isEntry: output.isEntry === true,
			isDynamicEntry: output.isDynamicEntry === true,
		}];
	});

	items.sort((a, b) => b.bytes - a.bytes);
	return { fileCount: items.length, totalBytes: items.reduce((sum, i) => sum + i.bytes, 0), files: items };
}

function expectedMime(path: string): string {
	switch (extname(path).toLowerCase()) {
		case ".json":
			return "application/json";
		case ".avif":
			return "image/avif";
		case ".svg":
			return "image/svg+xml";
		case ".jpg":
		case ".jpeg":
			return "image/jpeg";
		case ".ico":
			return "image/x-icon";
		case ".js":
			return "text/javascript|application/javascript";
		case ".css":
			return "text/css";
		case ".html":
			return "text/html";
		case ".wasm":
			return "application/wasm";
		default:
			return "application/octet-stream";
	}
}

function classifyEmitted(path: string, isEntry: boolean): string {
	if (isEntry) return "entry";
	if (/opencut_wasm.*\.wasm$/i.test(path)) return "editor-wasm";
	if (/ort-wasm.*\.wasm$/i.test(path)) return "ort-sidecar";
	if (/(?:^|\/)worker-[^/]+\.js$/i.test(path)) return "transcription-worker";
	if (/\.wasm$/i.test(path)) return "wasm";
	if (/\.js$/i.test(path)) return "chunk";
	return "asset";
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
