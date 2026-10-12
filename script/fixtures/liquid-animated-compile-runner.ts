import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, copyFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createHash } from "node:crypto";

const repo = fileURLToPath(new URL("../..", import.meta.url));
const pkg = "C:/tmps/rocut-svg-wasm-DHuXQ7/pkg",
	runtime = "C:/tmps/rocut-integrated-private-FxmSkS/runtime",
	toolchain = "C:/tmps/rocut-three-pinned-features-ZvqmB9/toolchain",
	creator = "E:/AI/ChatAI/Agents/VibeCodingProjects/elftia/elftia/elftia-plugin-creator-studio/resources/agent/skills/html-video/assets/rocut-stylized",
	root = await mkdtemp("C:/tmps/rocut-liquid-animated-");
const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const paths = ["liquid-animated-object.mjs", "liquid-animated-scene.ts", "liquid-object.mjs", "liquid-object-geometry.mjs",
	"particle-pose-geometry.mjs", "object-animation.mjs", "object-params-resolver.mjs"].map(name => join(creator, name)).concat(
	["host.ts", "programmatic/object-params.ts", "programmatic/object-params-route.ts", "programmatic/three-liquid-object-adapter.ts",
		"programmatic/three-liquid-object-provenance.ts", "programmatic/engines/three-asset-features.ts"].map(name => join(repo, "apps/cli/src", name)));
const pins = async () => Object.fromEntries(await Promise.all(paths.map(async path => [path, sha(await readFile(path))])));
const before = await pins();
await writeFile(join(root, "source-pins-before.json"), JSON.stringify(before, null, 2), { flag: "wx" });
const files = [];
for (const name of ["liquid-object-wasm.mjs", "particle-sampler-wasm.mjs", "liquid-object-worker-entry.mjs", "particle-sampler-worker-entry.mjs", "opencut_wasm_bg.wasm"]) {
	const bytes = await readFile(join(runtime, name));
	if (name.endsWith("worker-entry.mjs")) assert.deepEqual(bytes, await readFile(join(repo, "apps/cli/src/programmatic", name)));
	if (name.endsWith(".wasm")) assert.equal(sha(bytes), "748c4ff5780b13a95816c6ef7ae36533b807e39952ccd4a108baa29308272363");
	await copyFile(join(runtime, name), join(root, name)); files.push({ name, sha256: sha(bytes) });
}
assert.equal(sha(await readFile(join(pkg, "opencut_wasm_bg.wasm"))), files.find(file => file.name.endsWith(".wasm"))!.sha256);
const built = await Bun.build({ entrypoints: [join(repo, "script/fixtures/liquid-animated-compile.ts")], outdir: root,
	naming: "compile.mjs", target: "bun", define: {
		"import.meta.__ROCUT_PACKED_LIQUID_OBJECT_MODULE_V1__": JSON.stringify("./liquid-object-wasm.mjs"),
		"import.meta.__ROCUT_PACKED_PARTICLE_SAMPLER_MODULE_V1__": JSON.stringify("./particle-sampler-wasm.mjs"),
	}, plugins: [{ name: "real-private-wasm", setup(builder) {
		builder.onResolve({ filter: /^opencut-wasm$/ }, () => ({ path: join(pkg, "opencut_wasm_sync.js"), external: true }));
	} }] });
assert(built.success, built.logs.map(String).join("\n"));
await writeFile(join(root, "runner-pins.json"), JSON.stringify({ root, repo, pkg, runtime, toolchain, creator, files,
	bundleSha256: sha(await readFile(join(root, "compile.mjs"))) }, null, 2), { flag: "wx" });
console.log(JSON.stringify({ root, stage: "real-public-resolver-native-compile" }));
try {
	const fixture = await import(pathToFileURL(join(root, "compile.mjs")).href);
	await fixture.runLiquidAnimatedCompile({ root, toolchain, creator });
	console.log(JSON.stringify({ root, ok: true }));
} catch (error) {
	await writeFile(join(root, "failure.json"), JSON.stringify({ ok: false, error: error instanceof Error ? error.stack : String(error) }, null, 2), { flag: "wx" });
	throw error;
} finally {
	const after = await pins();
	const drift = Object.keys(before).filter(path => before[path] !== after[path]);
	await writeFile(join(root, "source-pins-after.json"), JSON.stringify({ pins: after, drift }, null, 2), { flag: "wx" });
	assert.deepEqual(drift, [], "Scoped source changed during acceptance");
}
