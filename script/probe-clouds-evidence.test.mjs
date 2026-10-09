import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import test from "node:test";
import {
	cloudsInputFixtureNames,
	cloudsSha256,
	collectCloudsInputs,
	verifyCloudsInputs,
} from "./probe-clouds-evidence.mjs";
import { cloudsSourceGuard } from "./probe-clouds-source-guard.mjs";

async function fixture(omit) {
	const parent = await mkdtemp("C:/tmps/clouds-closure-test-"),
		root = join(parent, "snapshot"),
		wasm = join(parent, "wasm");
	await mkdir(root);
	await mkdir(wasm);
	const names = [
		...cloudsInputFixtureNames("pipeline"),
		"rust/crates/effects/src/clouds.rs",
		"rust/crates/effects/src/shaders/clouds.wgsl",
		"packages/editor-classic/src/services/renderer/canvas-renderer.ts",
		"packages/editor-classic/src/services/renderer/scene-exporter.ts",
		"packages/editor-classic/src/services/renderer/compositor/wasm-compositor.ts",
	];
	const files = [];
	for (const name of names) {
		const path = join(root, name),
			bytes = Buffer.from(`Synthetic CPU-only closure input: ${name}\n`);
		await mkdir(dirname(path), { recursive: true });
		await writeFile(path, bytes, { flag: "wx" });
		if (name !== omit) files.push({ path: name, sha256: cloudsSha256(bytes) });
	}
	await writeFile(
		join(root, "fixture-source.json"),
		JSON.stringify({
			sourceCommit: "synthetic-unit-test",
			sourceWorktreeClean: false,
			files,
		}),
		{ flag: "wx" },
	);
	for (const name of [
		"opencut_wasm.js",
		"opencut_wasm_bg.js",
		"opencut_wasm_bg.wasm",
		"opencut_wasm.d.ts",
		"package.json",
	])
		await writeFile(
			join(wasm, name),
			"Synthetic unit-test WASM declaration; never executed",
			{ flag: "wx" },
		);
	return { parent, root, wasm };
}
test("Clouds pipeline closure requires 13 pipeline files and production entries", async () => {
	assert.equal(
		cloudsInputFixtureNames("pipeline").length -
			cloudsInputFixtureNames().length,
		13,
	);
	assert.throws(() => cloudsInputFixtureNames("unknown"));
	for (const omit of [
		"script/fixtures/clouds-pipeline-decode.ts",
		"packages/editor-classic/src/services/renderer/scene-exporter.ts",
	]) {
		const input = await fixture(omit);
		await assert.rejects(
			collectCloudsInputs(input.root, input.wasm, [], "pipeline"),
			/Snapshot missing/,
		);
	}
});
test("Clouds loader rejects unmanifested or changed source and live repository escapes", async () => {
	const input = await fixture();
	const frozen = await collectCloudsInputs(
		input.root,
		input.wasm,
		[],
		"pipeline",
	);
	const guard = cloudsSourceGuard(
		frozen,
		join(input.parent, "live-repository"),
	);
	const path = join(input.root, "script/fixtures/clouds-pipeline.ts");
	assert.equal(await guard.plugin.transform("", path), null);
	assert.equal(guard.loaded.size, 1);
	assert.equal((await verifyCloudsInputs(frozen)).ok, true);
	await assert.rejects(
		guard.plugin.transform("", join(input.root, "packages/unmanifested.ts")),
		/missing from frozen manifest/,
	);
	await assert.rejects(
		guard.plugin.transform(
			"",
			join(input.parent, "live-repository/packages/live.ts"),
		),
		/escaped frozen snapshot/,
	);
	await writeFile(path, "changed synthetic fixture");
	await assert.rejects(
		guard.plugin.transform("", path),
		/loaded source changed/,
	);
	assert.equal((await verifyCloudsInputs(frozen)).ok, false);
});
