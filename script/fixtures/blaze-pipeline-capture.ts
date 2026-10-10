import { compareBlazeRaw } from "./blaze-browser-metrics";
import { pipelineSize } from "./blaze-pipeline-cases";
import { expectedAt, type BlazeScene } from "./blaze-pipeline-scenes";
import {
	base64,
	check,
	pixels,
	type BlazePipeline,
} from "./blaze-pipeline-support";

export async function captureBlazePipeline(
	pipeline: BlazePipeline,
	scene: BlazeScene,
	timelineTicks: number,
	label: string,
) {
	const expected = expectedAt(scene, timelineTicks);
	const actual = await pipeline.renderer.renderAndCapture({
		node: scene.node,
		time: timelineTicks,
		capture: pixels,
	});
	const metric = compareBlazeRaw(actual, expected.pixels);
	const captures = Reflect.get(globalThis, "__blazePipelineCaptures") as Record<
		string,
		unknown
	>[];
	captures.push({
		label,
		...pipelineSize,
		timelineTicks,
		localTicks: expected.local,
		offset: scene.offset,
		trimStart: scene.trimmed ? 16016 : 0,
		trimEnd: scene.trimmed ? 8008 : 0,
		params: expected.params,
		onlyChannel: scene.onlyChannel ?? null,
		source: base64([scene.source]),
		actual: base64([actual]),
		expected: base64([expected.pixels]),
		baseline: base64([expected.baseline]),
		metric,
	});
	check(
		metric.pass,
		`${label} actual production capture differs from independent expected: ${JSON.stringify(metric)}`,
	);
	return { actual, expected, metric };
}
