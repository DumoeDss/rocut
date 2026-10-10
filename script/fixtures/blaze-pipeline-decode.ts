import {
	ALL_FORMATS,
	BufferSource,
	CanvasSink,
	EncodedPacketSink,
	Input,
} from "mediabunny";
import {
	pipelineFps,
	pipelineSize,
	pipelineThresholds,
} from "./blaze-pipeline-cases";
import { codecDifference } from "./blaze-pipeline-metrics";
import { base64, check, pixels } from "./blaze-pipeline-support";

export function pipelineTiming(
	timestamp: number,
	duration: number,
	index: number,
) {
	const interval = pipelineFps.denominator / pipelineFps.numerator;
	return {
		index,
		timestamp,
		duration,
		expectedTimestamp: index * interval,
		expectedDuration: interval,
		accepted:
			Number.isFinite(timestamp) &&
			Number.isFinite(duration) &&
			Math.abs(timestamp - index * interval) <=
				pipelineThresholds.exportTimestampSeconds &&
			Math.abs(duration - interval) <=
				pipelineThresholds.exportTimestampSeconds,
	};
}

export async function decodeBlazePipeline(
	bytes: ArrayBuffer,
	expected: Uint8ClampedArray[],
	baseline: Uint8ClampedArray,
) {
	const input = new Input({
		source: new BufferSource(bytes),
		formats: ALL_FORMATS,
	});
	const decoded: Uint8ClampedArray[] = [],
		metrics: Record<string, unknown>[] = [],
		packets: { timestamp: number; duration: number }[] = [];
	let duration = Number.NaN,
		decoderCodec = "",
		failure = "";
	try {
		const track = await input.getPrimaryVideoTrack();
		check(
			track && (await track.getCodec()) === "vp9",
			"Expected actual VP9 track",
		);
		check(
			(await track.getDisplayWidth()) === pipelineSize.width &&
				(await track.getDisplayHeight()) === pipelineSize.height,
			"Encoded Blaze dimensions changed",
		);
		decoderCodec = (await track.getDecoderConfig())?.codec ?? "";
		duration = await track.computeDuration();
		for await (const packet of new EncodedPacketSink(track).packets()) {
			check(packets.length < expected.length, "Too many Blaze packets");
			packets.push({ timestamp: packet.timestamp, duration: packet.duration });
		}
		for await (const sample of new CanvasSink(track).canvases()) {
			const index = decoded.length;
			check(index < expected.length, "Too many decoded Blaze frames");
			check(
				sample.canvas.width === pipelineSize.width &&
					sample.canvas.height === pipelineSize.height,
				"Decoded Blaze dimensions changed",
			);
			const actual = pixels(sample.canvas);
			decoded.push(actual);
			metrics.push({
				index,
				...codecDifference(actual, expected[index], baseline),
				timing: pipelineTiming(sample.timestamp, sample.duration, index),
			});
		}
	} catch (error) {
		failure = String(error);
	} finally {
		input.dispose();
	}
	const packetTiming = [...packets]
		.sort((a, b) => a.timestamp - b.timestamp)
		.map((packet, index) =>
			pipelineTiming(packet.timestamp, packet.duration, index),
		);
	const expectedDuration =
		(expected.length * pipelineFps.denominator) / pipelineFps.numerator;
	const lastTiming = metrics.at(-1)?.timing as
		| ReturnType<typeof pipelineTiming>
		| undefined;
	const lastEnd = lastTiming
		? lastTiming.timestamp + lastTiming.duration
		: Number.NaN;
	const repeatedDecoded = decoded.length
		? expected.map((frame) => codecDifference(decoded[0], frame, baseline))
		: [];
	const result = {
		failure,
		decoderCodec,
		metrics,
		packets,
		packetTiming,
		duration,
		lastEnd,
		expectedDuration,
		frames: decoded.length,
		repeatedDecoded,
		accepted:
			!failure &&
			decoded.length === expected.length &&
			packets.length === expected.length &&
			metrics.every(
				(metric) =>
					metric.accepted &&
					(metric.timing as ReturnType<typeof pipelineTiming>).accepted,
			) &&
			packetTiming.every((packet) => packet.accepted) &&
			Math.abs(duration - expectedDuration) <=
				pipelineThresholds.exportTimestampSeconds &&
			Math.abs(lastEnd - expectedDuration) <=
				pipelineThresholds.exportTimestampSeconds &&
			repeatedDecoded.slice(1).some((metric) => !metric.accepted),
	};
	Reflect.set(globalThis, "__blazePipelineDecoded", {
		...result,
		rgba: decoded.length ? base64(decoded) : null,
	});
	return result;
}
