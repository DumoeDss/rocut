import { cloudsDifference } from "./clouds-oracle";
import { captureClouds } from "./clouds-pipeline-capture";
import {
	pipelineAnimated,
	pipelineDuration,
	pipelineLocalTicks,
	pipelineThresholds,
	type PipelineChannel,
	type Placement,
} from "./clouds-pipeline-cases";
import { checkCloudsPublication } from "./clouds-pipeline-publish";
import { cloudsScene } from "./clouds-pipeline-scenes";
import { check, same, type CloudsPipeline } from "./clouds-pipeline-support";

async function checkStatic(pipeline: CloudsPipeline) {
	const results: Record<string, unknown>[] = [];
	for (const placement of ["attached", "effect-layer"] as Placement[]) {
		for (const kind of ["opaque", "holes", "transparent"] as const) {
			const scene = cloudsScene({ placement, kind });
			const saved = new Map<number, Uint8ClampedArray>();
			for (const local of [
				-1,
				0,
				3999,
				4000,
				48000,
				68000,
				pipelineDuration - 1,
				pipelineDuration,
			]) {
				const capture = await captureClouds(
					pipeline,
					scene,
					scene.offset + local,
				);
				saved.set(local, capture.actual);
				results.push(capture.result);
			}
			check(
				same(saved.get(0)!, saved.get(3999)!),
				"Static optics did not use frame-floored local ticks",
			);
			check(
				!same(saved.get(48000)!, saved.get(68000)!),
				"Production Clouds did not change over time",
			);
			const repeatedTimes = [68000, 0, 48000, 4000, 68000];
			for (const local of repeatedTimes) {
				const capture = await captureClouds(
					pipeline,
					scene,
					scene.offset + local,
				);
				check(
					same(capture.actual, saved.get(local)!),
					"Repeated/reverse seek changed identical input",
				);
			}
			const shifted = cloudsScene({
				placement,
				kind,
				offset: 20000,
				trimmed: false,
			});
			const shiftedCapture = await captureClouds(
				pipeline,
				shifted,
				shifted.offset + 48000,
			);
			check(
				same(shiftedCapture.actual, saved.get(48000)!),
				"Effect clock used timeline offset or source trim",
			);
			results.push({
				name: "repeat/reverse and offset/trim invariance",
				placement,
				kind,
				repeatedTimes,
				shiftedOffset: 20000,
				trimDoesNotRetargetEffectClock: true,
			});
		}
	}
	return results;
}

async function checkAnimation(pipeline: CloudsPipeline) {
	const results: Record<string, unknown>[] = [];
	for (const kind of ["opaque", "holes"] as const) {
		const scene = cloudsScene({ placement: "attached", kind, animated: true });
		const saved = new Map<number, Uint8ClampedArray>();
		for (const local of pipelineLocalTicks) {
			const capture = await captureClouds(
				pipeline,
				scene,
				scene.offset + local,
			);
			saved.set(local, capture.actual);
			results.push(capture.result);
		}
		for (const local of [...pipelineLocalTicks].reverse()) {
			const capture = await captureClouds(
				pipeline,
				scene,
				scene.offset + local,
			);
			check(
				same(capture.actual, saved.get(local)!),
				"Animated reverse seek changed identical input",
			);
		}
		const shifted = cloudsScene({
			placement: "attached",
			kind,
			animated: true,
			offset: 20000,
			trimmed: false,
		});
		for (const local of [48000, 68000]) {
			const capture = await captureClouds(
				pipeline,
				shifted,
				shifted.offset + local,
			);
			check(
				same(capture.actual, saved.get(local)!),
				"Animated clock used timeline offset or source trim",
			);
		}
	}
	const staticScene = cloudsScene({ placement: "attached", kind: "holes" });
	const staticFrame = await captureClouds(
		pipeline,
		staticScene,
		staticScene.offset + 68000,
	);
	for (const onlyChannel of Object.keys(
		pipelineAnimated,
	) as PipelineChannel[]) {
		const scene = cloudsScene({
			placement: "attached",
			kind: "holes",
			animated: true,
			onlyChannel,
		});
		for (const local of [48000, 58000, 68000]) {
			const capture = await captureClouds(
				pipeline,
				scene,
				scene.offset + local,
			);
			results.push(capture.result);
			if (local === 68000) {
				const negative = cloudsDifference(
					staticFrame.actual,
					capture.expected,
					capture.expected.baseline,
				);
				check(
					negative.failed > 0,
					`${onlyChannel} animation is not observable beyond the raster gate`,
				);
				results.push({
					name: "isolated animation rejects static parameter",
					channel: onlyChannel,
					negative,
				});
			}
		}
	}
	return results;
}

export async function checkCloudsPreview(pipeline: CloudsPipeline) {
	return {
		thresholds: pipelineThresholds,
		results: [
			...(await checkStatic(pipeline)),
			...(await checkAnimation(pipeline)),
			await checkCloudsPublication(pipeline),
		],
	};
}
