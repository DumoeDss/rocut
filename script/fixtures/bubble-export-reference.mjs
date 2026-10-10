import assert from "node:assert/strict";
import { renderBubbleOracle } from "./bubble-oracle.mjs";
import { flattenBubbleParams, makeBubbleSource } from "./bubble-cases.mjs";
import { bubbleExportContract as spec, bubbleExportSegments } from "./bubble-export-contract.mjs";
import { compareBlazePipelineFrame } from "../probe-blaze-pipeline-metrics.mjs";

export const bubbleExportSource = () => makeBubbleSource(spec.sourceSpec, spec.width, spec.height);
export function bubbleExportBlack(source) {
	assert.equal(source.length, spec.width * spec.height * 4);
	const output = new Uint8Array(source.length);
	for (let i = 0; i < source.length; i += 4) {
		for (let channel = 0; channel < 3; channel++) output[i + channel] = Math.round(source[i + channel] * source[i + 3] / 255);
		output[i + 3] = 255;
	}
	return output;
}
export function bubbleExportParams(segment, ticks, animate = true) {
	assert(bubbleExportSegments.some((item) => item.id === segment));
	const params = structuredClone(spec.params);
	if (segment === "animated" && animate) {
		const [start, end] = spec.keyframeLocalTicks, progress = Math.min(1, Math.max(0, (ticks - start) / (end - start)));
		for (const [key, [a, b]] of Object.entries(spec.animated)) {
			const value = a + (b - a) * progress;
			if (key.startsWith("tint") && key.length === 5) params.tint["RGB".indexOf(key[4])] = value;
			else params[key] = value;
		}
	}
	return params;
}
export function bubbleExportSample(segment, ticks, overrides = {}) {
	return { width: spec.width, height: spec.height, enabled: segment !== "disabled",
		schedule: structuredClone(spec.schedule), params: bubbleExportParams(segment, ticks),
		ticks, frameRate: spec.frameRate, ...overrides };
}
export function compareBubbleExportFrame(actual, expected, baseline, enabled) {
	const result = compareBlazePipelineFrame(actual, expected, baseline);
	return enabled ? result : { ...result, pass: result.meanRgba <= spec.thresholds.exportMeanRgba,
		criterion: "Disabled whole-image codec gate; no active-effect population exists" };
}
export function bubbleExportReferences(source, segment) {
	const configuration = bubbleExportSegments.find((item) => item.id === segment); assert(configuration);
	const baseline = bubbleExportBlack(source);
	const render = (ticks, changes) => bubbleExportBlack(renderBubbleOracle(bubbleExportSample(segment, ticks, changes), source).rgba);
	const expected = spec.localTicks.map((ticks) => render(ticks));
	const metric = (actual, index) => compareBubbleExportFrame(actual, expected[index], baseline, configuration.enabled);
	const negatives = !configuration.enabled ? {} : {
		noEffect: expected.map((_, index) => metric(baseline, index)),
		repeatedFirst: expected.map((_, index) => metric(expected[0], index)),
		timelineClock: spec.localTicks.map((ticks, index) => metric(render(ticks + configuration.offset), index)),
		sourceTrimClock: spec.localTicks.map((ticks, index) => metric(render(ticks + spec.trimStart), index)),
		missingStartOffset: spec.localTicks.map((ticks, index) => metric(render(ticks, { schedule: { ...spec.schedule, startTicks: 0 } }), index)),
		...(segment === "animated" ? { ignoredAnimation: spec.localTicks.map((ticks, index) =>
			metric(render(ticks, { params: bubbleExportParams(segment, ticks, false) }), index)) } : {}),
	};
	const rejectedFrames = Object.fromEntries(Object.entries(negatives).map(([name, metrics]) => [name,
		metrics.flatMap((value, index) => value.pass ? [] : [index])]));
	const discrimination = { accepted: !configuration.enabled ||
		rejectedFrames.noEffect.length === spec.frames && Object.entries(rejectedFrames).every(([name, indices]) =>
			name === "repeatedFirst" ? indices.some((index) => index > 0) : indices.length > 0), rejectedFrames };
	return { segment, expected, baseline, negatives, discrimination,
		params: spec.localTicks.map((ticks) => flattenBubbleParams(bubbleExportSample(segment, ticks))) };
}

export function bubbleExportClips(creator, resource) {
	assert.equal(typeof creator.bubbleImage, "function");
	return bubbleExportSegments.map((segment) => {
		const shot = creator.bubbleImage({ image: structuredClone(resource),
			settings: { width: spec.width, height: spec.height, frameRate: spec.frameRate, durationFrames: 60, seed: 97 },
			params: (() => { const params = flattenBubbleParams(bubbleExportSample("moving", spec.localTicks[0]));
				for (const key of Object.keys(params)) if (key === "pointCount" || /^point\d/.test(key)) delete params[key];
				return params; })(),
			knots: spec.schedule.knots.map(({ ticks: time, x, y }) => ({ time, x, y })),
			keyframes: segment.id === "animated" ? Object.fromEntries(Object.entries(spec.animated).map(([key, values]) =>
				[key, values.map((value, index) => ({ time: spec.keyframeLocalTicks[index], value }))])) : {},
		});
		assert.equal(shot.effects.length, 1); assert.equal(shot.effects[0].id, spec.effectId);
		assert.equal(shot.effects[0].type, "bubble");
		assert.deepEqual(shot.effects[0].params, flattenBubbleParams(bubbleExportSample("moving", spec.localTicks[0])));
		assert.deepEqual(shot.source.resources, [resource]);
		shot.effects[0].enabled = segment.enabled;
		return { id: segment.clipId, trackId: spec.trackId, startTime: segment.offset,
			duration: spec.clipDuration, trimStart: spec.trimStart, trimEnd: spec.trimEnd,
			editing: { type: "graphic", name: segment.clipId, definitionId: "programmatic", params: {},
				programmatic: shot.source, effects: shot.effects, animations: shot.animations } };
	});
}
