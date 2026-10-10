import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
	accepts,
	frameIndex,
	metric,
	opaqueRgb,
	shiftRight,
	thresholds,
} from "./flame-wrap-export-metrics.mjs";
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
export async function prepareFlameWrapExportReferences({
	expectedFrames,
	artifacts,
	before,
	clip,
}) {
	const save = (name, value) =>
		writeFile(join(artifacts.root, name), JSON.stringify(value, null, 2), {
			flag: "wx",
		});
	const baselineReference = expectedFrames.find(
		(item) => item.role === "baseline",
	);
	assert(baselineReference, "Real disabled-effect production preview required");
	const disabled = before.clips.find(
		(item) => item.id === baselineReference.clipId,
	);
	assert(
		disabled &&
			disabled.editing.effects.some(
				(effect) => effect.type === "flame-wrap" && effect.enabled === false,
			),
	);
	assert.deepEqual(
		disabled.editing.programmatic,
		clip.editing.programmatic,
		"Source identity must be shared, not a synthetic oracle",
	);
	const decodeReference = (frame) => {
		assert(
			[
				"production-presentation-canvas",
				"production-presentation-boundary-copy",
			].includes(frame.captureScope),
			"Unsupported production capture scope",
		);
		assert.equal(frame.revision, before.revision);
		assert.equal(frame.width, artifacts.width);
		assert.equal(frame.height, artifacts.height);
		assert.deepEqual(frame.canvasGeometry, {
			width: artifacts.width,
			height: artifacts.height,
		});
		const bytes = Buffer.from(frame.rgbaBase64, "base64");
		assert.equal(bytes.length, artifacts.width * artifacts.height * 4);
		assert.equal(sha(bytes), frame.sha256);
		return opaqueRgb(bytes);
	};
	const baseline = decodeReference(baselineReference);
	const unique = new Map();
	for (const frame of expectedFrames.filter(
		(item) => item.role !== "baseline",
	)) {
		assert.equal(frame.clipId, artifacts.clipId);
		const rgb = decodeReference(frame);
		if (unique.has(frame.ticks))
			assert(
				rgb.equals(unique.get(frame.ticks).rgb),
				"Repeated/reloaded preview changed",
			);
		else unique.set(frame.ticks, { ...frame, rgb });
	}
	const early = unique.get(20000),
		late = unique.get(80000);
	assert(early && late, "Require exact early and late production captures");
	const final = unique.get(artifacts.finalTicks);
	assert(final, "Require exact final/reloaded production capture");
	const references = [
		...new Map(
			[early, final, late].map((frame) => [frame.ticks, frame]),
		).values(),
	];
	const range = { startTime: 20000, endTime: 85000 };
	for (const frame of references)
		assert(
			frameIndex(frame.ticks, range.startTime) < 13,
			"Reference outside exported frame range",
		);
	const sensitivity = {
		thresholds,
		noEffect: references.map((frame) => metric(baseline, frame.rgb, baseline)),
		shifted: references.map((frame) =>
			metric(
				shiftRight(frame.rgb, artifacts.width, artifacts.height),
				frame.rgb,
				baseline,
			),
		),
		frozenLate: metric(early.rgb, late.rgb, baseline),
	};
	await save("flame-wrap-export-sensitivity.json", sensitivity);
	for (const frame of references)
		assert(
			accepts(metric(frame.rgb, frame.rgb, baseline)),
			"Insufficient active-region evidence",
		);
	assert(
		sensitivity.noEffect.every((value) => !accepts(value)),
		"Cannot reject missing effect",
	);
	assert(
		sensitivity.shifted.every((value) => !accepts(value)),
		"Cannot reject shifted render",
	);
	assert(!accepts(sensitivity.frozenLate), "Cannot reject frozen time");
	return { references, baseline, sensitivity, range };
}
