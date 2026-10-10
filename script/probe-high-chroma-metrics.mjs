import assert from "node:assert/strict";
import {
	compareDropletsSequence,
	validateDropletsProbeTiming,
} from "./probe-droplets-metrics.mjs";
import { validateHighChromaMedia } from "./probe-high-chroma-contract.mjs";

export function highChromaProbeTiming(probe, media) {
	validateHighChromaMedia(media);
	const normalized = {
		...probe,
		frames:
			probe.frames ??
			probe.packets_and_frames?.filter((item) => item.type === "frame"),
		packets:
			probe.packets ??
			probe.packets_and_frames?.filter((item) => item.type === "packet"),
	};
	assert(
		Array.isArray(normalized.frames) && Array.isArray(normalized.packets),
		"Missing frame or packet timing",
	);
	assert.equal(normalized.streams?.length, 1, "Expected one video stream");
	const stream = normalized.streams[0];
	assert.equal(stream.codec_name, "vp9");
	assert.equal(stream.width, media.width);
	assert.equal(stream.height, media.height);
	assert.equal(
		stream.profile,
		media.requestedVideoChroma === "444" ? "Profile 1" : "Profile 0",
	);
	assert.equal(
		stream.pix_fmt,
		media.requestedVideoChroma === "444" ? "yuv444p" : "yuv420p",
	);
	const frameTiming = validateDropletsProbeTiming(normalized, {
		...media,
		localTicks: media.localTicks ?? media.timelineTicks,
	});
	const packets = normalized.packets;
	assert.equal(packets.length, media.frames, "Packet count changed");
	const tolerance = media.thresholds.exportTimestampSeconds;
	const packetTiming = packets.map((packet, index) => {
		const timestamp = Number(packet.pts_time),
			duration = Number(packet.duration_time);
		assert(
			Number.isFinite(timestamp) &&
				Math.abs(timestamp - index / media.fps) <= tolerance,
			"Packet PTS changed",
		);
		assert(
			Number.isFinite(duration) &&
				Math.abs(duration - 1 / media.fps) <= tolerance,
			"Packet duration changed",
		);
		if (index)
			assert(
				timestamp > Number(packets[index - 1].pts_time),
				"Packet PTS is not increasing",
			);
		assert(
			/^SHA256:[0-9a-f]{64}$/.test(packet.data_hash),
			"Missing compressed packet hash",
		);
		return { index, timestamp, duration, sha256: packet.data_hash.slice(7) };
	});
	const last = packetTiming.at(-1),
		packetEnd = last.timestamp + last.duration;
	assert(
		Math.abs(packetEnd - media.frames / media.fps) <= tolerance,
		"Final packet end changed",
	);
	return { frameTiming, packetTiming, packetEnd, stream };
}

export function highChromaPixels(decoded, expected, baseline, media) {
	const comparison = compareDropletsSequence(
		decoded,
		expected,
		baseline,
		media.width * media.height * 4,
		media.frames,
	);
	assert.deepEqual(
		comparison.baselineRejectedFrames,
		[0, 1, 2, 3, 4, 5],
		"No-op negative control failed",
	);
	assert.deepEqual(
		comparison.repeatedFirstRejectedFrames,
		[1, 2, 3, 4, 5],
		"Repeated-first negative control failed",
	);
	return comparison;
}
