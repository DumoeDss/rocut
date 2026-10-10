import assert from "node:assert/strict";
import { blazeExpected } from "./blaze-oracle";
import type { BlazeParams } from "./blaze-cases";
import {
	blazeHostAnimated,
	blazeHostParams,
	blazeHostSettings,
} from "./blaze-host-contract";
import { blazeEditorChanges } from "./blaze-editor-contract.mjs";
import { blazeEditorExportFrameTicks } from "./blaze-editor-export-contract.mjs";
import { compareBlazePipelineFrame } from "../probe-blaze-pipeline-metrics.mjs";

export type BlazeEditorExportSegment = "static" | "animated" | "disabled";
export function blazeEditorExportParams(
	segment: BlazeEditorExportSegment,
	ticks: number,
): BlazeParams {
	assert(Number.isSafeInteger(ticks) && ticks >= 0 && ticks < 120000);
	const params: BlazeParams = { ...blazeHostParams };
	if (segment === "static") {
		for (const change of blazeEditorChanges)
			params[change.key as keyof BlazeParams] = change.value;
	} else if (segment === "animated") {
		const progress = Math.min(1, Math.max(0, ticks / 24000));
		for (const [key, [start, end]] of Object.entries(blazeHostAnimated))
			params[key as keyof BlazeParams] = start + (end - start) * progress;
	} else assert.equal(segment, "disabled");
	return params;
}
export function blazeEditorExportBlack(pixels: Uint8ClampedArray) {
	const output = new Uint8ClampedArray(pixels.length);
	for (let index = 0; index < pixels.length; index += 4) {
		for (let channel = 0; channel < 3; channel++)
			output[index + channel] = Math.round(
				(pixels[index + channel] * pixels[index + 3]) / 255,
			);
		output[index + 3] = 255;
	}
	return output;
}
function referenceFrame(
	source: Uint8ClampedArray,
	params: BlazeParams,
	ticks: number,
) {
	return blazeEditorExportBlack(
		blazeExpected({
			source,
			width: blazeHostSettings.width,
			height: blazeHostSettings.height,
			params,
			ticks,
			rate: blazeHostSettings.frameRate,
		}).pixels,
	);
}
export function blazeEditorExportReferences(
	source: Uint8ClampedArray,
	segment: BlazeEditorExportSegment,
) {
	assert.equal(source.length, 192 * 128 * 4);
	const baseline = blazeEditorExportBlack(source);
	const params = blazeEditorExportFrameTicks.map((ticks) =>
		blazeEditorExportParams(segment, ticks),
	);
	const expected = blazeEditorExportFrameTicks.map((ticks, index) =>
		segment === "disabled"
			? new Uint8ClampedArray(baseline)
			: referenceFrame(source, params[index], ticks),
	);
	const negatives =
		segment === "disabled"
			? null
			: {
					noEffect: expected.map((frame) =>
						compareBlazePipelineFrame(baseline, frame, baseline),
					),
					repeatedExpectedFirst: expected.map((frame) =>
						compareBlazePipelineFrame(expected[0], frame, baseline),
					),
					...(segment === "static"
						? {
								oldUiParams: expected.map((frame, index) =>
									compareBlazePipelineFrame(
										referenceFrame(
											source,
											{ ...blazeHostParams },
											blazeEditorExportFrameTicks[index],
										),
										frame,
										baseline,
									),
								),
								wrongSeed: expected.map((frame, index) =>
									compareBlazePipelineFrame(
										referenceFrame(
											source,
											{ ...params[index], seed: blazeHostSettings.seed },
											blazeEditorExportFrameTicks[index],
										),
										frame,
										baseline,
									),
								),
							}
						: {}),
				};
	const discrimination =
		segment === "disabled"
			? {
					accepted: true,
					criterion: "No active effect; whole-image gate only",
				}
			: {
					accepted:
						negatives!.noEffect.every((metric) => !metric.pass) &&
						(segment === "animated"
							? negatives!.repeatedExpectedFirst
									.slice(1)
									.some((metric) => !metric.pass)
							: negatives!.oldUiParams!.some((metric) => !metric.pass) &&
								negatives!.wrongSeed!.some((metric) => !metric.pass)),
					criterion:
						segment === "animated"
							? "no-effect every frame and repeated-first at least one later frame rejected"
							: "no-effect every frame, old-UI and wrong-seed at least one frame rejected",
				};
	return { segment, params, expected, baseline, negatives, discrimination };
}
