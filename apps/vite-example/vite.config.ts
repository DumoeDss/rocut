import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import wasm from "vite-plugin-wasm";
import topLevelAwait from "vite-plugin-top-level-await";
import { editorAssets } from "./build/editor-assets";
import { moduleGraph } from "./build/module-graph";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../..");
const webSrc = resolve(repoRoot, "apps/web/src");
const webPublic = resolve(repoRoot, "apps/web/public");
const publicBase = process.env.OPENCUT_PUBLIC_BASE || "/";
const outputDirectory = process.env.C4_VITE_OUT_DIR || "dist";

export default defineConfig({
	base: publicBase,
	plugins: [
		react(),
		// The published `opencut-wasm` is wasm-pack `--target bundler` output: its
		// entry imports the `.wasm` module directly and calls `__wbindgen_start()`.
		// Bare Vite cannot process that; this pair plus `target: "esnext"` is the
		// configuration verified against a production build by the planning spike.
		wasm(),
		topLevelAwait(),
		// Copies the runtime-asset allowlist out of `apps/web/public` and emits
		// `dist/asset-manifest.json` from that same list (design D7).
		editorAssets({ publicRoot: webPublic, repoRoot }),
		// Emits `dist/module-graph.json`, the authoritative input to the
		// distributable-boundary check (design D5).
		moduleGraph({ repoRoot }),
	],
	resolve: {
		alias: {
			// One source tree, two hosts. The editor is aliased rather than copied,
			// so `apps/web` stays a live regression check against the same files.
			"@": webSrc,
		},
		// Both this package and `apps/web` depend on React; two copies would break
		// hooks at runtime.
		dedupe: ["react", "react-dom"],
	},
	build: {
		outDir: outputDirectory,
		// Required by top-level await in the wasm glue.
		target: "esnext",
	},
	// Runtime assets are copied by an explicit allowlist rather than by shipping
	// all 5.4 MB of `apps/web/public`. See design D7.
	publicDir: false,
	server: {
		fs: {
			// The editor source lives outside this package's root.
			allow: [repoRoot],
		},
	},
});
