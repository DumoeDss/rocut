import { dropletsDifference } from "./droplets-oracle";
import {
	pipelineDuration,
	pipelineLocalTicks,
	pipelineOffset,
	pipelineSize,
	pipelineThresholds,
} from "./droplets-pipeline-cases";
import {
	dropletsScene,
	expectedAt,
	type DropletsScene,
	type Placement,
} from "./droplets-pipeline-scenes";
import {
	base64,
	check,
	fingerprint,
	pixels,
	same,
	type DropletsPipeline,
} from "./droplets-pipeline-support";

export async function captureDroplets(
	pipeline: DropletsPipeline,
	scene: DropletsScene,
	time: number,
) {
	const actual = await pipeline.renderer.renderAndCapture({
		node: scene.node,
		time,
		capture: pixels,
	});
	const expected = expectedAt(scene, time);
	const difference = dropletsDifference(actual, expected, expected.baseline);
	if (difference.failed || difference.outsideFailed) {
		Reflect.set(globalThis, "__dropletsPipelineDiagnostics", {
			stage: "independent production capture",
			kind: scene.kind,
			placement: scene.placement,
			timelineTicks: time,
			localTicks: expected.local,
			animated: scene.animated,
			params: expected.params,
			...pipelineSize,
			source: base64([scene.source]),
			baseline: base64([expected.baseline]),
			expected: base64([expected.pixels]),
			actual: base64([actual]),
			difference,
		});
	}
	check(
		!difference.failed && !difference.outsideFailed,
		`${scene.placement}/${scene.kind} t${time} differs from the independent oracle: ${JSON.stringify(difference)}`,
	);
	return {
		actual,
		expected,
		result: {
			name: "production capture vs independent oracle",
			kind: scene.kind,
			placement: scene.placement,
			animated: scene.animated,
			time,
			localTime: expected.local,
			active: expected.active,
			activePixels: expected.activePixels,
			...difference,
			fingerprint: fingerprint(actual),
		},
	};
}

export async function checkDropletsPreview(pipeline: DropletsPipeline) {
	const results: Record<string, unknown>[] = [];
	for (const placement of ["attached", "effect-layer"] as Placement[]) {
		for (const kind of ["opaque", "holes"] as const) {
			const scene = dropletsScene({ placement, kind });
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
				const capture = await captureDroplets(
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
				"Production Droplets did not change over time",
			);
			for (const local of [68000, 0, 48000, 4000, 68000]) {
				const capture = await captureDroplets(
					pipeline,
					scene,
					scene.offset + local,
				);
				check(
					same(capture.actual, saved.get(local)!),
					"Repeated/reverse seek changed identical input",
				);
			}
			const shifted = dropletsScene({
				placement,
				kind,
				offset: 20000,
				trimmed: false,
			});
			const shiftedCapture = await captureDroplets(
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
				repeatedTimes: [68000, 0, 48000, 4000, 68000],
				shiftedOffset: 20000,
				trimDoesNotRetargetEffectClock: true,
			});
		}
	}
	for (const kind of ["opaque", "holes"] as const) {
		const scene = dropletsScene({
			placement: "attached",
			kind,
			animated: true,
		});
		const saved = new Map<number, Uint8ClampedArray>();
		for (const local of pipelineLocalTicks) {
			const capture = await captureDroplets(
				pipeline,
				scene,
				scene.offset + local,
			);
			saved.set(local, capture.actual);
			results.push(capture.result);
		}
		for (const local of [...pipelineLocalTicks].reverse()) {
			const captured = await captureDroplets(
				pipeline,
				scene,
				scene.offset + local,
			);
			check(
				same(captured.actual, saved.get(local)!),
				"Animated reverse seek changed identical input",
			);
		}
		if (kind === "holes") {
			// An attached image is flattened onto the frame's opaque black clear.
			// A scene effect can produce edge alpha after that composition.
			const alphaScene = dropletsScene({ placement: "effect-layer", kind });
			const alphaCapture = await captureDroplets(
				pipeline,
				alphaScene,
				pipelineOffset + 68000,
			);
			results.push(alphaCapture.result);
			const target = document.createElement("canvas");
			Object.assign(target, pipelineSize);
			const context = target.getContext("2d");
			check(context, "Missing preview target context");
			context.fillStyle = "#ec2ba4";
			context.fillRect(0, 0, target.width, target.height);
			const sentinel = pixels(target);
			context.globalCompositeOperation = "multiply";
			await pipeline.renderer.renderToCanvas({
				node: alphaScene.node,
				time: pipelineOffset + 68000,
				targetCanvas: target,
			});
			const actual = pixels(target),
				reference = alphaCapture.actual;
			check(
				context.globalCompositeOperation === "multiply",
				"Preview changed caller composite mode",
			);
			check(
				reference.some((value, index) => index % 4 === 3 && value < 255),
				"Alpha preview fixture is opaque",
			);
			if (!same(actual, reference))
				Reflect.set(globalThis, "__dropletsPipelineDiagnostics", {
					stage: "preview full-frame replacement",
					...pipelineSize,
					actual: base64([actual]),
					expected: base64([reference]),
					baseline: base64([sentinel]),
				});
			check(
				same(actual, reference) && !same(actual, sentinel),
				"Preview retained previous target content",
			);
			results.push({
				name: "alpha preview replaces old content and preserves composite mode",
				mode: context.globalCompositeOperation,
				fingerprint: fingerprint(actual),
				exactCaptureParity: true,
			});
		}
	}
	return { thresholds: pipelineThresholds, results };
}
