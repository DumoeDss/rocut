import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import { headlessModuleGraph } from "./build/headless-module-graph";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../..");
const webSrc = resolve(repoRoot, "apps/web/src");
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
	webSrc,
	"editor/session/headless-proof-control.ts",
);
const injectedControl = resolve(
	webSrc,
	"editor/session/headless-proof-control-react-browser.ts",
);

export default defineConfig({
	base: process.env.OPENCUT_C7_PUBLIC_BASE || "/",
	plugins: [
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
				find: "@/editor/session/headless-proof-control",
				replacement: reactControl ? injectedControl : neutralControl,
			},
			{ find: "@", replacement: webSrc },
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
