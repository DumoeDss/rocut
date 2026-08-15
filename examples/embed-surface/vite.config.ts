import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import wasm from "vite-plugin-wasm";
import topLevelAwait from "vite-plugin-top-level-await";

/**
 * The published packages ship TypeScript from `./src`, so Vite builds the
 * editor directly out of `node_modules/@opencut/*` — no dist step, no alias,
 * the export map is the only mapping. The plugin pair plus `target: "esnext"`
 * is the configuration the in-repo planning spike verified for wasm-pack
 * `--target bundler` output: the glue's top-level `__wbindgen_start()` call
 * needs top-level await.
 *
 * `public/` holds this example's own minimal committed asset set — the files
 * the editor fetches by absolute path at run time (see README).
 */
export default defineConfig({
	plugins: [react(), wasm(), topLevelAwait()],
	resolve: {
		// React must resolve to this example's own copy for both the host app
		// and the editor, or hooks break across the boundary.
		dedupe: ["react", "react-dom"],
	},
	build: {
		target: "esnext",
		outDir: "dist",
	},
});
