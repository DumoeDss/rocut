import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { validateHighChromaMedia } from "../probe-high-chroma-contract.mjs";
import { codecDifference, pipelineThresholds } from "./droplets-pipeline-cases";
import { highChromaContract } from "./high-chroma-contract";
import {
	dropletsHighChromaReference,
	largerHighChromaReference,
} from "./high-chroma-reference";

function sha256(frames: Uint8ClampedArray[]) {
	const hash = createHash("sha256");
	for (const frame of frames) hash.update(frame);
	return hash.digest("hex");
}

test("formal 444 keeps the exact frozen Droplets source, oracle and backdrop", () => {
	const value = dropletsHighChromaReference();
	expect(sha256([value.source])).toBe(value.sourceSha256);
	expect(sha256(value.expected)).toBe(value.expectedSha256);
	expect(sha256([value.baseline])).toBe(value.baselineSha256);
	expect(value.expected).toHaveLength(6);
	expect(value.paramsPerFrame).toHaveLength(6);
	for (const [key, threshold] of Object.entries(highChromaContract.thresholds))
		expect(pipelineThresholds[key as keyof typeof pipelineThresholds]).toBe(
			threshold,
		);
});

test("both fixed references reject no-op and repeated-first sequences", () => {
	for (const reference of [
		dropletsHighChromaReference(),
		largerHighChromaReference(),
	]) {
		for (const [index, frame] of reference.expected.entries()) {
			expect(codecDifference(frame, frame, reference.baseline).accepted).toBe(
				true,
			);
			expect(
				codecDifference(reference.baseline, frame, reference.baseline).accepted,
			).toBe(false);
			if (index)
				expect(
					codecDifference(reference.expected[0], frame, reference.baseline)
						.accepted,
				).toBe(false);
		}
	}
});

test("larger independent fixture is truly another size/rate and exact tick grid", () => {
	const value = largerHighChromaReference();
	expect(sha256(value.expected)).toBe(value.expectedSha256);
	expect(sha256([value.baseline])).toBe(value.baselineSha256);
	expect(value.width * value.height).toBeGreaterThan(192 * 128);
	expect(value.fps).toBe(24);
	expect(value.frameTicks * value.fps).toBe(120000);
	expect(value.frames / value.fps).toBe(0.25);
	for (const [index, frame] of value.expected.entries()) {
		expect(frame.length).toBe(640 * 360 * 4);
		expect(value.timelineTicks[index]).toBe(index * 5000);
	}
});

test("Node artifact contract agrees exactly with both independent TS references", () => {
	for (const reference of [
		dropletsHighChromaReference(),
		largerHighChromaReference(),
	]) {
		const spec = validateHighChromaMedia({
			...reference,
			caseId: reference.id,
			codec: "vp9",
			mimeType: "video/webm",
			quality: "very_high",
			requestedVideoChroma: "444",
			reference: "CPU contract parity only",
			thresholds: highChromaContract.thresholds,
		});
		expect(spec.expectedSha256).toBe(reference.expectedSha256);
		expect(spec.baselineSha256).toBe(reference.baselineSha256);
	}
});
