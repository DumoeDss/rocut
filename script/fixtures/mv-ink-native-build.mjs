import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { lstatSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, isAbsolute, join, relative } from "node:path";
import { build, wasm, topLevelAwait } from "../browser-probe-toolchain.mjs";

/** Bind the actual Vite-loaded repository sources, not a hand-picked subset. */
export async function buildInkNative({ root, isolated, output }) {
	const require = createRequire(
		join(root, "packages/editor-classic/package.json"),
	);
	const entry = join(isolated, "opencut_wasm.js").replaceAll("\\", "/");
	const inputs = new Map();
	const identity = (path) =>
		createHash("sha256").update(readFileSync(path)).digest("hex");
	await build({
		root,
		configFile: false,
		logLevel: "error",
		plugins: [
			{
				name: "ink-loaded-source-identity",
				enforce: "pre",
				load(id) {
					if (id.startsWith("\0")) return null;
					const path = id.split("?")[0],
						rel = relative(root, path).replaceAll("\\", "/");
					if (
						!rel ||
						rel.startsWith("../") ||
						isAbsolute(rel) ||
						rel.includes("/node_modules/") ||
						rel.startsWith("node_modules/") ||
						!/\.(?:m?[jt]sx?|json|html|css)$/.test(rel)
					)
						return null;
					const stat = lstatSync(path);
					assert.ok(
						stat.isFile() && !stat.isSymbolicLink(),
						"Ink loaded source must not redirect",
					);
					const sha256 = identity(path);
					if (inputs.has(rel))
						assert.equal(
							inputs.get(rel),
							sha256,
							"Source changed between loads",
						);
					inputs.set(rel, sha256);
					return null;
				},
				generateBundle() {
					for (const id of this.getModuleIds())
						assert.ok(
							!/[/\\]node_modules[/\\]opencut-wasm[/\\]/.test(id),
							"Ink resolved shared stale WASM",
						);
					for (const [path, sha256] of inputs)
						assert.equal(
							identity(join(root, path)),
							sha256,
							"Source changed during bundle build",
						);
				},
			},
			{
				name: "ink-isolated-wasm",
				enforce: "pre",
				resolveId(id) {
					if (id === "opencut-wasm") return "\0ink-isolated-wasm";
				},
				load(id) {
					if (id === "\0ink-isolated-wasm")
						return `import init from ${JSON.stringify(entry)}; await init(); export * from ${JSON.stringify(entry)};`;
				},
			},
			wasm(),
			topLevelAwait(),
		],
		resolve: {
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
				input: join(root, "script/fixtures/mv-ink-native-browser.html"),
			},
		},
	});
	return [...inputs]
		.sort(([a], [b]) => a.localeCompare(b))
		.map(([path, sha256]) => ({ path, sha256 }));
}
