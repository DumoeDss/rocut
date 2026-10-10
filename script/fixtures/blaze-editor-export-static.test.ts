import { expect, spyOn, test } from "bun:test";
import { mkdtemp, readFile } from "node:fs/promises";
import { join } from "node:path";
import { blazeHostImage } from "./blaze-host-source";
import { blazeSource } from "./blaze-cases";
import {
	blazeEditorExportFiles,
	blazeEditorExportJobs,
	blazeEditorExportThresholds,
} from "./blaze-editor-export-contract.mjs";
import {
	decodeBlazeEditorSourcePng,
	modelBlazeEditorPremultiplication,
} from "./blaze-editor-export-source.mjs";
import {
	blazeEditorExportParams,
	blazeEditorExportReferences,
} from "./blaze-editor-export-reference";
import { compareBlazeEditorExportFrame } from "./blaze-editor-export-decode.mjs";
import { assertOnlyBlazeExportsAdded } from "./blaze-editor-export-persistence.mjs";
import { runBlazeEditorExportJob } from "./blaze-editor-export-jobs.mjs";
import { validateBlazePipelineProbeTiming } from "../probe-blaze-pipeline-metrics.mjs";

test("six independent requests preserve exact dimensions timing quality and default versus explicit 444", () => {
	expect(blazeEditorExportJobs).toHaveLength(6);
	expect(blazeEditorExportJobs.map((job) => job.jobKey)).toEqual([
		"default-static",
		"default-animated",
		"default-disabled",
		"444-static",
		"444-animated",
		"444-disabled",
	]);
	for (const job of blazeEditorExportJobs) {
		expect(job.frames).toBe(6);
		expect(job.endTime - job.startTime).toBe(24000);
		expect(job.options).toEqual({
			format: "webm",
			quality: "very_high",
			includeAudio: false,
			...(job.chroma === "444" ? { videoChroma: "444" } : {}),
			range: { startTime: job.offset + 4000, endTime: job.offset + 28000 },
		});
		expect(Object.hasOwn(job.options, "videoChroma")).toBe(
			job.chroma === "444",
		);
	}
	expect(blazeEditorExportThresholds).toEqual({
		meanRgba: 10,
		activeRgb: 15,
		minimumActivePixels: 64,
		timestampSeconds: 0.0011,
	});
	expect(blazeEditorExportFiles.length).toBe(14);
	expect(new Set(blazeEditorExportFiles).size).toBe(14);
});

test("independent parameters reflect actual ten UI edits and clip-local linear then hold animation", () => {
	expect(blazeEditorExportParams("static", 4000)).toEqual({
		amount: 0.9,
		flameOpacity: 0.55,
		sparkOpacity: 0.65,
		smokeOpacity: 0.45,
		refraction: 0.05,
		height: 1.1,
		scale: 0.2,
		speed: 0.75,
		wind: 0.25,
		seed: 27182,
	});
	const start = blazeEditorExportParams("animated", 0),
		middle = blazeEditorExportParams("animated", 12000),
		end = blazeEditorExportParams("animated", 24000);
	expect(start.amount).toBe(0.25);
	expect(middle.amount).toBe(0.5625);
	expect(end.amount).toBe(0.875);
	expect(middle.wind).toBe(0.0625);
	expect(blazeEditorExportParams("animated", 119999)).toEqual(end);
	expect(start.seed).toBe(31415);
	for (const ticks of [-1, 120000, 0.5, NaN])
		expect(() => blazeEditorExportParams("static", ticks)).toThrow();
});

test("PNG parser decodes imported alpha data independently and rejects altered bytes or trailing chunks", () => {
	const png = blazeHostImage(),
		decoded = decodeBlazeEditorSourcePng(png);
	expect(decoded.width).toBe(192);
	expect(decoded.height).toBe(128);
	expect(decoded.pixels).toEqual(blazeSource({ width: 192, height: 128 }));
	const corrupt = Buffer.from(png);
	corrupt[50] ^= 1;
	for (const bytes of [
		corrupt,
		png.subarray(0, png.length - 1),
		Buffer.concat([png, Buffer.from([0])]),
	])
		expect(() => decodeBlazeEditorSourcePng(bytes)).toThrow();
});

test("premultiplication sensitivity is explicit, non-mutating and not mistaken for a measured browser canonical input", () => {
	const source = new Uint8ClampedArray([
		255, 0, 255, 0, 13, 19, 27, 1, 40, 80, 120, 255,
	]);
	const before = new Uint8ClampedArray(source),
		modeled = modelBlazeEditorPremultiplication(source);
	expect(source).toEqual(before);
	expect([...modeled]).toEqual([0, 0, 0, 0, 0, 0, 0, 1, 40, 80, 120, 255]);
});

test("fixed enabled codec gates retain active population and mean error boundaries while disabled uses full-image gate", () => {
	const baseline = new Uint8ClampedArray(256 * 4),
		expected = new Uint8ClampedArray(256 * 4);
	for (let index = 0; index < 256; index++) {
		baseline[index * 4 + 3] = expected[index * 4 + 3] = 255;
		if (index < 64) expected.set([100, 100, 100, 255], index * 4);
	}
	const shifted = (delta: number) => {
		const pixels = new Uint8ClampedArray(expected);
		for (let index = 0; index < 64; index++)
			for (let channel = 0; channel < 3; channel++)
				pixels[index * 4 + channel] += delta;
		return pixels;
	};
	expect(
		compareBlazeEditorExportFrame(shifted(15), expected, baseline, true).pass,
	).toBe(true);
	expect(
		compareBlazeEditorExportFrame(shifted(16), expected, baseline, true).pass,
	).toBe(false);
	const alpha = new Uint8ClampedArray(expected);
	for (let index = 3; index < alpha.length; index += 4) alpha[index] = 215;
	expect(
		compareBlazeEditorExportFrame(alpha, expected, baseline, true).pass,
	).toBe(true);
	for (let index = 3; index < alpha.length; index += 4) alpha[index] = 214;
	expect(
		compareBlazeEditorExportFrame(alpha, expected, baseline, true).pass,
	).toBe(false);
	const sparse = new Uint8ClampedArray(expected);
	sparse.set([0, 0, 0, 255], 63 * 4);
	expect(
		compareBlazeEditorExportFrame(sparse, sparse, baseline, true).pass,
	).toBe(false);
	expect(
		compareBlazeEditorExportFrame(baseline, baseline, baseline, true).pass,
	).toBe(false);
	expect(
		compareBlazeEditorExportFrame(baseline, baseline, baseline, false).pass,
	).toBe(true);
});

test("project file gate permits only new private WebM exports and rejects any previous byte change", () => {
	const before = [
		{ path: "project.json", bytes: 10, sha256: "project" },
		{ path: "exports/previous.webm", bytes: 3, sha256: "previous" },
	];
	const added = { path: "exports/new-job.webm", bytes: 4, sha256: "new" };
	expect(assertOnlyBlazeExportsAdded(before, [...before, added])).toEqual([
		added,
	]);
	for (const after of [
		[before[0], added],
		[{ ...before[0], sha256: "changed" }, before[1]],
		[...before, { ...added, path: "unexpected/cache.json" }],
		[...before, { ...added, path: "exports/../escape.webm" }],
	])
		expect(() => assertOnlyBlazeExportsAdded(before, after)).toThrow();
});

test("30fps six-frame FFprobe timing retains 1.1ms limits for packets frames duration and final ends", () => {
	const metadata = {
		frames: 6,
		fps: 30,
		timelineTicks: [4000, 8000, 12000, 16000, 20000, 24000],
		localTicks: [4000, 8000, 12000, 16000, 20000, 24000],
	};
	const probe = {
		format: { duration: "0.2" },
		frames: Array.from({ length: 6 }, (_, index) => ({
			media_type: "video",
			best_effort_timestamp_time: String(index / 30),
			pkt_duration_time: String(1 / 30),
		})),
		packets: Array.from({ length: 6 }, (_, index) => ({
			codec_type: "video",
			pts_time: String(index / 30),
			duration_time: String(1 / 30),
		})),
	};
	expect(() => validateBlazePipelineProbeTiming(probe, metadata)).not.toThrow();
	const changed = structuredClone(probe);
	changed.packets[3].pts_time = String(3 / 30 + 0.0012);
	expect(() => validateBlazePipelineProbeTiming(changed, metadata)).toThrow();
	const wrongEnd = structuredClone(probe);
	wrongEnd.format.duration = "0.1988";
	expect(() => validateBlazePipelineProbeTiming(wrongEnd, metadata)).toThrow();
});

test("CPU references for unchanged ranges reject baseline stale UI seed and repeated-first alternatives", () => {
	const source = modelBlazeEditorPremultiplication(
		decodeBlazeEditorSourcePng(blazeHostImage()).pixels,
	);
	for (const segment of ["static", "animated", "disabled"] as const) {
		const result = blazeEditorExportReferences(source, segment);
		expect(result.discrimination.accepted).toBe(true);
		expect(result.expected).toHaveLength(6);
		if (segment === "disabled")
			for (const frame of result.expected)
				expect(frame).toEqual(result.baseline);
		else
			expect(result.negatives!.noEffect.every((metric) => !metric.pass)).toBe(
				true,
			);
	}
});

const spec = blazeEditorExportJobs[0];
const job = (status: string, extra: Record<string, unknown> = {}) => ({
	id: "export-job",
	options: spec.options,
	status,
	progress: status === "completed" ? 1 : 0,
	cancelRequested: false,
	...(status === "completed"
		? { outputPath: "C:/tmps/project/exports/export-job.webm" }
		: {}),
	...extra,
});

test("real export protocol accepts only 202 creation then independently polls exact options without POST retry", async () => {
	const root = await mkdtemp("C:/tmps/blaze-editor-export-unit-");
	const fetch = spyOn(globalThis, "fetch").mockResolvedValueOnce(
		Response.json(job("pending"), { status: 202 }),
	);
	const routes: string[] = [];
	try {
		const result = await runBlazeEditorExportJob({
			root,
			spec,
			editorUrl: "http://fixture.invalid/session/",
			request: async (route: string) => {
				routes.push(route);
				return job(routes.length === 1 ? "running" : "completed");
			},
		});
		expect(result.status).toBe("completed");
		expect(fetch).toHaveBeenCalledTimes(1);
		expect(routes).toEqual(["export/export-job", "export/export-job"]);
		expect(
			JSON.parse(
				await readFile(join(root, "default-static-request.json"), "utf8"),
			).options,
		).toEqual(spec.options);
	} finally {
		fetch.mockRestore();
	}
});

test("export terminal failures invalid status option drift and incomplete successful records remain hard failures", async () => {
	for (const terminal of [
		job("failed", { error: "failure" }),
		job("cancelled"),
		job("unexpected"),
		job("completed", { id: "other-job" }),
		job("completed", { options: { ...spec.options, videoChroma: "444" } }),
		job("completed", { error: "hidden failure" }),
		job("completed", { cancelRequested: true }),
		job("completed", { progress: 0.5 }),
		job("completed", { outputPath: undefined }),
	]) {
		const root = await mkdtemp("C:/tmps/blaze-editor-export-unit-");
		const fetch = spyOn(globalThis, "fetch").mockResolvedValueOnce(
			Response.json(job("pending"), { status: 202 }),
		);
		try {
			await expect(
				runBlazeEditorExportJob({
					root,
					spec,
					editorUrl: "http://fixture.invalid/session/",
					request: async () => terminal,
				}),
			).rejects.toThrow();
			expect(fetch).toHaveBeenCalledTimes(1);
		} finally {
			fetch.mockRestore();
		}
	}
});
