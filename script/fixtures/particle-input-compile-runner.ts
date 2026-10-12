import assert from "node:assert/strict";
import { mkdtemp, copyFile, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createHash } from "node:crypto";

const repo = fileURLToPath(new URL("../..", import.meta.url));
const pkg = "C:/tmps/rocut-svg-wasm-DHuXQ7/pkg",
	runtime = "C:/tmps/rocut-integrated-private-FxmSkS/runtime",
	toolchain = "C:/tmps/rocut-three-pinned-features-ZvqmB9/toolchain",
	root = await mkdtemp("C:/tmps/rocut-particle-input-");
const modes = process.argv.includes("--image-only")
	? ["image"]
	: ["image", "animated"];
const sha = (bytes: Uint8Array) =>
		createHash("sha256").update(bytes).digest("hex"),
	files = [];
const creator =
	"E:/AI/ChatAI/Agents/VibeCodingProjects/elftia/elftia/elftia-plugin-creator-studio/resources/agent/skills/html-video/assets/rocut-stylized";
const names = [
	"particle-image.mjs",
	"particle-image-scene.ts",
	...(modes.includes("animated")
		? [
				"particle-animated-object.mjs",
				"particle-animated-scene.ts",
				"particle-pose-geometry.mjs",
				"particle-scene.ts",
				"object-animation.mjs",
			]
		: []),
];
const sources = [
	...names.map((name) => join(creator, name)),
	...[
		"three-particle-adapter.ts",
		"three-particle-provenance.ts",
		"engines/three-build-profile.ts",
		"engines/three-toolchain-profile.ts",
		"engines/three-asset-features.ts",
	].map((name) => join(repo, "apps/cli/src/programmatic", name)),
];
const pins = async () =>
		Object.fromEntries(
			await Promise.all(
				sources.map(async (path) => [path, sha(await readFile(path))]),
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
]) {
	const bytes = await readFile(join(runtime, name));
	if (name.endsWith("worker-entry.mjs"))
		assert.deepEqual(
			bytes,
			await readFile(join(repo, "apps/cli/src/programmatic", name)),
		);
	if (name.endsWith(".wasm"))
		assert.equal(
			sha(bytes),
			"748c4ff5780b13a95816c6ef7ae36533b807e39952ccd4a108baa29308272363",
		);
	await copyFile(join(runtime, name), join(root, name));
	files.push({ name, sha256: sha(bytes) });
}
const built = await Bun.build({
	entrypoints: [join(repo, "script/fixtures/particle-input-compile.ts")],
	outdir: root,
	naming: "compile.mjs",
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
			toolchain,
			modes,
			files,
			bundleSha256: sha(await readFile(join(root, "compile.mjs"))),
		},
		null,
		2,
	),
	{ flag: "wx" },
);
console.log(JSON.stringify({ root, stage: "real-native-compile", modes }));
try {
	const fixture = await import(pathToFileURL(join(root, "compile.mjs")).href);
	await fixture.runParticleInputCompile({ root, toolchain, modes });
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
