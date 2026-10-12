import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
	captureParticleBaselineTopology,
	assertParticleBaselineTopology,
} from "./particle-authority-baseline-topology.mjs";
import { assertParticleBaselineState } from "./particle-authority-prepare-contract.mjs";
import {
	baselineState,
	initialTopologyFixture,
} from "./particle-authority-baseline-topology-fixture.mjs";

test("one authored graphic lane plus preserved default empty Main Track passes", () => {
	const value = baselineState();
	assert.equal(value.state.tracks.length, 2);
	assert.equal(value.baselineTopology.mainTrack.id, "cpu-main");
	assertParticleBaselineState(value);
	value.state.tracks.reverse();
	assertParticleBaselineState(value);
});
test("topology receipt is cloned before the authoring state changes", () => {
	const initial = initialTopologyFixture();
	const receipt = captureParticleBaselineTopology(initial);
	initial.record.data.scenes[0].tracks.main.elements.push({ id: "unexpected" });
	initial.state.tracks[0].hidden = true;
	assert.deepEqual(receipt.nativeMainTrack.elements, []);
	assert.equal(receipt.mainTrack.hidden, false);
});
const initialChanges = [
	["nonzero revision", (v) => v.state.revision++],
	["existing clip", (v) => v.state.clips.push({ id: "existing" })],
	["missing default lane", (v) => v.state.tracks.pop()],
	["extra default lane", (v) => v.state.tracks.push({ ...v.state.tracks[0] })],
	[
		"authored ID as main",
		(v) => (v.sceneState.scenes[0].mainTrackId = "particle-track"),
	],
	["empty main ID", (v) => (v.sceneState.scenes[0].mainTrackId = "")],
	["wrong projected main type", (v) => (v.state.tracks[0].kind = "graphic")],
	["wrong projected main flags", (v) => (v.state.tracks[0].muted = true)],
	["wrong projected main name", (v) => (v.state.tracks[0].name = "Other")],
	[
		"native main elements",
		(v) => v.record.data.scenes[0].tracks.main.elements.push({}),
	],
	["native overlay", (v) => v.record.data.scenes[0].tracks.overlay.push({})],
	["native audio", (v) => v.record.data.scenes[0].tracks.audio.push({})],
	[
		"extra scene",
		(v) => v.record.data.scenes.push(structuredClone(v.record.data.scenes[0])),
	],
	["scene descriptor mismatch", (v) => (v.sceneState.scenes[0].id = "other")],
	["changed current scene", (v) => (v.record.data.currentSceneId = "other")],
	["bookmark", (v) => v.record.data.scenes[0].bookmarks.push({})],
	["motion text sequence", (v) => v.record.data.motionTextSequences.push({})],
];
for (const [name, change] of initialChanges) {
	test("initial topology rejects " + name, () => {
		const value = initialTopologyFixture();
		change(value);
		assert.throws(() => captureParticleBaselineTopology(value));
	});
}
const finalChanges = [
	["missing main", (v) => v.state.tracks.shift()],
	["duplicated main", (v) => (v.state.tracks[1] = { ...v.state.tracks[0] })],
	["extra lane", (v) => v.state.tracks.push({ id: "extra" })],
	["main ID", (v) => (v.state.tracks[0].id = "changed")],
	["main kind", (v) => (v.state.tracks[0].kind = "graphic")],
	["main name", (v) => (v.state.tracks[0].name = "Changed")],
	["main muted", (v) => (v.state.tracks[0].muted = true)],
	["main hidden", (v) => (v.state.tracks[0].hidden = true)],
	["main scene", (v) => (v.state.tracks[0].sceneId = "other")],
	[
		"native main ID",
		(v) => (v.record.data.scenes[0].tracks.main.id = "changed"),
	],
	[
		"native main kind",
		(v) => (v.record.data.scenes[0].tracks.main.type = "graphic"),
	],
	[
		"native main name",
		(v) => (v.record.data.scenes[0].tracks.main.name = "Changed"),
	],
	[
		"native main muted",
		(v) => (v.record.data.scenes[0].tracks.main.muted = true),
	],
	[
		"native main hidden",
		(v) => (v.record.data.scenes[0].tracks.main.hidden = true),
	],
	[
		"native main clip",
		(v) => v.record.data.scenes[0].tracks.main.elements.push({ id: "extra" }),
	],
	["authored kind", (v) => (v.state.tracks[1].kind = "video")],
	["authored name", (v) => (v.state.tracks[1].name = "Changed")],
	["authored hidden", (v) => (v.state.tracks[1].hidden = true)],
	["authored scene", (v) => (v.state.tracks[1].sceneId = "other")],
	["authored extra flags", (v) => (v.state.tracks[1].muted = false)],
	["extra clip", (v) => v.state.clips.push(structuredClone(v.state.clips[0]))],
	["missing clip", (v) => v.state.clips.pop()],
	["clip on main", (v) => (v.state.clips[0].trackId = "cpu-main")],
	[
		"extra native overlay",
		(v) => v.record.data.scenes[0].tracks.overlay.push({}),
	],
	[
		"missing native overlay",
		(v) => v.record.data.scenes[0].tracks.overlay.pop(),
	],
	[
		"extra native overlay clip",
		(v) => v.record.data.scenes[0].tracks.overlay[0].elements.push({}),
	],
	[
		"native source mismatch",
		(v) =>
			v.record.data.scenes[0].tracks.overlay[0].elements[0].programmatic
				.width++,
	],
	[
		"native params mismatch",
		(v) =>
			(v.record.data.scenes[0].tracks.overlay[0].elements[0].params.opacity = 1),
	],
	["native audio", (v) => v.record.data.scenes[0].tracks.audio.push({})],
	[
		"extra native scene",
		(v) => v.record.data.scenes.push(structuredClone(v.record.data.scenes[0])),
	],
	[
		"extra scene descriptor",
		(v) => v.sceneState.scenes.push(structuredClone(v.sceneState.scenes[0])),
	],
	[
		"scene main identity",
		(v) => (v.sceneState.scenes[0].mainTrackId = "particle-track"),
	],
	["scene name", (v) => (v.record.data.scenes[0].name = "Changed")],
	["scene main flag", (v) => (v.record.data.scenes[0].isMain = false)],
	["scene ID", (v) => (v.record.data.scenes[0].id = "changed")],
	["native current scene", (v) => (v.record.data.currentSceneId = "changed")],
	["projected current scene", (v) => (v.sceneState.currentSceneId = "changed")],
	["bookmark", (v) => v.record.data.scenes[0].bookmarks.push({})],
	["motion text sequence", (v) => v.record.data.motionTextSequences.push({})],
	["unexpected topology key", (v) => (v.baselineTopology.approved = true)],
	[
		"mutated saved initial main",
		(v) => (v.baselineTopology.mainTrack.hidden = true),
	],
];
for (const [name, change] of finalChanges) {
	test("final topology rejects " + name, () => {
		const value = baselineState();
		change(value);
		assert.throws(() => assertParticleBaselineTopology(value));
	});
}
test("workflow captures revision-zero topology before resource import and preserves UI snapshot shape", async () => {
	const source = await readFile(
		new URL("./particle-authority-compile-workflow.ts", import.meta.url),
		"utf8",
	);
	assert.ok(
		source.indexOf("captureParticleBaselineTopology({") <
			source.indexOf('json("programmatic/resources/import"'),
	);
	assert.ok(
		source.indexOf('checkpoint("baseline", 0)') <
			source.indexOf("captureParticleBaselineTopology({"),
	);
	assert.match(
		source,
		/baselineTopologyPath = join\(root, "baseline-topology.json"\)/,
	);
	const state = source.slice(
		source.indexOf("\tconst state = {"),
		source.indexOf("\tconst wrapper ="),
	);
	assert.match(state, /clips:/);
	assert.match(state, /tracks:/);
	assert.match(state, /revision:/);
	assert.doesNotMatch(state, /sceneState|baselineTopology/);
	assert.match(
		source,
		/sceneState: \(await session.host!\.automation.project\(\)\).sceneState/,
	);
	assert.match(source, /selfApproved: false/);
});
