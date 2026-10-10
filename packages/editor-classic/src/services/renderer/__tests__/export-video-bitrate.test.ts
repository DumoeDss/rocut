import { expect, test } from "bun:test";
import {
	resolveExportVideoBitrate,
	resolveExportVideoPlan,
} from "../export-video-bitrate";

test("video export passes codec, resolution and rational frame rate through the Rust policy", () => {
	const request = {
		codec: "vp9" as const,
		quality: "very_high" as const,
		width: 640,
		height: 360,
		frameRate: { numerator: 30, denominator: 1 },
	};
	expect(resolveExportVideoBitrate(request)).toBe(3_456_000);
	expect(resolveExportVideoBitrate({ ...request, codec: "avc" })).toBe(
		3_456_000,
	);
	expect(
		resolveExportVideoBitrate({
			...request,
			frameRate: { numerator: 30000, denominator: 1001 },
		}),
	).toBe(3_453_000);
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

test("explicit high-chroma preserves the Rust codec plan without changing compatible exports", () => {
	const request = {
		codec: "vp9" as const,
		quality: "very_high" as const,
		width: 192,
		height: 128,
		frameRate: { numerator: 30, denominator: 1 },
	};
	expect(resolveExportVideoPlan(request)).toEqual({ bitrate: 369_000 });
	expect(resolveExportVideoPlan({ ...request, videoChroma: "420" })).toEqual({
		bitrate: 369_000,
	});
	expect(resolveExportVideoPlan({ ...request, videoChroma: "444" })).toEqual({
		bitrate: 369_000,
		fullCodecString: "vp09.01.11.08.03.01.13.01.01",
	});
	expect(resolveExportVideoBitrate({ ...request, videoChroma: "444" })).toBe(
		369_000,
	);
	expect(() =>
		resolveExportVideoPlan({ ...request, codec: "avc", videoChroma: "444" }),
	).toThrow("VP9");
});
