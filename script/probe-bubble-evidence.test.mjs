import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { bubbleHash, bubbleScratch, bubbleRequiredFixtures, bubbleRunnerNames, bubblePackageNames, collectBubbleInputs, verifyBubbleInputs, bubbleSourceGuard } from "./probe-bubble-evidence.mjs";

async function fixture() {
	const base = await mkdtemp("C:/tmps/bubble-evidence-test-");
	const snapshot = join(base, "snapshot"), pkg = join(base, "pkg"), runner = join(base, "runner"), live = join(base, "live");
	for (const path of [snapshot, pkg, runner, live]) await mkdir(path);
	const names = [...bubbleRequiredFixtures, "rust/crates/effects/src/bubble.rs", "rust/crates/effects/src/shaders/bubble.wgsl"];
	const files = [];
	for (const name of names) {
		const path = join(snapshot, name), bytes = Buffer.from(`// ${name}\n`);
		await mkdir(dirname(path), { recursive: true });
		await writeFile(path, bytes, { flag: "wx" });
		files.push({ path: name, sha256: bubbleHash(bytes) });
	}
	for (const name of bubblePackageNames) await writeFile(join(pkg, name), name, { flag: "wx" });
	for (const name of bubbleRunnerNames) await writeFile(join(runner, name), name, { flag: "wx" });
	await writeFile(join(snapshot, "fixture-source.json"), JSON.stringify({ files }), { flag: "wx" });
	return { base, snapshot, pkg, runner, live, files };
}
test("Bubble provenance hashes frozen Rust, all oracle/fixture closure, package and runner inputs", async () => {
	const test = await fixture();
	const frozen = await collectBubbleInputs(test.snapshot, test.pkg, test.runner);
	assert.equal(frozen.inputs.length, test.files.length);
	assert.equal((await verifyBubbleInputs(frozen)).ok, true);
	await writeFile(join(test.pkg, "opencut_wasm_bg.wasm"), "changed fixture binary");
	const changed = await verifyBubbleInputs(frozen);
	assert.equal(changed.ok, false);
	assert(changed.failures.some((error) => error.includes("opencut_wasm_bg.wasm")));
});
test("Bubble source guard refuses live, unlisted and changed source imports", async () => {
	const test = await fixture(), frozen = await collectBubbleInputs(test.snapshot, test.pkg, test.runner);
	const guard = bubbleSourceGuard(frozen, test.live);
	const allowed = join(test.snapshot, "script/fixtures/bubble-cases.mjs");
	assert.equal(await guard.plugin.transform("", allowed), null);
	assert(guard.loaded.has("script/fixtures/bubble-cases.mjs"));
	await assert.rejects(guard.plugin.transform("", join(test.snapshot, "script/fixtures/unlisted.mjs")), /Unlisted/);
	await assert.rejects(guard.plugin.transform("", join(test.live, "packages/editor/live.mjs")), /live source/);
	await assert.rejects(guard.plugin.transform("", join(test.base, "other-session/file.mjs")), /escaped frozen/);
	await writeFile(allowed, "changed oracle fixture");
	await assert.rejects(guard.plugin.transform("", allowed), /source changed/);
});
test("Bubble snapshot manifests reject missing entries, duplicates and traversal", async () => {
	const test = await fixture(), manifest = join(test.snapshot, "fixture-source.json");
	await writeFile(manifest, JSON.stringify({ files: test.files.slice(1) }));
	await assert.rejects(collectBubbleInputs(test.snapshot, test.pkg, test.runner), /Snapshot missing/);
	await writeFile(manifest, JSON.stringify({ files: [...test.files, test.files[0]] }));
	await assert.rejects(collectBubbleInputs(test.snapshot, test.pkg, test.runner), /Duplicate/);
	await writeFile(manifest, JSON.stringify({ files: [...test.files, { path: "rust/../../../outside.rs", sha256: "a".repeat(64) }] }));
	await assert.rejects(collectBubbleInputs(test.snapshot, test.pkg, test.runner), /escapes root/);
});
test("Bubble scratch preflight rejects other disks and sibling-prefix tricks", async () => {
	await assert.rejects(bubbleScratch("E:/not-allowed"), /C:\/tmps/);
	await assert.rejects(bubbleScratch("C:/tmps-other/not-allowed"), /C:\/tmps/);
	await assert.rejects(bubbleScratch("relative"), /C:\/tmps/);
});
