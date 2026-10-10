import {
	ALL_FORMATS,
	BufferSource,
	CanvasSink,
	EncodedPacketSink,
	Input,
} from "mediabunny";
import { codecDifference } from "./droplets-pipeline-cases";
import { check, fingerprint } from "./droplets-pipeline-support";
import { highChromaContract } from "./high-chroma-contract";
import { highChromaPixels } from "./high-chroma-scenes";

export async function decodeHighChromaVideo({
	bytes,
	expected,
	baseline,
	width,
	height,
	fps,
	videoChroma,
}: {
	bytes: ArrayBuffer;
	expected: Uint8ClampedArray[];
	baseline: Uint8ClampedArray;
	width: number;
	height: number;
	fps: number;
	videoChroma?: "420" | "444";
}) {
	const input = new Input({
		source: new BufferSource(bytes),
		formats: ALL_FORMATS,
	});
	const metrics: (ReturnType<typeof codecDifference> & {
		index: number;
		timestamp: number;
		duration: number;
		timingAccepted: boolean;
		fingerprint: string;
	})[] = [];
	const packetTiming: {
		index: number;
		timestamp: number;
		duration: number;
		accepted: boolean;
	}[] = [];
	const decoded: Uint8ClampedArray[] = [];
	const tolerance = highChromaContract.thresholds.exportTimestampSeconds;
	const timing = (timestamp: number, duration: number, index: number) =>
		Number.isFinite(timestamp) &&
		Number.isFinite(duration) &&
		Math.abs(timestamp - index / fps) <= tolerance &&
		Math.abs(duration - 1 / fps) <= tolerance;
	let duration = 0,
		codecString: string | null = null;
	let colorSpace: VideoColorSpaceInit | null = null;
	try {
		const track = await input.getPrimaryVideoTrack();
		check(
			track && (await track.getCodec()) === "vp9",
			"Expected actual VP9 output",
		);
		check(
			(await track.getDisplayWidth()) === width &&
				(await track.getDisplayHeight()) === height,
			"Export dimensions changed",
		);
		codecString = await track.getCodecParameterString();
		colorSpace = await track.getColorSpace();
		const profile = videoChroma === "444" ? "01" : "00";
		check(
			codecString?.startsWith(`vp09.${profile}.`),
			"Requested chroma profile was not produced",
		);
		duration = await track.computeDuration();
		for await (const packet of new EncodedPacketSink(track).packets()) {
			const index = packetTiming.length;
			check(index < expected.length, "Too many encoded packets");
			packetTiming.push({
				index,
				timestamp: packet.timestamp,
				duration: packet.duration,
				accepted: timing(packet.timestamp, packet.duration, index),
			});
		}
		for await (const sample of new CanvasSink(track).canvases()) {
			const index = decoded.length;
			check(index < expected.length, "Too many decoded frames");
			check(
				sample.canvas.width === width && sample.canvas.height === height,
				"Decoded dimensions changed",
			);
			const actual = highChromaPixels(sample.canvas, width, height);
			decoded.push(actual);
			metrics.push({
				index,
				timestamp: sample.timestamp,
				duration: sample.duration,
				...codecDifference(actual, expected[index], baseline),
				timingAccepted: timing(sample.timestamp, sample.duration, index),
				fingerprint: fingerprint(actual),
			});
		}
	} finally {
		input.dispose();
	}
	const expectedDuration = expected.length / fps;
	const last = metrics.at(-1),
		lastPacket = packetTiming.at(-1);
	const lastEnd = last ? last.timestamp + last.duration : NaN;
	const lastPacketEnd = lastPacket
		? lastPacket.timestamp + lastPacket.duration
		: NaN;
	const durationAccepted = [duration, lastEnd, lastPacketEnd].every(
		(value) =>
			Number.isFinite(value) && Math.abs(value - expectedDuration) <= tolerance,
	);
	const negativeControls = {
		baseline: expected.map((frame) =>
			codecDifference(baseline, frame, baseline),
		),
		repeatedReference: expected.map((frame) =>
			codecDifference(expected[0], frame, baseline),
		),
		repeatedDecoded: decoded.length
			? expected.map((frame) => codecDifference(decoded[0], frame, baseline))
			: [],
	};
	check(
		negativeControls.baseline.every((item) => !item.accepted),
		"No-op sequence evades reference gate",
	);
	check(
		negativeControls.repeatedReference.slice(1).every((item) => !item.accepted),
		"Repeated first reference evades temporal gate",
	);
	check(
		negativeControls.repeatedDecoded.slice(1).every((item) => !item.accepted),
		"Repeated first decoded frame evades temporal gate",
	);
	return {
		accepted:
			decoded.length === expected.length &&
			packetTiming.length === expected.length &&
			metrics.every((item) => item.accepted && item.timingAccepted) &&
			packetTiming.every((item) => item.accepted) &&
			durationAccepted,
		codecString,
		colorSpace,
		metrics,
		packetTiming,
		duration,
		lastEnd,
		lastPacketEnd,
		expectedDuration,
		durationAccepted,
		negativeControls,
	};
}
