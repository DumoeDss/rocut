import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { build, wasm, topLevelAwait } from "../browser-probe-toolchain.mjs";

export async function buildAuthorEditor({ root, artifact, isolated }) {
	const require = createRequire(join(root, "apps/vite-example/package.json"));
	const { default: react } = await import(
		pathToFileURL(require.resolve("@vitejs/plugin-react")).href
	);
	const entry = join(isolated, "opencut_wasm.js").replaceAll("\\", "/");
	const output = join(artifact, "web");
	await build({
		root,
		base: "./",
		configFile: false,
		logLevel: "error",
		publicDir: false,
		cacheDir: join(artifact, "vite-cache"),
		css: { postcss: join(root, "apps/vite-example") },
		plugins: [
			react(),
			{
				name: "author-editor-private-wasm",
				enforce: "pre",
				resolveId(id) {
					if (id === "opencut-wasm") return "\0author-editor-wasm";
				},
				load(id) {
					if (id === "\0author-editor-wasm")
						return `import init from ${JSON.stringify(entry)}; await init(); export * from ${JSON.stringify(entry)};`;
				},
				generateBundle() {
					for (const id of this.getModuleIds())
						if (/[/\\]node_modules[/\\]opencut-wasm[/\\]/.test(id))
							throw Error("Shared WASM imported");
				},
			},
			wasm(),
			topLevelAwait(),
		],
		resolve: {
			dedupe: ["react", "react-dom"],
			alias: {
				mediabunny: join(
					dirname(require.resolve("mediabunny")),
					"../modules/src/index.js",
				),
			},
		},
		build: {
			outDir: output,
			emptyOutDir: false,
			target: "esnext",
			reportCompressedSize: false,
			rollupOptions: {
				input: join(
					root,
					"script/fixtures/programmatic-build-editor-browser.html",
				),
			},
		},
	});
	return output;
}
