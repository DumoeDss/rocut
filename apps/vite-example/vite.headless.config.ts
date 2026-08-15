import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import wasm from "vite-plugin-wasm";
import topLevelAwait from "vite-plugin-top-level-await";
import { headlessModuleGraph } from "./build/headless-module-graph";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../..");
// headless-proof-control moved under the package extraction (Stage C) from
// "apps/web/src/editor/session/..." to
// "packages/editor-classic/src/editor/session/...". The swap must key on the
// specifier the entry chain actually emits today, which is the evidence
// barrel's relative "../editor/session/headless-proof-control" (packages/
// editor-classic/src/evidence/index.ts), not a "@/..." alias — no "@/"
// specifier survives anywhere under packages/ (verified: `git grep -l 'from
// "@/' -- 'packages/**'` returns zero files) or under this app's own `src/`
// (it has no "@/" path mapping in tsconfig.json either). The old `webSrc`
// generic "@" -> "apps/web/src" catch-all alias is deleted rather than
// repointed: that directory was emptied by the move, and re-pointing it
// would silently paper over any future "@/" specifier that should instead
// be a hard resolution failure.
const editorClassicSrc = resolve(repoRoot, "packages/editor-classic/src");
const outputDirectory = process.env.C7_VITE_HEADLESS_OUT_DIR;
const marker = process.env.OPENCUT_C7_BUILD_MARKER;
const acceptedHead = process.env.OPENCUT_C7_ACCEPTED_HEAD;
const acceptedTree = process.env.OPENCUT_C7_ACCEPTED_TREE;
if (!outputDirectory || !marker || !acceptedHead || !acceptedTree) {
	throw new Error(
		"C7 headless Vite build requires output, marker, accepted HEAD and accepted tree",
	);
}
const reactControl = process.env.OPENCUT_C7_REACT_CONTROL === "1";
const neutralControl = resolve(
	editorClassicSrc,
	"editor/session/headless-proof-control.ts",
);
const injectedControl = resolve(
	editorClassicSrc,
	"editor/session/headless-proof-control-react-browser.ts",
);

export default defineConfig({
	base: process.env.OPENCUT_C7_PUBLIC_BASE || "/",
	plugins: [
		// The evidence barrel this entry imports (`@opencut/editor-classic/evidence`)
		// transitively reaches the real `opencut-wasm` package via
		// c6-disposal-harness / surface-evidence-harness (see that barrel's own
		// comment). `opencut-wasm` is wasm-pack `--target bundler` output — the
		// same shape documented in the sibling `vite.config.ts`, which carries
		// this identical plugin pair for that reason. Bare Vite cannot load it;
		// without these two plugins the build fails during transform with
		// `[vite:wasm-fallback] "ESM integration proposal for Wasm" is not
		// supported currently`, before the module graph plugin below ever runs.
		wasm(),
		topLevelAwait(),
		headlessModuleGraph({
			repoRoot,
			outputRoot: relative(repoRoot, resolve(here, outputDirectory)),
			entry: "apps/vite-example/src/headless-entry.ts",
			marker,
			acceptedHead,
			acceptedTree,
		}),
	],
	resolve: {
		alias: [
			{
				find: "../editor/session/headless-proof-control",
				replacement: reactControl ? injectedControl : neutralControl,
			},
		],
	},
	define: {
		__OPENCUT_C7_BUILD_MARKER__: JSON.stringify(marker),
		__OPENCUT_C7_ACCEPTED_HEAD__: JSON.stringify(acceptedHead),
		__OPENCUT_C7_ACCEPTED_TREE__: JSON.stringify(acceptedTree),
		__OPENCUT_C7_REACT_CONTROL__: JSON.stringify(reactControl),
	},
	build: {
		outDir: outputDirectory,
		target: "esnext",
		sourcemap: true,
		rollupOptions: {
			input: resolve(here, "headless.html"),
		},
	},
	publicDir: false,
});
