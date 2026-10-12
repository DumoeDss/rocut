import assert from "node:assert/strict";
import { mkdtemp, copyFile, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import { verifyParticleControl } from "./particle-control-cases";

const pkg = process.env.ROCUT_TEST_PARTICLE_CONTROL_WASM_PACKAGE_DIR,
	runtime = process.env.ROCUT_TEST_PARTICLE_CONTROL_RUNTIME_DIR;
assert(
	pkg && runtime,
	"New genuine control-supporting private WASM package AND native runtime closure required; do not use old748c",
);
const repo = fileURLToPath(new URL("../..", import.meta.url)),
	root = await mkdtemp("C:/tmps/rocut-particle-control-compile-"),
	toolchain = "C:/tmps/rocut-three-pinned-features-ZvqmB9/toolchain";
const sha = (bytes: Uint8Array) =>
		createHash("sha256").update(bytes).digest("hex"),
	binary = await readFile(join(pkg, "opencut_wasm_bg.wasm"));
assert.notEqual(
	sha(binary),
	"748c4ff5780b13a95816c6ef7ae36533b807e39952ccd4a108baa29308272363",
	"Old WASM does not support control",
);
const wasm = await import(
		pathToFileURL(join(pkg, "opencut_wasm_sync.js")).href
	),
	old = await import(
		pathToFileURL("C:/tmps/rocut-svg-wasm-DHuXQ7/pkg/opencut_wasm_sync.js").href
	);
const cpu = verifyParticleControl(
	(json: string) => wasm.sampleParticleSurfaceJson(json),
	(json: string) => old.sampleParticleSurfaceJson(json),
);
const files = [];
const creator =
	"E:/AI/ChatAI/Agents/VibeCodingProjects/elftia/elftia/elftia-plugin-creator-studio/resources/agent/skills/html-video/assets/rocut-stylized";
const sources = [
	join(creator, "particle-controlled-object.mjs"),
	join(creator, "particle-object.mjs"),
	join(creator, "particle-scene.ts"),
	...[
		"three-particle-adapter.ts",
		"three-particle-provenance.ts",
		"particle-motion-contract.ts",
		"particle-protocol.ts",
		"particle-browser-bundle.generated.ts",
		"particle-motion-control-capability.ts",
		"particle-sampler-worker-entry.mjs",
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
	if (name.endsWith(".wasm")) assert.deepEqual(bytes, binary);
	await copyFile(join(runtime, name), join(root, name));
	files.push({ name, sha256: sha(bytes) });
}
const built = await Bun.build({
	entrypoints: [join(repo, "script/fixtures/particle-control-compile.ts")],
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
			name: "actual-new-private-wasm",
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
		{ root, pkg, runtime, toolchain, wasmSha256: sha(binary), files, cpu },
		null,
		2,
	),
	{ flag: "wx" },
);
try {
	const fixture = await import(pathToFileURL(join(root, "compile.mjs")).href);
	await fixture.runParticleControlCompile({ root, toolchain });
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
