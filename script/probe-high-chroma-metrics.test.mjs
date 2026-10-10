import assert from "node:assert/strict";
import { test } from "node:test";
import {
	highChromaSpecs,
	highChromaThresholds,
	validateHighChromaMedia,
} from "./probe-high-chroma-contract.mjs";
import { highChromaProbeTiming } from "./probe-high-chroma-metrics.mjs";

function fixture() {
	const caseId = "solid-sequence-640x360-24",
		spec = highChromaSpecs[caseId];
	const media = {
		...spec,
		caseId,
		codec: "vp9",
		mimeType: "video/webm",
		quality: "very_high",
		requestedVideoChroma: "444",
		reference: "fixed CPU synthetic timing metadata",
		thresholds: { ...highChromaThresholds },
	};
	const frames = Array.from({ length: 6 }, (_, index) => ({
		media_type: "video",
		best_effort_timestamp_time: String(index / 24),
		pkt_duration_time: String(1 / 24),
	}));
	const packets = frames.map((frame, index) => ({
		pts_time: frame.best_effort_timestamp_time,
		duration_time: frame.pkt_duration_time,
		data_hash: `SHA256:${String(index).repeat(64)}`,
	}));
	const probe = {
		streams: [
			{
				codec_name: "vp9",
				width: 640,
				height: 360,
				profile: "Profile 1",
				pix_fmt: "yuv444p",
			},
		],
		format: { duration: ".25" },
		frames,
		packets,
	};
	return { media, probe };
}

test("larger 24fps packet/frame/final duration pass only with actual profile1/444", () => {
	const { media, probe } = fixture();
	assert.equal(highChromaProbeTiming(probe, media).packetEnd, 0.25);
	const combined = {
		...probe,
		frames: undefined,
		packets: undefined,
		packets_and_frames: [
			...probe.frames.map((frame) => ({ ...frame, type: "frame" })),
			...probe.packets.map((packet) => ({ ...packet, type: "packet" })),
		],
	};
	assert.equal(
		highChromaProbeTiming(combined, media).frameTiming.formatDuration,
		0.25,
	);
});

for (const [name, mutate] of [
	[
		"silent 420 fallback",
		({ probe }) => {
			probe.streams[0].profile = "Profile 0";
			probe.streams[0].pix_fmt = "yuv420p";
		},
	],
	["missing packet", ({ probe }) => probe.packets.pop()],
	[
		"duplicate packet PTS",
		({ probe }) => {
			probe.packets[2].pts_time = probe.packets[1].pts_time;
		},
	],
	[
		"wrong packet duration",
		({ probe }) => {
			probe.packets[0].duration_time = ".1";
		},
	],
	[
		"wrong frame PTS",
		({ probe }) => {
			probe.frames[2].best_effort_timestamp_time = ".5";
		},
	],
	[
		"wrong total duration",
		({ probe }) => {
			probe.format.duration = ".3";
		},
	],
	[
		"missing packet hash",
		({ probe }) => {
			delete probe.packets[0].data_hash;
		},
	],
	[
		"threshold drift",
		({ media }) => {
			media.thresholds.exportActiveRgb = 16;
		},
	],
	[
		"wrong fps",
		({ media }) => {
			media.fps = 30;
		},
	],
	[
		"wrong size",
		({ media }) => {
			media.width = 192;
		},
	],
])
	test(`reject ${name}`, () => {
		const value = fixture();
		mutate(value);
		assert.throws(() => highChromaProbeTiming(value.probe, value.media));
	});

test("larger-case default/420 is not mistaken for opt-in coverage", () => {
	const { media } = fixture();
	media.requestedVideoChroma = "default";
	assert.throws(() => validateHighChromaMedia(media));
});
