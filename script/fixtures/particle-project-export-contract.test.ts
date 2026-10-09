import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import {
	admitSavedParticleProject,
	PROJECT_TIMING_FIXTURE,
	projectPixelMetrics,
	acceptsProjectPixels,
} from "./particle-project-export-contract";
import { opacityCompositeMetrics } from "./particle-project-export-pixels.mjs";
import { resolveProgrammaticFrame } from "../../packages/editor-classic/src/services/renderer/programmatic/frame";

function fixture() {
	const resource = {
		id: "entry.ts",
		kind: "source",
		mimeType: "application/octet-stream",
		byteLength: 1,
		sha256: "a".repeat(64),
		attachmentKey: `programmatic-source-sha256-${"a".repeat(64)}`,
	};
	const source = {
		version: 1,
		runtime: "html-document",
		code: "",
		documentId: "compiled.html",
		resources: [
			{
				...resource,
				id: "compiled.html",
				kind: "document",
				mimeType: "text/html",
				attachmentKey: `programmatic-sha256-${"a".repeat(64)}`,
			},
		],
		width: 320,
		height: 240,
		frameRate: { numerator: 30, denominator: 1 },
		durationFrames: 121,
		seed: 7391,
		build: {
			version: 1,
			engine: "three",
			engineVersion: "0.185.1",
			entryFile: "entry.ts",
			capabilities: ["particle-surface-v1"],
			inputs: [resource],
			toolchainLock: { ...resource, id: "_rocut/toolchain-lock.json" },
		},
	};
	const clip = {
		id: "particle-model",
		name: "Particle",
		type: "graphic",
		definitionId: "programmatic",
		programmatic: source,
		params: { opacity: 0.85 },
		startTime: 0,
		duration: 484000,
		trimStart: 0,
		trimEnd: 0,
	};
	return {
		wrapperVersion: 1,
		record: {
			id: "p",
			schemaVersion: 32,
			data: {
				metadata: {
					id: "p",
					name: "Saved",
					duration: 484000,
					createdAt: "2026-10-09T00:00:00Z",
					updatedAt: "2026-10-09T00:00:00Z",
				},
				scenes: [
					{
						id: "s",
						name: "Main",
						isMain: true,
						createdAt: "2026-10-09T00:00:00Z",
						updatedAt: "2026-10-09T00:00:00Z",
						tracks: {
							overlay: [
								{
									id: "track",
									name: "Particle",
									type: "graphic",
									elements: [clip],
								},
							],
							main: { id: "main", type: "video", elements: [] },
							audio: [],
						},
						bookmarks: [],
					},
				],
				currentSceneId: "s",
				motionTextSequences: [],
				settings: {
					fps: { numerator: 30, denominator: 1 },
					canvasSize: { width: 1920, height: 1080 },
					background: { type: "color", color: "#000000" },
				},
				version: 32,
			},
		},
	};
}
test("production decoder preserves saved scene tracks, params and project canvas without source-only reconstruction", () => {
	const input = fixture(),
		before = JSON.stringify(input),
		saved = admitSavedParticleProject(input, "particle-model", "original");
	expect(saved.scene.tracks.overlay[0].id).toBe("track");
	expect(saved.clip.params.opacity).toBe(0.85);
	expect(saved.project.settings.canvasSize).toEqual({
		width: 1920,
		height: 1080,
	});
	expect(JSON.stringify(saved.clip.programmatic)).toBe(
		JSON.stringify(
			input.record.data.scenes[0].tracks.overlay[0].elements[0].programmatic,
		),
	);
	expect(saved.times).toEqual([0, 4000, 8000, 12000, 16000, 20000]);
	saved.clip.params.opacity = 1;
	expect(JSON.stringify(input)).toBe(before);
});
test("source-only, wrong opacity, substituted canvas and unexpected timeline inputs fail closed", () => {
	const input = fixture();
	expect(() =>
		admitSavedParticleProject(
			input.record.data.scenes[0].tracks.overlay[0].elements[0].programmatic,
			"particle-model",
			"original",
		),
	).toThrow();
	for (const alter of [
		(input: ReturnType<typeof fixture>) => {
			input.record.data.settings.canvasSize.width = 320;
		},
		(input: ReturnType<typeof fixture>) => {
			input.record.data.scenes[0].tracks.overlay[0].elements[0].params.opacity = 1;
		},
		(input: ReturnType<typeof fixture>) => {
			input.record.data.scenes[0].tracks.overlay[0].elements[0].startTime = 4000;
		},
	]) {
		const input = fixture();
		alter(input);
		expect(() =>
			admitSavedParticleProject(input, "particle-model", "original"),
		).toThrow();
	}
});
test("nonzero saved placement/trim passes actual Rust frame mapper; ignoring either changes admission or source time", () => {
	const input = fixture(),
		clip = input.record.data.scenes[0].tracks.overlay[0].elements[0];
	Object.assign(clip, PROJECT_TIMING_FIXTURE);
	const saved = admitSavedParticleProject(input, "particle-model", "timing");
	expect(saved.times).toEqual([236000, 240000, 244000, 248000, 252000, 256000]);
	const request = {
		source: saved.clip.programmatic,
		clipStart: saved.clip.startTime,
		clipDuration: saved.clip.duration,
		trimStart: saved.clip.trimStart,
		timelineTime: saved.times[3],
	};
	expect(resolveProgrammaticFrame(request)?.sourceTime).toBe(128000);
	expect(
		resolveProgrammaticFrame({ ...request, timelineTime: saved.times[0] }),
	).toBeNull();
	expect(resolveProgrammaticFrame({ ...request, clipStart: 0 })).toBeNull();
	expect(
		resolveProgrammaticFrame({ ...request, trimStart: 0 })?.sourceTime,
	).toBe(8000);
});
function pixels(level: number, start = 0) {
	const result = new Uint8Array(32 * 32 * 4);
	for (let p = 0; p < 32 * 32; p++) {
		result[p * 4 + 3] = 255;
		if (p >= start && p < start + 128) result.fill(level, p * 4, p * 4 + 3);
	}
	return result;
}
test("independent energy oracle rejects opacity omission even when broad MAE thresholds alone would pass", () => {
	const correct = pixels(85),
		wrong = pixels(100),
		metrics = projectPixelMetrics(wrong, correct);
	expect(metrics.meanRgbError).toBeLessThan(12);
	expect(metrics.activeMeanRgbError).toBeLessThan(18);
	expect(acceptsProjectPixels(metrics, true)).toBe(false);
	expect(
		acceptsProjectPixels(projectPixelMetrics(pixels(83), correct), true),
	).toBe(true);
	expect(opacityCompositeMetrics(correct, wrong).accepted).toBe(true);
	expect(opacityCompositeMetrics(wrong, wrong).accepted).toBe(false);
});
test("blank frames and spatial negatives retain the positive-reference activity mask", () => {
	const correct = pixels(85),
		wrong = pixels(85, 256),
		blank = pixels(0);
	expect(acceptsProjectPixels(projectPixelMetrics(blank, blank), false)).toBe(
		true,
	);
	expect(acceptsProjectPixels(projectPixelMetrics(wrong, correct), true)).toBe(
		false,
	);
	const sameMask = projectPixelMetrics(correct, wrong, correct);
	expect(sameMask.activePixels).toBe(128);
	expect(sameMask.activeLumaRatio).toBeNull();
	expect(acceptsProjectPixels(sameMask, true)).toBe(false);
});
test.skipIf(!process.env.ROCUT_PARTICLE_PROJECT_FIXTURE)(
	"actual C4 preserved record traverses the production decoder",
	async () => {
		const path = process.env.ROCUT_PARTICLE_PROJECT_FIXTURE!;
		const bytes = await readFile(path),
			input = JSON.parse(
				new TextDecoder("utf-8", { fatal: true }).decode(bytes),
			);
		const saved = admitSavedParticleProject(
			input,
			"particle-model",
			"original",
		);
		expect(saved.clip.params.opacity).toBe(0.85);
		expect(saved.project.settings.canvasSize).toEqual({
			width: 1920,
			height: 1080,
		});
		expect(await readFile(path)).toEqual(bytes);
	},
);
