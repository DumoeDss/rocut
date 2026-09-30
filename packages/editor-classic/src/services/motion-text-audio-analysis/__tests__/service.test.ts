import { describe, expect, test } from "bun:test";

import type { SessionResources } from "../../../editor/session/resources";
import type { MediaAsset } from "../../../media/types";
import {
	MotionTextAudioAnalysisCache,
	MotionTextAudioAnalysisInvalidatedError,
	type MotionTextAudioAnalysisDependencies,
	type MotionTextAudioAnalysisResources,
} from "../service";

function asset({
	id,
	contents,
}: {
	readonly id: string;
	readonly contents: string;
}): MediaAsset {
	return {
		id,
		name: `${id}.wav`,
		type: "audio",
		file: new File([contents], `${id}.wav`, { type: "audio/wav" }),
		duration: 1,
	};
}

function analysisResult(sampleRate: number) {
	return {
		analysis: {
			version: 1 as const,
			sampleRate,
			sampleCount: sampleRate,
			duration: 120_000,
			energyHopSamples: Math.round(sampleRate / 50),
			energy: [0, 1],
			bpm: 120,
			firstBeat: 0,
			beats: [0, 60_000],
			confidence: 1,
		},
		diagnostics: [],
	};
}

function fixture(overrides: Partial<MotionTextAudioAnalysisDependencies> = {}) {
	let digests = 0;
	let decodes = 0;
	let analyses = 0;
	const dependencies: MotionTextAudioAnalysisDependencies = {
		digestFile: async ({ file }) => {
			digests += 1;
			return `sha256:${file.size.toString(16).padStart(64, "0")}`;
		},
		decodeFile: async () => {
			decodes += 1;
			return { samples: new Float32Array(8_000), sampleRate: 8_000 };
		},
		analyzePcm: ({ sampleRate }) => {
			analyses += 1;
			return analysisResult(sampleRate);
		},
		...overrides,
	};
	const resources: MotionTextAudioAnalysisResources = {
		createAudioContext: (() => {
			throw new Error("test decode is injected");
		}) as SessionResources["createAudioContext"],
	};
	return {
		cache: new MotionTextAudioAnalysisCache({ resources, dependencies }),
		counts: () => ({ digests, decodes, analyses }),
	};
}

describe("motion-text audio analysis cache", () => {
	test("reuses a completed source result without re-reading the file", async () => {
		const { cache, counts } = fixture();
		const media = asset({ id: "asset-a", contents: "same" });

		const first = await cache.getAnalysis({
			projectId: "project-a",
			asset: media,
		});
		const second = await cache.getAnalysis({
			projectId: "project-a",
			asset: media,
		});

		expect(second).toBe(first);
		expect(counts()).toEqual({ digests: 1, decodes: 1, analyses: 1 });
		expect(cache.inspect()).toEqual({
			cachedResults: 1,
			sourceResults: 1,
			pendingOperations: 0,
			disposed: false,
		});
	});

	test("isolates identical asset ids by project", async () => {
		const { cache, counts } = fixture();
		const media = asset({ id: "asset-shared", contents: "same" });

		const first = await cache.getAnalysis({
			projectId: "project-a",
			asset: media,
		});
		const second = await cache.getAnalysis({
			projectId: "project-b",
			asset: media,
		});

		expect(first.projectId).toBe("project-a");
		expect(second.projectId).toBe("project-b");
		expect(second).not.toBe(first);
		expect(counts()).toEqual({ digests: 2, decodes: 2, analyses: 2 });
		expect(cache.inspect().cachedResults).toBe(2);
	});

	test("does not reuse analysis after same-id content replacement", async () => {
		const { cache, counts } = fixture();
		const firstAsset = asset({ id: "asset-a", contents: "first" });
		const replacement = asset({ id: "asset-a", contents: "replacement" });

		const first = await cache.getAnalysis({
			projectId: "project-a",
			asset: firstAsset,
		});
		const second = await cache.getAnalysis({
			projectId: "project-a",
			asset: replacement,
		});

		expect(second.contentDigest).not.toBe(first.contentDigest);
		expect(counts()).toEqual({ digests: 2, decodes: 2, analyses: 2 });
	});

	test("cancellation waits for in-flight decode and leaves no retained task", async () => {
		let releaseDecode: (() => void) | undefined;
		let markDecodeStarted: (() => void) | undefined;
		const decodeGate = new Promise<void>((resolve) => {
			releaseDecode = resolve;
		});
		const decodeStarted = new Promise<void>((resolve) => {
			markDecodeStarted = resolve;
		});
		const { cache } = fixture({
			decodeFile: async () => {
				markDecodeStarted?.();
				await decodeGate;
				return { samples: new Float32Array(8_000), sampleRate: 8_000 };
			},
		});
		const media = asset({ id: "asset-a", contents: "same" });
		const operation = cache.getAnalysis({
			projectId: "project-a",
			asset: media,
		});
		await decodeStarted;
		const cancellation = cache.clearSource({
			projectId: "project-a",
			assetId: media.id,
		});
		releaseDecode?.();

		await expect(operation).rejects.toBeInstanceOf(
			MotionTextAudioAnalysisInvalidatedError,
		);
		await cancellation;
		expect(cache.inspect()).toEqual({
			cachedResults: 0,
			sourceResults: 0,
			pendingOperations: 0,
			disposed: false,
		});
	});

	test("dispose rejects future work and drains existing state", async () => {
		const { cache } = fixture();
		await cache.getAnalysis({
			projectId: "project-a",
			asset: asset({ id: "asset-a", contents: "same" }),
		});
		await cache.dispose();

		expect(cache.inspect()).toEqual({
			cachedResults: 0,
			sourceResults: 0,
			pendingOperations: 0,
			disposed: true,
		});
		await expect(
			cache.getAnalysis({
				projectId: "project-a",
				asset: asset({ id: "asset-b", contents: "same" }),
			}),
		).rejects.toThrow("disposed");
	});
});
