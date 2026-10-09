import { expect, test } from "bun:test";
import {
	createExportRegistry,
	NoCompatibleExportSurfaceError,
	parseExportOptions,
} from "../host-export";
import {
	EXPORT_PROTOCOL,
	LEGACY_EXPORT_PROTOCOL,
	parseVideoQuantizerFlag,
	requireQuantizerHost,
	supportsHighChromaProtocol,
	supportsQuantizerProtocol,
	surfaceExportProtocol,
} from "../host-export-protocol";

const options = { format: "webm", quality: "low", videoQuantizer: 0 } as const;
function surface() {
	const frames: unknown[] = [];
	return {
		frames,
		write: (chunk: string) => {
			frames.push(JSON.parse(chunk.slice(6)));
		},
	};
}
test("quantizer wire support is explicit v3 while v2 retains high-chroma support", async () => {
	expect(supportsHighChromaProtocol(LEGACY_EXPORT_PROTOCOL)).toBe(true);
	expect(supportsHighChromaProtocol(EXPORT_PROTOCOL)).toBe(true);
	expect(supportsQuantizerProtocol(LEGACY_EXPORT_PROTOCOL)).toBe(false);
	const chromaOnlyV3 = surfaceExportProtocol(
		new URLSearchParams("exportProtocol=3&exportVideoChroma=444"),
	);
	expect(supportsHighChromaProtocol(chromaOnlyV3)).toBe(true);
	expect(supportsQuantizerProtocol(chromaOnlyV3)).toBe(false);
	expect(
		surfaceExportProtocol(
			new URLSearchParams("exportProtocol=2&exportVideoChroma=444"),
		),
	).toEqual(LEGACY_EXPORT_PROTOCOL);
	expect(
		surfaceExportProtocol(
			new URLSearchParams(
				"exportProtocol=3&exportVideoQuantizer=true&exportVideoChroma=444",
			),
		),
	).toEqual(EXPORT_PROTOCOL);
	for (const protocol of [
		LEGACY_EXPORT_PROTOCOL,
		{ version: 3 },
		{ version: 3, videoQuantizer: "true" },
		{ version: 4, videoQuantizer: true },
	])
		await expect(
			requireQuantizerHost(async () => ({ protocol })),
		).rejects.toThrow("does not declare");
	await requireQuantizerHost(async () => ({ protocol: EXPORT_PROTOCOL }));
});
test("q0 dispatch and cancellation reach only a capable pane, never a v2 pane", () => {
	const book = createExportRegistry({
		projectDir: "C:/tmps/rocut-quantizer-unit-no-output",
	});
	const old = surface(),
		current = surface();
	book.attachSurface(old, LEGACY_EXPORT_PROTOCOL);
	expect(() => book.start(options)).toThrow(NoCompatibleExportSurfaceError);
	expect(book.list()).toHaveLength(0);
	const detach = book.attachSurface(current, EXPORT_PROTOCOL);
	const job = book.start(options);
	book.cancel(job.id);
	expect(current.frames).toEqual([
		{ command: "export.start", jobId: job.id, options },
		{ command: "export.cancel", jobId: job.id },
	]);
	expect(old.frames).toHaveLength(0);
	const next = book.start({ ...options, videoChroma: "444" });
	detach();
	expect(next.status).toBe("failed");
	expect(old.frames).toHaveLength(0);
});
test("combined chroma and quantizer require both declared pane capabilities", () => {
	const book = createExportRegistry({
		projectDir: "C:/tmps/rocut-quantizer-unit-no-output",
	});
	book.attachSurface(surface(), { version: 3, videoQuantizer: true });
	expect(() => book.start({ ...options, videoChroma: "444" })).toThrow(
		NoCompatibleExportSurfaceError,
	);
	expect(book.start(options).status).toBe("pending");
});
test("wire decoding preserves explicit numbers for Rust admission and rejects coercion", () => {
	expect(parseExportOptions(options)).toEqual(options);
	for (const videoQuantizer of [null, "0", {}, [], true, NaN, Infinity])
		expect(typeof parseExportOptions({ ...options, videoQuantizer })).toBe(
			"string",
		);
	for (const videoQuantizer of [64, -1, 0.5])
		expect(parseExportOptions({ ...options, videoQuantizer })).toEqual({
			...options,
			videoQuantizer,
		});
	expect(parseVideoQuantizerFlag(undefined)).toBeUndefined();
	expect(parseVideoQuantizerFlag("0")).toBe(0);
	for (const value of [true, "", "NaN", " 0"] as const)
		expect(() => parseVideoQuantizerFlag(value)).toThrow("--video-quantizer");
});
