import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { defineConfig } from "vite";

const here = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
	root: here,
	publicDir: false,
	build: {
		outDir: "dist-surface-css",
		emptyOutDir: true,
		rollupOptions: {
			input: resolve(here, "../../packages/editor-classic/src/surface/surface.css"),
		},
	},
});
