import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { lstatSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, isAbsolute, join, relative } from "node:path";
import { build, wasm, topLevelAwait } from "../browser-probe-toolchain.mjs";
export async function buildTunnelNative({ root, isolated, output }) {
	const require = createRequire(
		join(root, "packages/editor-classic/package.json"),
	);
	const entry = join(isolated, "opencut_wasm.js").replaceAll("\\", "/");
	const inputs = new Map();
	const digest = (path) =>
		createHash("sha256").update(readFileSync(path)).digest("hex");
	await build({
		root,
		configFile: false,
		logLevel: "error",
		plugins: [
			{
				name: "tunnel-source-identities",
				enforce: "pre",
				load(id) {
					if (id.startsWith("\0")) return null;
					const path = id.split("?")[0],
						rel = relative(root, path).replaceAll("\\", "/");
					if (
						!rel ||
						rel.startsWith("../") ||
						isAbsolute(rel) ||
						/(^|\/)node_modules\//.test(rel) ||
						!/\.(?:m?[jt]sx?|json|html|css)$/.test(rel)
					)
						return null;
					const stat = lstatSync(path);
					assert.ok(stat.isFile() && !stat.isSymbolicLink());
					const hash = digest(path);
					if (inputs.has(rel)) assert.equal(inputs.get(rel), hash);
					inputs.set(rel, hash);
					return null;
				},
				generateBundle() {
					for (const id of this.getModuleIds())
						assert.ok(
							!/[/\\]node_modules[/\\]opencut-wasm[/\\]/.test(id),
							"Shared stale WASM resolved",
						);
					for (const [path, hash] of inputs)
						assert.equal(
							digest(join(root, path)),
							hash,
							"Source changed during build",
						);
				},
			},
			{
				name: "tunnel-private-wasm",
				enforce: "pre",
				resolveId(id) {
					if (id === "opencut-wasm") return "\0tunnel-private-wasm";
				},
				load(id) {
					if (id === "\0tunnel-private-wasm")
						return `import init from ${JSON.stringify(entry)};await init();export * from ${JSON.stringify(entry)};`;
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
				input: join(root, "script/fixtures/mv-tunnel-native-browser.html"),
			},
		},
	});
	return [...inputs]
		.sort(([a], [b]) => a.localeCompare(b))
		.map(([path, sha256]) => ({ path, sha256 }));
}
