import assert from "node:assert/strict";
export function frostEffect(graph, { clipId, effectId }) {
	const clips = graph.clips.filter((clip) => clip.id === clipId);
	assert.equal(clips.length, 1, "Missing/ambiguous Frost target clip");
	const effects = clips[0].editing?.effects?.filter(
		(effect) => effect.id === effectId,
	);
	assert.equal(effects?.length, 1, "Missing/ambiguous Frost effect");
	assert.equal(effects[0].type, "frost");
	assert.equal(effects[0].enabled, true);
	return { clip: clips[0], effect: effects[0] };
}
export function editedFrostClip(clip, effectId, key, value) {
	const expected = structuredClone(clip);
	const effect = expected.editing.effects.find((item) => item.id === effectId);
	assert(effect && Object.hasOwn(effect.params, key), `Missing ${key}`);
	effect.params[key] = value;
	return expected;
}
export function assertFrostTransition(before, after, expectedClip) {
	assert(
		Number.isSafeInteger(after.revision) && after.revision > before.revision,
		"Revision did not advance",
	);
	assert.deepEqual(
		after.project,
		before.project,
		"History/edit changed project",
	);
	assert.deepEqual(after.tracks, before.tracks, "History/edit changed tracks");
	assert.deepEqual(
		after.clips,
		before.clips.map((clip) =>
			clip.id === expectedClip.id ? expectedClip : clip,
		),
		"Complete clip or neighbors changed unexpectedly",
	);
}

export const frostChanges = [
	{ key: "coverage", value: 0.625 },
	{ key: "refraction", value: 0 },
	{ key: "seed", value: 41 },
	{ key: "stroke0Radius", value: 0.1375 },
	{ key: "recoveryTicks", value: 120000 },
];
