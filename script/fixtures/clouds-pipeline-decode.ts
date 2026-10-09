import {
	ALL_FORMATS,
	BufferSource,
	CanvasSink,
	EncodedPacketSink,
	Input,
} from "mediabunny";
import { pipelineSize, pipelineThresholds } from "./clouds-pipeline-cases";
import { codecDifference } from "./clouds-pipeline-metrics";
import { base64, check, fingerprint, pixels } from "./clouds-pipeline-support";

function timing(timestamp: number, duration: number, index: number) {
	const tolerance = pipelineThresholds.exportTimestampSeconds;
	return {
		index,
		timestamp,
		duration,
		accepted:
			Number.isFinite(timestamp) &&
			Number.isFinite(duration) &&
			Math.abs(timestamp - index / 30) <= tolerance &&
			Math.abs(duration - 1 / 30) <= tolerance,
	};
}

export async function decodeCloudsVideo(
	bytes: ArrayBuffer,
	expected: Uint8ClampedArray[],
	baseline: Uint8ClampedArray,
) {
	const input = new Input({
		source: new BufferSource(bytes),
		formats: ALL_FORMATS,
	});
	const metrics: (ReturnType<typeof codecDifference> & {
		index: number;
		timestamp: number;
		duration: number;
		fingerprint: string;
		timingAccepted: boolean;
	})[] = [];
	const packetTiming: ReturnType<typeof timing>[] = [];
	const decoded: Uint8ClampedArray[] = [];
	let duration = 0;
	let firstPixelFailure: Record<string, unknown> | undefined;
	try {
		const track = await input.getPrimaryVideoTrack();
		check(
			track && (await track.getCodec()) === "vp9",
			"Expected an actual VP9 video track",
		);
		check(
			(await track.getDisplayWidth()) === pipelineSize.width &&
				(await track.getDisplayHeight()) === pipelineSize.height,
			"Encoded dimensions changed",
		);
		duration = await track.computeDuration();
		const packets: { timestamp: number; duration: number }[] = [];
		for await (const packet of new EncodedPacketSink(track).packets()) {
			check(
				packets.length < expected.length,
				"Encoded video contains too many packets",
			);
			packets.push({ timestamp: packet.timestamp, duration: packet.duration });
		}
		packets.sort((a, b) => a.timestamp - b.timestamp);
		packetTiming.push(
			...packets.map((packet, index) =>
				timing(packet.timestamp, packet.duration, index),
			),
		);
		for await (const sample of new CanvasSink(track).canvases()) {
			const index = decoded.length;
			check(index < expected.length, "Encoded video contains too many frames");
			check(
				sample.canvas.width === pipelineSize.width &&
					sample.canvas.height === pipelineSize.height,
				"Decoded dimensions changed",
			);
			const actual = pixels(sample.canvas);
			const difference = codecDifference(actual, expected[index], baseline);
			if (!difference.accepted && !firstPixelFailure)
				firstPixelFailure = {
					index,
					expected: base64([expected[index]]),
					baseline: base64([baseline]),
					actual: base64([actual]),
					difference,
				};
			decoded.push(actual);
			metrics.push({
				index,
				timestamp: sample.timestamp,
				duration: sample.duration,
				...difference,
				timingAccepted: timing(sample.timestamp, sample.duration, index)
					.accepted,
				fingerprint: fingerprint(actual),
			});
		}
	} finally {
		input.dispose();
	}
	const last = metrics.at(-1);
	const lastEnd = last ? last.timestamp + last.duration : NaN;
	const expectedDuration = expected.length / 30;
	const durationAccepted =
		Number.isFinite(lastEnd) &&
		Number.isFinite(duration) &&
		Math.abs(lastEnd - expectedDuration) <=
			pipelineThresholds.exportTimestampSeconds &&
		Math.abs(duration - expectedDuration) <=
			pipelineThresholds.exportTimestampSeconds;
	const accepted =
		decoded.length === expected.length &&
		packetTiming.length === expected.length &&
		metrics.every((metric) => metric.accepted && metric.timingAccepted) &&
		packetTiming.every((packet) => packet.accepted) &&
		durationAccepted;
	if (!accepted)
		Reflect.set(globalThis, "__cloudsPipelineDiagnostics", {
			stage: "decoded production video",
			...pipelineSize,
			metrics,
			packetTiming,
			duration,
			lastEnd,
			expectedDuration,
			durationAccepted,
			firstPixelFailure,
		});
	check(
		accepted,
		`Decoded Clouds sequence exceeds declared frame/timing/pixel gates: ${JSON.stringify({ metrics, packetTiming, duration, lastEnd })}`,
	);
	const repeatedDecoded = expected.map((frame) =>
		codecDifference(decoded[0], frame, baseline),
	);
	check(
		repeatedDecoded.slice(1).some((result) => !result.accepted),
		"Decoded first-frame repetition would evade sequence validation",
	);
	return {
		metrics,
		packetTiming,
		duration,
		lastEnd,
		frames: decoded.length,
		repeatedDecoded,
	};
}
