import fs from "node:fs";
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createScheduleFixture, FIXED_PARAMS, STROKE, sha256 } from "./frost-schedule-fixture.mjs";
import { openFrostScheduleHost } from "./frost-schedule-host.mjs";
import { blazePipelinePng } from "../probe-blaze-pipeline-png.mjs";

const [configPath, root, creator, toolchain] = process.argv.slice(2);
assert.equal(process.argv.length, 6, "Expected configPath privateRoot creatorFrostModule toolchain");
assert(path.isAbsolute(root) && /^C:[\\/]tmps[\\/]/iu.test(root));
assert(!fs.existsSync(root), "Preparation requires a fresh dedicated root");
const config = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(fs.readFileSync(configPath)));
for (const pin of config.pins) assert.equal(sha256(fs.readFileSync(pin.path)), pin.sha256);
const fixture = createScheduleFixture();
assert(fixture.pairs.every(pair => pair.identity.identifiable && pair.identity.accepted && !pair.freeze.accepted));
fs.mkdirSync(root);
const pin = file => ({ path: file, byteLength: fs.statSync(file).size, sha256: sha256(fs.readFileSync(file)) });
const manifest = { ...fixture, source: undefined, frames: fixture.frames.map(({ rgba, rgb, ...frame }) => frame),
	seekTicks: [48000, 16000, 12000, 28000, 0, 36000, 16000, 48000] };
fs.writeFileSync(root + "/fixture-contract.json", JSON.stringify(manifest, null, 2) + "\n");
fs.writeFileSync(root + "/opaque-source.rgba", fixture.source);
fs.writeFileSync(root + "/opaque-source.png", Buffer.from(blazePipelinePng(fixture.source, fixture.width, fixture.height)));
for (const frame of fixture.frames) fs.writeFileSync(root + "/independent-" + frame.index + ".rgba", frame.rgba);
const report = { ok: false, stage: "CPU only: independent f64 reference/preselected temporal pairs and formal Host source/effect archive/save/reopen", config: pin(configPath),
	runtime: config.runtime, runtimePins: config.pins.length, toolchain, creator: pin(creator), contract: pin(root + "/fixture-contract.json"),
	source: pin(root + "/opaque-source.png"), alpha: fixture.alpha, pairs: fixture.pairs,
	globalFrameTicks: fixture.frames.map(frame => frame.ticks), seekTicks: manifest.seekTicks, cleanup: [] };
const { frostImage } = await import(pathToFileURL(creator));
let host;
try {
	host = await openFrostScheduleHost({ directory: root, runtime: config.runtime, toolchain });
	const imported = await host.request("programmatic/resources/import", { id: "frost-schedule-opaque.png", kind: "image",
		mimeType: "image/png", filePath: root + "/opaque-source.png" });
	assert.equal(imported.resource.sha256, report.source.sha256);
	const params = { ...FIXED_PARAMS };
	for (const key of Object.keys(params)) if (key.startsWith("stroke")) delete params[key];
	const shot = frostImage({ image: imported.resource, settings: { width: 64, height: 48, durationFrames: 13,
		frameRate: { numerator: 30, denominator: 1 }, seed: 17 }, params,
		strokes: [{ time: STROKE.time, fromX: STROKE.from[0], fromY: STROKE.from[1],
			toX: STROKE.to[0], toY: STROKE.to[1], radius: STROKE.radius, strength: STROKE.strength }] });
	assert.deepEqual(shot.effects[0].params, FIXED_PARAMS);
	assert.deepEqual(shot.animations, {});
	const clips = ["frost-schedule", "frost-schedule-disabled"].map((id, index) => ({ id, trackId: "frost-track",
		startTime: index * 52000, duration: 52000, trimStart: 0, trimEnd: 0,
		editing: { type: "graphic", name: id, definitionId: "programmatic", params: {},
			programmatic: structuredClone(shot.source), effects: shot.effects.map(effect => ({ ...effect, enabled: index === 0 })),
			animations: {} } }));
	const context = await host.request("context");
	const applied = await host.request("apply", { expectedRevision: context.revision, operations: [
		{ kind: "update-project", projectId: context.project.id, patch: { name: "Isolated Frost schedule clock",
			canvasWidth: 64, canvasHeight: 48, frameRate: { numerator: 30, denominator: 1 } } },
		{ kind: "create-track", track: { id: "frost-track", name: "Frost", kind: "graphic", hidden: false } },
		...clips.map(clip => ({ kind: "create-clip", clip })),
	] });
	assert.equal(applied.accepted, true);
	assert.deepEqual((await host.request("clips")).filter(clip => clip.trackId === "frost-track"), clips);
	fs.copyFileSync(root + "/project/project.json", root + "/prepared-project.json");
	report.savedProject = pin(root + "/prepared-project.json");
	report.resource = imported.resource;
	report.fixedEffects = shot.effects;
	await host.close(); report.cleanup.push({ stage: "prepare", pid: host.pid, hostClosed: true }); host = undefined;
	host = await openFrostScheduleHost({ directory: root, runtime: config.runtime, toolchain });
	assert.equal(sha256(fs.readFileSync(root + "/project/project.json")), report.savedProject.sha256);
	assert.deepEqual((await host.request("clips")).filter(clip => clip.trackId === "frost-track"), clips);
	assert.equal((await host.request("context")).revision, 1);
	report.reopenedExactSavedBytesAndClips = true;
	report.ok = true;
} catch (error) { report.error = error.stack; process.exitCode = 1; }
finally {
	if (host) { await host.close(); report.cleanup.push({ stage: "reopen", pid: host.pid, hostClosed: true }); }
	fs.writeFileSync(root + "/cpu-receipt.json", JSON.stringify(report, null, 2) + "\n");
	console.log(JSON.stringify({ ok: report.ok, pairs: report.pairs, cleanup: report.cleanup, error: report.error }, null, 2));
}
