import { describe, expect, test } from "bun:test";

await import("../../editor/session/__tests__/wasm-test-mock");

const {
	analyzeMotionTextAudio,
	assessMotionTextAudioSync,
	resolveMotionTextAudioClipBinding,
	resolveMotionTextBeatGrid,
	snapMotionTextTimeToBeat,
} = await import("../motion-text-audio");
type AnalyzeMotionTextAudioCore =
	import("../motion-text-audio").AnalyzeMotionTextAudioCore;
type AssessMotionTextAudioSyncCore =
	import("../motion-text-audio").AssessMotionTextAudioSyncCore;
type ResolveMotionTextAudioClipBindingCore =
	import("../motion-text-audio").ResolveMotionTextAudioClipBindingCore;
type ResolveMotionTextBeatGridCore =
	import("../motion-text-audio").ResolveMotionTextBeatGridCore;
type SnapMotionTextTimeToBeatCore =
	import("../motion-text-audio").SnapMotionTextTimeToBeatCore;
const {
	analyzeMotionTextAudio: analyzeMotionTextAudioCore,
	assessMotionTextAudioSync: assessMotionTextAudioSyncCore,
	resolveMotionTextAudioClipBinding: resolveMotionTextAudioClipBindingCore,
	resolveMotionTextBeatGrid: resolveMotionTextBeatGridCore,
	snapMotionTextTimeToBeat: snapMotionTextTimeToBeatCore,
} = await import("../../../../../rust/wasm/pkg/opencut_wasm_sync.js");

const canonicalAnalysis: AnalyzeMotionTextAudioCore = (options) =>
	analyzeMotionTextAudioCore(options);
const canonicalClipBinding: ResolveMotionTextAudioClipBindingCore = (options) =>
	resolveMotionTextAudioClipBindingCore(options);
const canonicalSyncAssessment: AssessMotionTextAudioSyncCore = (options) =>
	assessMotionTextAudioSyncCore(options);
const canonicalGrid: ResolveMotionTextBeatGridCore = (options) =>
	resolveMotionTextBeatGridCore(options);
const canonicalSnap: SnapMotionTextTimeToBeatCore = (options) =>
	snapMotionTextTimeToBeatCore(options);

function clickTrack({
	sampleRate,
	durationSeconds,
}: {
	readonly sampleRate: number;
	readonly durationSeconds: number;
}): Float32Array {
	const samples = new Float32Array(sampleRate * durationSeconds);
	const firstBeat = Math.floor(sampleRate / 5);
	const period = Math.floor(sampleRate / 2);
	for (let beat = firstBeat; beat < samples.length; beat += period) {
		for (
			let offset = 0;
			offset < 32 && beat + offset < samples.length;
			offset++
		) {
			samples[beat + offset] = 1 - offset / 32;
		}
	}
	return samples;
}

describe("motion-text audio Rust seam", () => {
	test("passes little-endian PCM into canonical WASM and detects a fixed tempo", () => {
		const result = analyzeMotionTextAudio({
			samples: clickTrack({ sampleRate: 8_000, durationSeconds: 12 }),
			sampleRate: 8_000,
			core: canonicalAnalysis,
		});

		expect(result.analysis).not.toBeNull();
		expect(Math.abs((result.analysis?.bpm ?? 0) - 120)).toBeLessThan(1);
		expect(result.analysis?.beats.length).toBeGreaterThanOrEqual(20);
		expect(result.analysis?.energy.some((value) => value > 0.9)).toBe(true);
		expect(result.analysis?.confidence).toBeGreaterThan(0.5);
	});

	test("keeps silence analyzable without inventing tempo", () => {
		const result = analyzeMotionTextAudio({
			samples: new Float32Array(8_000 * 3),
			sampleRate: 8_000,
			core: canonicalAnalysis,
		});

		expect(result.analysis?.bpm).toBeNull();
		expect(result.analysis?.firstBeat).toBeNull();
		expect(result.analysis?.beats).toEqual([]);
		expect(result.diagnostics).toContainEqual(
			expect.objectContaining({ code: "tempo-unavailable" }),
		);
	});

	test("resolves manual overrides and an exact long-song grid", () => {
		const result = resolveMotionTextBeatGrid({
			duration: 8 * 60 * 120_000,
			detectedBpm: 119.7,
			detectedFirstBeat: 12_000,
			bpmOverride: 120,
			firstBeatOverride: 24_000,
			core: canonicalGrid,
		});

		expect(result.grid?.bpmSource).toBe("manual");
		expect(result.grid?.firstBeatSource).toBe("manual");
		expect(result.grid?.beats[900]).toBe(24_000 + 900 * 60_000);
		expect(result.grid?.beats.at(-1)).toBe(57_564_000);
	});

	test("maps a detected source beat phase through the binding offset", () => {
		const result = resolveMotionTextBeatGrid({
			duration: 1_200_000,
			detectedBpm: 120,
			detectedFirstBeat: 12_000,
			sourceOffset: 84_000,
			core: canonicalGrid,
		});

		expect(result.grid?.firstBeat).toBe(48_000);
		expect(result.grid?.firstBeatSource).toBe("detected");
		expect(result.grid?.beats.slice(0, 2)).toEqual([48_000, 108_000]);
	});

	test("honors the beat-snap distance threshold", () => {
		expect(
			snapMotionTextTimeToBeat({
				time: 83_000,
				bpm: 120,
				firstBeat: 24_000,
				maxDistance: 2_000,
				core: canonicalSnap,
			}),
		).toEqual({ time: 84_000, snapped: true, beatIndex: 1, error: null });
		expect(
			snapMotionTextTimeToBeat({
				time: 80_000,
				bpm: 120,
				firstBeat: 24_000,
				maxDistance: 2_000,
				core: canonicalSnap,
			}),
		).toEqual({ time: 80_000, snapped: false, beatIndex: null, error: null });
	});

	test("resolves clip geometry to a source offset", () => {
		expect(
			resolveMotionTextAudioClipBinding({
				sequenceDuration: 1_200_000,
				sequenceClipStart: 480_000,
				sequenceTrimStart: 120_000,
				sequenceClipDuration: 600_000,
				audioClipStart: 420_000,
				audioClipDuration: 1_200_000,
				audioTrimStart: 240_000,
				audioSourceDuration: 2_400_000,
				core: canonicalClipBinding,
			}),
		).toEqual({
			sourceOffset: 180_000,
			duration: 1_200_000,
			errorCode: null,
			error: null,
		});
	});

	test("rejects an audio clip that does not cover the visible sequence clip", () => {
		expect(
			resolveMotionTextAudioClipBinding({
				sequenceDuration: 1_200_000,
				sequenceClipStart: 480_000,
				sequenceTrimStart: 0,
				sequenceClipDuration: 1_200_000,
				audioClipStart: 480_000,
				audioClipDuration: 600_000,
				audioTrimStart: 0,
				audioSourceDuration: 1_200_000,
				core: canonicalClipBinding,
			}),
		).toEqual(
			expect.objectContaining({
				sourceOffset: null,
				duration: null,
				errorCode: "clip-range-mismatch",
			}),
		);
	});

	test("distinguishes timing drift, content replacement, and unchecked sync", () => {
		const binding = {
			boundAssetId: "asset-a",
			boundClipId: "clip-a",
			boundSourceOffset: 120_000,
			boundDuration: 600_000,
			boundContentDigest: "digest-a",
			currentAssetId: "asset-a",
			currentClipId: "clip-a",
			currentSourceOffset: 240_000,
			currentDuration: 600_000,
			currentContentDigest: "digest-a",
			core: canonicalSyncAssessment,
		} as const;
		expect(assessMotionTextAudioSync(binding)).toEqual({
			status: "timing-changed",
			requiresSync: true,
			analysisReusable: true,
		});
		expect(
			assessMotionTextAudioSync({
				...binding,
				currentSourceOffset: 120_000,
				currentContentDigest: "digest-b",
			}),
		).toEqual({
			status: "content-changed",
			requiresSync: true,
			analysisReusable: false,
		});
		expect(
			assessMotionTextAudioSync({
				...binding,
				boundContentDigest: null,
				currentSourceOffset: 120_000,
				currentContentDigest: null,
			}),
		).toEqual({
			status: "unchecked",
			requiresSync: false,
			analysisReusable: false,
		});
	});

	test("rejects malformed core output at the TypeScript boundary", () => {
		expect(() =>
			analyzeMotionTextAudio({
				samples: new Float32Array([0]),
				sampleRate: 8_000,
				core: () => ({ analysis: { version: 99 }, diagnostics: [] }),
			}),
		).toThrow("invalid analysis");
		expect(() =>
			assessMotionTextAudioSync({
				boundAssetId: "asset-a",
				boundSourceOffset: 0,
				core: () => ({
					status: "synchronized",
					requiresSync: true,
					analysisReusable: true,
				}),
			}),
		).toThrow("invalid sync assessment");
	});
});
