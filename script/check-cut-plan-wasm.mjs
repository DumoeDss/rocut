#!/usr/bin/env node
/** Exercise an already-built private package. Does not build/install/publish. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
const { values } = parseArgs({options: {"out-dir": {type: "string"}}});
assert.ok(values["out-dir"], "Usage: node script/check-cut-plan-wasm.mjs --out-dir <private-package>");
const output = resolve(values["out-dir"]);
const binary = new WebAssembly.Module(readFileSync(join(output, "opencut_wasm_bg.wasm")));
assert.ok(WebAssembly.Module.exports(binary).some(e => e.name === "validateCutPlanJson" && e.kind === "function"));
const native = await import(pathToFileURL(join(output, "opencut_wasm_sync.js")).href);
assert.equal(typeof native.validateCutPlanJson, "function");
const sha = "a".repeat(64);
const document = {revision: 1, project: {id: "project", frameRate: {numerator: 30, denominator: 1}, sceneState: {scenes: [{id: "scene"}]}, musicGridState: {
  version: 1, grids: [{id: "grid", revision: 1, mode: "manual", assetId: "audio", sourceSha256: sha, sourceDurationTick: 120600, reviewReference: "reviewed fixture", analysisProvenance: null, points: [{id: "start", sourceTick: 0}, {id: "middle", sourceTick: 60000}]}],
  bindings: [{id: "binding", gridId: "grid", clipId: "song", assetId: "audio", sceneId: "scene"}]}},
  tracks: [{id: "song-track", sceneId: "scene"}], clips: [{id: "song", trackId: "song-track", assetId: "audio", startTime: 0, duration: 120600, trimStart: 0, trimEnd: 0}], assets: [{id: "audio", kind: "audio", sourceSha256: sha, duration: 120600}]};
const grid = JSON.parse(native.queryMusicGridJson(JSON.stringify({document, request: {kind: "read", bindingId: "binding"}})));
assert.equal(grid.status, "ready");
const request = {authorClock: {sceneOriginTick: 0, songOriginTick: 0}, expectedNativeRevision: 1, grid: {bindingId: "binding", expectedGridRevision: 1, expectedMappingHash: grid.mappingHash},
  coverage: {scope: "full-song", range: {startTick: 0, endTick: 124000}, tracks: [{trackId: "visual", mode: "contiguous"}]},
  boundaries: [{key: "start", tick: 0, pointId: "start"}, {key: "middle", tick: 60000, pointId: "middle"}, {key: "end", tick: 120600, offGridReason: "cover exact final audio sample"}],
  clips: [{nodeId: "one", trackId: "visual", startBoundary: "start", endBoundary: "middle", sourceStartTick: 0, source: {kind: "video", sha256: sha, decodedEndMicroseconds: 1000000}},
    {nodeId: "two", trackId: "visual", startBoundary: "middle", endBoundary: "end", sourceStartTick: 0, source: {kind: "image", sha256: sha, decodedEndMicroseconds: 0}}],
  audioEnd: {sourceSha256: sha, sampleRate: 48000, decodedSamples: 48240, sceneStartTick: 0, sourceStartTick: 0, authorEndTick: 120600}, visualTail: {policy: "fixed-image", nodeId: "two"}};
const query = value => JSON.parse(native.validateCutPlanJson(JSON.stringify({document, request: value})));
const ready = query(request);
assert.equal(ready.status, "ready", JSON.stringify(ready));
assert.equal(ready.audioEnd, 120600);
assert.equal(ready.visualEndTick, 124000);
assert.equal(ready.clips[0].range.endTick, ready.clips[1].range.startTick);
assert.equal(ready.boundaries.at(-1).originalTick, 120600);
assert.equal(ready.boundaries.at(-1).frameTick, 124000);
const collision = structuredClone(request);
collision.boundaries[1] = {key: "middle", tick: 1000, offGridReason: "explicit close cuts"};
assert.equal(query(collision).status, "blocked");
const stale = structuredClone(request); stale.expectedNativeRevision = 0;
assert.equal(query(stale).status, "conflict");
document.clips[0].startTime = 4000;
const movedGrid = JSON.parse(native.queryMusicGridJson(JSON.stringify({document, request: {kind: "read", bindingId: "binding"}})));
const moved = structuredClone(request);
moved.authorClock.sceneOriginTick = 4000;
moved.grid.expectedMappingHash = movedGrid.mappingHash;
const mapped = query(moved);
assert.equal(mapped.status, "ready", JSON.stringify(mapped));
assert.equal(mapped.boundaries[0].frameTick, 0);
assert.equal(mapped.boundaries[0].nativeFrameTick, 4000);
moved.authorClock.sceneOriginTick = 1;
assert.equal(query(moved).reason, "cut-plan-author-scene-mapping-unavailable");
console.info("cut-plan WASM: binary/JS exports, shared frame cuts, sample endpoint/visual tail, nonzero Author clock, collision and revision guards passed");
