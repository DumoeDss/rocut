import { expect, test } from "bun:test";
import { resolveExportVideoBitrate } from "../export-video-bitrate";

test("video export passes codec, resolution and rational frame rate through the Rust policy", () => {
	const request = {
		codec: "vp9" as const,
		quality: "very_high" as const,
		width: 640,
		height: 360,
		frameRate: { numerator: 30, denominator: 1 },
	};
	expect(resolveExportVideoBitrate(request)).toBe(2_074_000);
	expect(resolveExportVideoBitrate({ ...request, codec: "avc" })).toBe(
		3_456_000,
	);
	expect(
		resolveExportVideoBitrate({
			...request,
			frameRate: { numerator: 30000, denominator: 1001 },
		}),
	).toBe(2_072_000);
	expect(resolveExportVideoBitrate({ ...request, quality: "high" })).toBe(
		447_000,
	);
	expect(() => resolveExportVideoBitrate({ ...request, width: 0 })).toThrow(
		"positive",
	);
	expect(() =>
		resolveExportVideoBitrate({
			...request,
			frameRate: { numerator: 7, denominator: 3 },
		}),
	).toThrow("tick");
});
