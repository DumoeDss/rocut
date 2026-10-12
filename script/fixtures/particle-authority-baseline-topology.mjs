import assert from "node:assert/strict";

function assertDefaultTopology({ sceneState, mainTrack, nativeMainTrack }) {
	assert.equal(sceneState.scenes.length, 1);
	const scene = sceneState.scenes[0];
	assert.ok(typeof scene.id === "string" && scene.id.length > 0);
	assert.ok(
		typeof scene.mainTrackId === "string" &&
			scene.mainTrackId.length > 0 &&
			scene.mainTrackId !== "particle-track",
	);
	assert.deepEqual(sceneState, {
		currentSceneId: scene.id,
		scenes: [
			{
				id: scene.id,
				name: "Main scene",
				isMain: true,
				mainTrackId: scene.mainTrackId,
			},
		],
	});
	assert.deepEqual(mainTrack, {
		id: scene.mainTrackId,
		kind: "video",
		name: "Main Track",
		muted: false,
		hidden: false,
		sceneId: scene.id,
	});
	assert.deepEqual(nativeMainTrack, {
		id: scene.mainTrackId,
		name: "Main Track",
		type: "video",
		elements: [],
		muted: false,
		hidden: false,
	});
}

function assertSceneRecord({ record, sceneState, nativeMainTrack }) {
	const data = record.data;
	assert.equal(data.scenes.length, 1);
	const scene = data.scenes[0],
		descriptor = sceneState.scenes[0];
	assert.equal(data.currentSceneId, sceneState.currentSceneId);
	assert.deepEqual(
		{ id: scene.id, name: scene.name, isMain: scene.isMain },
		{ id: descriptor.id, name: descriptor.name, isMain: descriptor.isMain },
	);
	assert.deepEqual(Object.keys(scene.tracks).sort(), [
		"audio",
		"main",
		"overlay",
	]);
	assert.deepEqual(scene.tracks.main, nativeMainTrack);
	assert.deepEqual(scene.tracks.audio, []);
	assert.deepEqual(scene.bookmarks, []);
	assert.deepEqual(data.motionTextSequences, []);
	return scene;
}

// Capture only the revision-zero empty editor topology, never the final state.
export function captureParticleBaselineTopology({ state, record, sceneState }) {
	assert.equal(state.revision, 0);
	assert.deepEqual(state.clips, []);
	assert.equal(state.tracks.length, 1);
	const topology = {
		schema: "particle-baseline-topology/v1",
		sceneState,
		mainTrack: state.tracks[0],
		nativeMainTrack: record.data.scenes[0]?.tracks.main,
	};
	assertDefaultTopology(topology);
	const scene = assertSceneRecord({ record, ...topology });
	assert.deepEqual(scene.tracks.overlay, []);
	return structuredClone(topology);
}

export function assertParticleBaselineTopology({
	state,
	record,
	sceneState,
	baselineTopology,
}) {
	assert.deepEqual(Object.keys(baselineTopology).sort(), [
		"mainTrack",
		"nativeMainTrack",
		"sceneState",
		"schema",
	]);
	assert.equal(baselineTopology.schema, "particle-baseline-topology/v1");
	assertDefaultTopology(baselineTopology);
	assert.deepEqual(sceneState, baselineTopology.sceneState);
	assert.equal(state.tracks.length, 2);
	assert.equal(new Set(state.tracks.map((track) => track.id)).size, 2);
	const main = state.tracks.find(
		(track) => track.id === baselineTopology.mainTrack.id,
	);
	assert.deepEqual(main, baselineTopology.mainTrack);
	const authored = state.tracks.find((track) => track.id === "particle-track");
	assert.deepEqual(authored, {
		id: "particle-track",
		name: "Particle C4",
		kind: "graphic",
		hidden: false,
		sceneId: sceneState.currentSceneId,
	});
	assert.equal(state.clips.length, 1);
	const clip = state.clips[0];
	assert.equal(clip.id, "particle-model");
	assert.equal(clip.trackId, authored.id);
	const scene = assertSceneRecord({ record, ...baselineTopology });
	assert.deepEqual(scene.tracks.overlay, [
		{
			id: authored.id,
			name: authored.name,
			type: authored.kind,
			hidden: authored.hidden,
			elements: [
				{
					id: clip.id,
					name: clip.editing.name,
					type: clip.editing.type,
					duration: clip.duration,
					startTime: clip.startTime,
					trimStart: clip.trimStart,
					trimEnd: clip.trimEnd,
					params: clip.editing.params,
					effects: clip.editing.effects,
					definitionId: clip.editing.definitionId,
					programmatic: clip.editing.programmatic,
				},
			],
		},
	]);
}
