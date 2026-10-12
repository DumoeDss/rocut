import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, copyFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createHash } from "node:crypto";

const repo = fileURLToPath(new URL("../..", import.meta.url)),
	root = await mkdtemp("C:/tmps/rocut-object-params-http-"),
	pkg = "C:/tmps/rocut-svg-wasm-DHuXQ7/pkg",
	runtime = "C:/tmps/rocut-integrated-private-FxmSkS/runtime";
const sha = (bytes: Uint8Array) =>
	createHash("sha256").update(bytes).digest("hex");
assert.equal(
	sha(await readFile(join(pkg, "opencut_wasm_bg.wasm"))),
	"748c4ff5780b13a95816c6ef7ae36533b807e39952ccd4a108baa29308272363",
);
const creator =
	"E:/AI/ChatAI/Agents/VibeCodingProjects/elftia/elftia/elftia-plugin-creator-studio/resources/agent/skills/html-video/assets/rocut-stylized";
const sourcePaths = [
	"host.ts",
	"programmatic/object-params.ts",
	"programmatic/object-params-route.ts",
]
	.map((name) => join(repo, "apps/cli/src", name))
	.concat(
		[
			"object-params-resolver.mjs",
			"glass-object.mjs",
			"ink-object.mjs",
			"liquid-object.mjs",
		].map((name) => join(creator, name)),
	);
const pins = async () =>
		Object.fromEntries(
			await Promise.all(
				sourcePaths.map(async (path) => [path, sha(await readFile(path))]),
			),
		),
	before = await pins();
await writeFile(
	join(root, "source-pins-before.json"),
	JSON.stringify(before, null, 2),
	{ flag: "wx" },
);
for (const name of [
	"liquid-object-wasm.mjs",
	"particle-sampler-wasm.mjs",
	"liquid-object-worker-entry.mjs",
	"particle-sampler-worker-entry.mjs",
	"opencut_wasm_bg.wasm",
])
	await copyFile(join(runtime, name), join(root, name));
const built = await Bun.build({
	entrypoints: [join(repo, "script/fixtures/object-params-http.ts")],
	outdir: root,
	naming: "acceptance.mjs",
	target: "bun",
	define: {
		"import.meta.__ROCUT_PACKED_LIQUID_OBJECT_MODULE_V1__": JSON.stringify(
			"./liquid-object-wasm.mjs",
		),
		"import.meta.__ROCUT_PACKED_PARTICLE_SAMPLER_MODULE_V1__": JSON.stringify(
			"./particle-sampler-wasm.mjs",
		),
	},
	plugins: [
		{
			name: "real-private-wasm",
			setup(builder) {
				builder.onResolve({ filter: /^opencut-wasm$/ }, () => ({
					path: join(pkg, "opencut_wasm_sync.js"),
					external: true,
				}));
			},
		},
	],
});
assert(built.success, built.logs.map(String).join("\n"));
await writeFile(
	join(root, "runner-pins.json"),
	JSON.stringify(
		{
			root,
			repo,
			pkg,
			runtime,
			bundleSha256: sha(await readFile(join(root, "acceptance.mjs"))),
		},
		null,
		2,
	),
	{ flag: "wx" },
);
console.log(JSON.stringify({ root, stage: "real-owned-Host-HTTP" }));
try {
	const fixture = await import(
		pathToFileURL(join(root, "acceptance.mjs")).href
	);
	await fixture.runObjectParamsHttp(root);
	console.log(JSON.stringify({ root, ok: true }));
} catch (error) {
	await writeFile(
		join(root, "failure.json"),
		JSON.stringify(
			{
				ok: false,
				error: error instanceof Error ? error.stack : String(error),
			},
			null,
			2,
		),
		{ flag: "wx" },
	);
	throw error;
} finally {
	const after = await pins();
	await writeFile(
		join(root, "source-pins-after.json"),
		JSON.stringify(
			{
				pins: after,
				drift: Object.keys(before).filter(
					(path) => before[path] !== after[path],
				),
			},
			null,
			2,
		),
		{ flag: "wx" },
	);
}
