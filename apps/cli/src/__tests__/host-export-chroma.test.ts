import { expect, test } from "bun:test";
import {
	createExportRegistry,
	NoCompatibleExportSurfaceError,
	parseExportOptions,
	type ExportOptions,
} from "../host-export";
import {
	EXPORT_PROTOCOL,
	LEGACY_EXPORT_PROTOCOL,
	parseVideoChromaFlag,
	requireHighChromaHost,
	supportsHighChromaProtocol,
	surfaceExportProtocol,
} from "../host-export-protocol";

const highChroma: ExportOptions = {
	format: "webm",
	quality: "medium",
	videoChroma: "444",
	includeAudio: false,
};
function surface() {
	const frames: unknown[] = [];
	return {
		frames,
		write: (chunk: string) => {
			frames.push(JSON.parse(chunk.slice(6)));
		},
	};
}
const registry = () =>
	createExportRegistry({ projectDir: "C:/tmps/rocut-chroma-unit-no-output" });

test("chroma parsing keeps legacy defaults and quality independent", () => {
	expect(parseExportOptions({})).toEqual({ format: "mp4", quality: "high" });
	for (const quality of ["low", "medium", "high", "very_high"] as const) {
		expect(parseExportOptions({ ...highChroma, quality })).toEqual({
			...highChroma,
			quality,
		});
		for (const format of ["mp4", "webm"] as const)
			expect(
				parseExportOptions({ format, quality, videoChroma: "420" }),
			).toEqual({ format, quality, videoChroma: "420" });
	}
	for (const videoChroma of [null, true, 444, "422", "", {}, ["444"]])
		expect(typeof parseExportOptions({ format: "webm", videoChroma })).toBe(
			"string",
		);
	expect(typeof parseExportOptions({ format: "mp4", videoChroma: "444" })).toBe(
		"string",
	);
	expect(typeof parseExportOptions({ videoChroma: "444" })).toBe("string");
});

test("CLI chroma flag is explicit and malformed or non-WebM requests fail before dispatch", () => {
	expect(parseVideoChromaFlag(undefined, "mp4")).toBeUndefined();
	expect(parseVideoChromaFlag("420", "mp4")).toBe("420");
	expect(parseVideoChromaFlag("444", "webm")).toBe("444");
	for (const value of [true, "", "422"] as const)
		expect(() => parseVideoChromaFlag(value, "webm")).toThrow();
	expect(() => parseVideoChromaFlag("444", "mp4")).toThrow("--format webm");
});

test("CLI preflight refuses old/malformed Host declarations instead of silently downgrading", async () => {
	for (const status of [
		null,
		{},
		{ protocol: { version: 1, videoChroma: ["444"] } },
		{ protocol: { version: 2, videoChroma: ["420"] } },
		{ protocol: { version: 2, videoChroma: "444" } },
	]) {
		await expect(requireHighChromaHost(async () => status)).rejects.toThrow(
			"does not declare",
		);
	}
	await requireHighChromaHost(async () => ({
		protocol: EXPORT_PROTOCOL,
		surfaces: 0,
		jobs: [],
	}));
	await expect(
		requireHighChromaHost(async () => {
			throw Error("offline");
		}),
	).rejects.toThrow("offline");
});

test("SSE high-chroma support requires both version and explicit chroma declaration", () => {
	for (const query of [
		"",
		"exportProtocol=2",
		"exportVideoChroma=444",
		"exportProtocol=1&exportVideoChroma=444",
		"exportProtocol=2&exportVideoChroma=420",
	])
		expect(surfaceExportProtocol(new URLSearchParams(query))).toBeUndefined();
	expect(
		surfaceExportProtocol(
			new URLSearchParams("exportProtocol=2&exportVideoChroma=444"),
		),
	).toEqual(LEGACY_EXPORT_PROTOCOL);
	expect(supportsHighChromaProtocol(EXPORT_PROTOCOL)).toBe(true);
});

test("only the first explicitly capable pane receives 444 start and cancellation", () => {
	const book = registry(),
		old = surface(),
		first = surface(),
		second = surface();
	book.attachSurface(old);
	book.attachSurface(first, EXPORT_PROTOCOL);
	book.attachSurface(second, EXPORT_PROTOCOL);
	const job = book.start(highChroma);
	book.cancel(job.id);
	expect(first.frames).toEqual([
		{ command: "export.start", jobId: job.id, options: highChroma },
		{ command: "export.cancel", jobId: job.id },
	]);
	expect(old.frames).toEqual([]);
	expect(second.frames).toEqual([]);
	expect(book.get(job.id)?.cancelRequested).toBe(true);
});

test("old panes cannot accept 444 but default and explicit 420 retain broadcast behavior", () => {
	const book = registry(),
		old = surface(),
		current = surface();
	book.attachSurface(old);
	expect(() => book.start(highChroma)).toThrow(NoCompatibleExportSurfaceError);
	expect(book.list()).toHaveLength(0);
	book.attachSurface(current, EXPORT_PROTOCOL);
	for (const videoChroma of [undefined, "420"] as const) {
		const job = book.start({
			format: "webm",
			quality: "low",
			...(videoChroma ? { videoChroma } : {}),
		});
		book.cancel(job.id);
	}
	expect(old.frames).toHaveLength(4);
	expect(current.frames).toEqual(old.frames);
});

test("selected pane disconnect or write failure never reroutes a high-chroma job", async () => {
	const book = registry(),
		old = surface(),
		first = surface(),
		second = surface();
	book.attachSurface(old);
	const detach = book.attachSurface(first, EXPORT_PROTOCOL);
	book.attachSurface(second, EXPORT_PROTOCOL);
	const job = book.start(highChroma);
	detach();
	expect(book.get(job.id)?.status).toBe("failed");
	book.cancel(job.id);
	await book.complete(job.id, new Uint8Array([1]));
	expect(job.outputPath).toBeUndefined();
	expect(old.frames).toEqual([]);
	expect(second.frames).toEqual([]);
	const broken = registry(),
		fallback = surface();
	broken.attachSurface(
		{
			write() {
				throw Error("gone");
			},
		},
		EXPORT_PROTOCOL,
	);
	broken.attachSurface(fallback, EXPORT_PROTOCOL);
	expect(broken.start(highChroma).status).toBe("failed");
	expect(fallback.frames).toEqual([]);
});

test("late upload after targeted cancellation publishes no output", async () => {
	const book = registry();
	book.attachSurface(surface(), EXPORT_PROTOCOL);
	const job = book.start(highChroma);
	book.cancel(job.id);
	expect((await book.complete(job.id, new Uint8Array([1])))?.status).toBe(
		"cancelled",
	);
	expect(job.outputPath).toBeUndefined();
});
