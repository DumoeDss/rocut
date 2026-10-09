import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { lstatSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, isAbsolute, join, relative } from "node:path";
import { pathToFileURL } from "node:url";
import {
	createHtmlProbeWasmPlugin,
	HTML_PRIVATE_WASM_ID,
} from "../html-probe-wasm-binding.mjs";

export function assertRecipeModuleIdentity(id) {
	assert.ok(
		!/[/\\]node_modules[/\\]opencut-wasm[/\\]|wasm-test-mock|bun:test|[/\\]__tests__[/\\]/.test(
			id,
		),
		`Unexpected shared WASM or test mock import: ${id}`,
	);
}
export function verifyRecipeSourceInputs({ root, inputs }) {
	for (const input of inputs)
		assert.equal(
			createHash("sha256")
				.update(readFileSync(join(root, input.path)))
				.digest("hex"),
			input.sha256,
			`Source drift: ${input.path}`,
		);
}
export async function buildRecipeEditor({ root, artifact, binding }) {
	const { build, wasm, topLevelAwait } =
		await import("../browser-probe-toolchain.mjs");
	const require = createRequire(join(root, "apps/vite-example/package.json"));
	const { default: react } = await import(
		pathToFileURL(require.resolve("@vitejs/plugin-react")).href
	);
	const inputs = new Map(),
		modules = new Set(),
		output = join(artifact, "web");
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
				name: "recipe-editor-production-identity",
				enforce: "pre",
				resolveId(id) {
					if (id === "opencut-wasm" || id === "opencut-wasm/sync")
						return "\0" + HTML_PRIVATE_WASM_ID;
				},
				load(id) {
					if (id.startsWith("\0")) return null;
					assertRecipeModuleIdentity(id);
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
					assert.ok(
						stat.isFile() && !stat.isSymbolicLink(),
						"Loaded source redirects",
					);
					const sha256 = createHash("sha256")
						.update(readFileSync(path))
						.digest("hex");
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
					for (const id of this.getModuleIds()) {
						assertRecipeModuleIdentity(id);
						modules.add(id);
					}
				},
			},
			createHtmlProbeWasmPlugin(binding),
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
					"script/fixtures/programmatic-recipe-editor-browser.html",
				),
			},
		},
	});
	const sourceInputs = [...inputs]
		.sort(([a], [b]) => a.localeCompare(b))
		.map(([path, sha256]) => ({ path, sha256 }));
	verifyRecipeSourceInputs({ root, inputs: sourceInputs });
	for (const suffix of [
		"programmatic-recipe-command.ts",
		"programmatic-recipe-editor.tsx",
		"programmatic-source-panel.tsx",
		"create-session.ts",
		"update-elements.ts",
		"canvas-runtime.ts",
	])
		assert.ok(
			sourceInputs.some((input) => input.path.endsWith(suffix)),
			`Required production import missing: ${suffix}`,
		);
	assert.ok(
		[...modules].some((id) => id.includes(binding.entry)),
		"Private WASM entry missing from actual graph",
	);
	return { output, sourceInputs };
}
