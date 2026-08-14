import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import wasm from "vite-plugin-wasm";
import topLevelAwait from "vite-plugin-top-level-await";
// Cross-app build-tool imports, deliberately (design E5): the runtime-asset
// allowlist and the module-graph emitter stay single-source in the Vite
// example's build/ directory. This build reuses them rather than forking a
// second copy of EDITOR_RUNTIME_ASSETS — two lists drift, and the allowlist is
// the whole mechanism. Consumer↔consumer edges are outside the boundary
// checker's scope by design (D2); the Group 9 audit records this import.
import { editorAssets } from "../vite-example/build/editor-assets";
import { moduleGraph } from "../vite-example/build/module-graph";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../..");
const webPublic = resolve(repoRoot, "apps/web/public");

export default defineConfig({
	// The renderer is served from the registered `opencut://` scheme
	// (electron/main.cjs maps `opencut://app/<path>` onto this output
	// directory), so the default absolute base "/" is correct: on a
	// `standard` privileged scheme every "/…" reference in the built HTML
	// resolves against the `opencut://app` origin.
	base: "/",
	plugins: [
		react(),
		// The published `opencut-wasm` is wasm-pack `--target bundler` output;
		// this pair plus `target: "esnext"` is the configuration the Vite
		// example verified against a production build (its vite.config.ts
		// comment), reused verbatim.
		wasm(),
		topLevelAwait(),
		editorAssets({ publicRoot: webPublic, repoRoot }),
		moduleGraph({ repoRoot }),
	],
	resolve: {
		// This package, `apps/web` and the packages tree all depend on React;
		// two copies would break hooks at runtime.
		dedupe: ["react", "react-dom"],
	},
	build: {
		outDir: "dist",
		// Required by top-level await in the wasm glue.
		target: "esnext",
		rollupOptions: {
			input: {
				app: resolve(here, "index.html"),
			},
		},
	},
	// Runtime assets are copied by the explicit allowlist rather than by
	// shipping `apps/web/public` wholesale (design D7/E5).
	publicDir: false,
	server: {
		fs: {
			// The editor source lives outside this package's root.
			allow: [repoRoot],
		},
	},
});
