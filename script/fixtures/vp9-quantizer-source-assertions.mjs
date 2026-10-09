import assert from "node:assert/strict";
import { FPS, FRAME_COUNT } from "./master-encoder-analysis.mjs";
export function vp9Header(bytes) {
	assert.ok(bytes.length >= 1);
	const marker = bytes[0] >> 6;
	assert.equal(marker, 2, "VP9 frame marker");
	const profile = ((bytes[0] >> 5) & 1) | (((bytes[0] >> 4) & 1) << 1);
	assert.ok(profile === 0 || profile === 1);
	const showExistingFrame = Boolean(bytes[0] & 8);
	return {
		marker,
		profile,
		showExistingFrame,
		keyframe: !showExistingFrame && !(bytes[0] & 4),
	};
}
export function assertContainerTiming(packets) {
	assert.equal(packets.length, FRAME_COUNT);
	for (const [index, packet] of packets.entries()) {
		assert.ok(
			Math.abs(Number(packet.timestamp ?? packet.pts_time) - index / FPS) <=
				0.001,
			"Container PTS exceeds Matroska's one-millisecond timestamp resolution",
		);
		assert.ok(
			Math.abs(Number(packet.duration_time ?? packet.duration) - 1 / FPS) <=
				0.001,
			"Container duration exceeds Matroska's one-millisecond resolution",
		);
	}
}
