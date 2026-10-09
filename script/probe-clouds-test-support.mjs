import {
	cloudsCodecThresholds,
	cloudsLocalTicks,
} from "./probe-clouds-contract.mjs";

export function cloudsTestMetadata() {
	return {
		width: 192,
		height: 128,
		frames: 6,
		fps: 30,
		codec: "vp9",
		mimeType: "video/webm",
		reference:
			"Independent cloudsExpected on fixed cut-out source RGBA, composited over black ColorNode; not production capture pixels",
		thresholds: { ...cloudsCodecThresholds },
		localTicks: [...cloudsLocalTicks],
		timelineTicks: cloudsLocalTicks.map((tick) => tick + 12000),
		paramsPerFrame: Array.from({ length: 6 }, () => ({
			amount: 0.8,
			density: 0.7,
			scale: 0.17,
			speed: 0.5,
			windX: 0.23,
			windY: -0.19,
			refraction: 0.075,
			fogOpacity: 0.35,
			colorR: 0.3,
			colorG: 0.75,
			colorB: 1,
			seed: 31415,
		})),
	};
}
export function cloudsTestEvidence() {
	return {
		ok: true,
		kind: "clouds-production-pipeline",
		mode: "pipeline",
		checks: {
			ok: true,
			backend: "webgl",
			nativeHandlesGone: true,
			cleanupErrors: [],
		},
		browserClosed: true,
		serverClosed: true,
		postRunVerification: { ok: true },
		captureErrors: [],
		pageErrors: [],
		httpErrors: [],
		externalRequests: [],
		console: [],
	};
}
export function cloudsTestPixels(count, value = 0) {
	const pixels = Buffer.alloc(count * 4);
	for (let offset = 0; offset < pixels.length; offset += 4)
		pixels.set([value, value, value, 255], offset);
	return pixels;
}
export function cloudsTestMedia() {
	const baseline = cloudsTestPixels(192 * 128),
		expected = Buffer.concat(
			Array.from({ length: 6 }, (_, index) =>
				cloudsTestPixels(192 * 128, 32 * (index + 1)),
			),
		);
	return {
		...cloudsTestMetadata(),
		video: Buffer.from(
			"synthetic bytes; not an accepted encoded video",
		).toString("base64"),
		expected: expected.toString("base64"),
		baseline: baseline.toString("base64"),
	};
}
export function cloudsTestProbe() {
	const frames = Array.from({ length: 6 }, (_, index) => ({
		type: "frame",
		media_type: "video",
		best_effort_timestamp_time: (
			Math.round((index / 30) * 1000) / 1000
		).toFixed(3),
		pkt_duration_time: "0.033",
	}));
	const packets = Array.from({ length: 6 }, (_, index) => ({
		type: "packet",
		codec_type: "video",
		pts_time: frames[index].best_effort_timestamp_time,
		duration_time: "0.033",
	}));
	return { frames, packets, format: { duration: "0.200" } };
}
