#!/usr/bin/env node
/** Verify an already-built private WASM package; never build, install or publish. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

const { values } = parseArgs({ options: { "out-dir": { type: "string" } } });
assert.ok(
	values["out-dir"],
	"Usage: node script/check-music-grid-wasm.mjs --out-dir <private-built-package>",
);
const output = resolve(values["out-dir"]);
const names = [
	"queryMusicGridJson",
	"planMusicGridEditJson",
	"validateMusicGridStateJson",
];
const module = new WebAssembly.Module(
	readFileSync(join(output, "opencut_wasm_bg.wasm")),
);
const exports = WebAssembly.Module.exports(module);
for (const name of names)
	assert.ok(
		exports.some((entry) => entry.name === name && entry.kind === "function"),
		`Missing binary export: ${name}`,
	);
const native = await import(
	pathToFileURL(join(output, "opencut_wasm_sync.js")).href
);
for (const name of names)
	assert.equal(typeof native[name], "function", `Missing JS binding: ${name}`);
const document = {
	revision: 0,
	project: {
		id: "project",
		frameRate: { numerator: 30, denominator: 1 },
		sceneState: { scenes: [{ id: "scene" }] },
	},
	tracks: [{ id: "audio", sceneId: "scene", kind: "audio" }],
	clips: [
		{
			id: "song",
			trackId: "audio",
			assetId: "source",
			startTime: 600000,
			duration: 1200000,
			trimStart: 240000,
			trimEnd: 0,
		},
	],
	assets: [
		{
			id: "source",
			kind: "audio",
			sourceSha256: "a".repeat(64),
			duration: 2400000,
		},
	],
};
const planned = JSON.parse(
	native.planMusicGridEditJson(
		JSON.stringify({
			document,
			request: {
				expectedNativeRevision: 0,
				idempotencyKey: "private-wasm-roundtrip",
				operation: {
					kind: "create-manual",
					clipId: "song",
					points: [{ id: "beat", sourceTick: 1200000 }],
					reviewReference: "private-fixture-review",
				},
			},
		}),
	),
);
assert.equal(planned.status, "admitted", JSON.stringify(planned));
document.project.musicGridState =
	planned.batch.operations[0].patch.musicGridState;
document.revision = 1;
assert.deepEqual(
	JSON.parse(
		native.validateMusicGridStateJson(
			JSON.stringify(document.project.musicGridState),
		),
	),
	[],
);
const query = (request) =>
	JSON.parse(
		native.queryMusicGridJson(
			JSON.stringify({
				document,
				request: { bindingId: planned.created.bindingId, ...request },
			}),
		),
	);
const read = query({ kind: "list" });
assert.equal(read.status, "ready", JSON.stringify(read));
assert.equal(read.clock, "scene-timeline-ticks");
assert.equal(read.downbeatsKnown, false);
assert.equal(read.points[0].tick, 1560000);
document.clips[0].startTime += 120000;
document.revision += 1;
const snap = query({
	kind: "snap",
	maxDistanceTicks: 100,
	samples: [{ key: "shot", tick: 1680050 }],
});
assert.equal(snap.status, "ready", JSON.stringify(snap));
assert.equal(snap.results[0].key, "shot");
assert.equal(snap.results[0].snappedTick, 1680000);
assert.equal(snap.results[0].delta, -50);
assert.notEqual(snap.mappingHash, read.mappingHash);
assert.equal(
	query({ kind: "list", expectedMappingHash: read.mappingHash }).status,
	"conflict",
);
assert.equal(
	query({ kind: "list", expectedNativeRevision: 1 }).status,
	"conflict",
);
document.clips[0].retime = { rate: 2 };
document.clips[0].duration = 1080000;
document.revision += 1;
assert.equal(query({ kind: "list" }).points[0].tick, 1200000);
document.assets[0].sourceSha256 = "b".repeat(64);
assert.equal(query({ kind: "list" }).status, "conflict");
document.assets[0].sourceSha256 = "a".repeat(64);
document.project.sceneState.scenes[0].isMain = true;
assert.equal(
	query({ kind: "read", clock: "project-timeline-ticks" }).status,
	"ready",
);
const anchorProjection = query({
	kind: "project-anchors",
	anchorSource: {
		sourceSha256: "a".repeat(64),
		resourceSha256: "c".repeat(64),
		resourceRevision: 1,
		reviewReference: "anchor-review",
		anchors: [
			{ key: "line", sourceTick: 1200000 },
			{ key: "trimmed", sourceTick: 0 },
		],
	},
});
assert.equal(anchorProjection.results[0].key, "line");
assert.equal(anchorProjection.results[0].tick, 1200000);
assert.equal(anchorProjection.results[1].status, "unavailable");
const previousClip = structuredClone(document.clips[0]);
Object.assign(document.clips[0], {
	startTime: 600000, trimStart: 0, duration: 2400000,
	retime: { rate: 1, reverse: false },
});
const boundaryRequest = {
	kind: "project-anchors",
	anchorSource: {
		sourceSha256: "a".repeat(64), resourceSha256: "d".repeat(64),
		resourceRevision: 1, reviewReference: "boundary-review",
		anchors: [{ key: "start", sourceTick: 0 }, { key: "end", sourceTick: 2400000 }],
	},
};
assert.deepEqual(query(boundaryRequest).results.map((p) => p.tick), [600000, 3000000]);
document.clips[0].retime.reverse = true;
assert.deepEqual(query(boundaryRequest).results.map((p) => p.tick), [3000000, 600000]);
Object.assign(document.clips[0], { trimStart: 240000, duration: 600000 });
document.clips[0].retime.rate = 2;
boundaryRequest.anchorSource.anchors = [
	{ key: "start", sourceTick: 240000 }, { key: "end", sourceTick: 1440000 },
];
assert.deepEqual(query(boundaryRequest).results.map((p) => p.tick), [1200000, 600000]);
document.clips[0].retime.reverse = false;
assert.deepEqual(query(boundaryRequest).results.map((p) => p.tick), [600000, 1200000]);
document.clips[0] = previousClip;
const bpmSegments = [
	{
		id: "pickup-six",
		sourceStartTick: 0,
		sourceEndTick: 180000,
		meter: { numerator: 6, denominator: 8 },
		beatUnit: { numerator: 1, denominator: 8 },
		phaseQuarterNotes: { numerator: 5, denominator: 2 },
		quarterNoteBpm: { numerator: 120, denominator: 1 },
		interpolation: "step",
	},
];
const bpm = JSON.parse(
	native.planMusicGridEditJson(
		JSON.stringify({
			document,
			request: {
				expectedNativeRevision: document.revision,
				idempotencyKey: "private-bpm-roundtrip",
				operation: {
					kind: "create-manual-bpm",
					clipId: "song",
					segments: bpmSegments,
					reviewReference: "pickup-review",
				},
			},
		}),
	),
);
assert.equal(bpm.status, "admitted", JSON.stringify(bpm));
const bpmState = bpm.batch.operations[0].patch.musicGridState;
const bpmGrid = bpmState.grids.find((grid) => grid.id === bpm.created.gridId);
assert.deepEqual(bpmGrid.manualBpmProvenance, bpmSegments);
assert.equal(bpmGrid.points[0].downbeat, false);
assert.equal(bpmGrid.points[1].sourceTick, 30000);
assert.equal(bpmGrid.points[1].downbeat, true);
assert.deepEqual(
	JSON.parse(native.validateMusicGridStateJson(JSON.stringify(bpmState))),
	[],
);
console.log(
	"Actual WASM exports and create/validate/list/move/rate/snap/conflict/clock/anchors/BPM-pickup roundtrip passed",
);
