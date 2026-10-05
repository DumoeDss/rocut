import { expect, test } from "bun:test";
import type { PlannedClipExport } from "opencut-wasm";
import { runClipExportBatch } from "../clip-export-batch";
import type { ExportOptions, ExportResult } from "..";

const clips: PlannedClipExport[] = [0, 1].map((index) => ({
	reference: { trackId: "video", elementId: `clip-${index}` },
	name: "clip",
	trackName: "Video",
	filenameStem: `00${index + 1}-clip`,
	startTime: (index + 1) * 120000,
	endTime: (index + 2) * 120000,
}));
function harness() {
	const controller = new AbortController();
	const rendered: ExportOptions[] = [];
	const published: Array<{ buffer: ArrayBuffer; filename: string }> = [];
	const options = {
		format: "webm" as const,
		quality: "high" as const,
		includeAudio: true,
	};
	const render = async (options: ExportOptions): Promise<ExportResult> => {
		rendered.push(options);
		return { success: true, buffer: Uint8Array.of(rendered.length).buffer };
	};
	return {
		controller,
		rendered,
		published,
		args: {
			clips,
			options,
			signal: controller.signal,
			assertCurrent: () => {},
			render,
			publish: (output: { buffer: ArrayBuffer; filename: string }) => {
				published.push(output);
			},
			onClip: () => {},
		},
	};
}

test("renders every planned timeline range separately and publishes unique output names", async () => {
	const h = harness();
	expect(await runClipExportBatch(h.args)).toEqual({
		completed: 2,
		cancelled: false,
	});
	expect(h.rendered.map((x) => x.range)).toEqual([
		{ startTime: 120000, endTime: 240000 },
		{ startTime: 240000, endTime: 360000 },
	]);
	expect(h.rendered.every((x) => x.includeAudio && x.format === "webm")).toBe(
		true,
	);
	expect(h.published.map((x) => x.filename)).toEqual([
		"001-clip.webm",
		"002-clip.webm",
	]);
	expect(h.published.map((x) => [...new Uint8Array(x.buffer)])).toEqual([
		[1],
		[2],
	]);
});

test("cancel during rendering suppresses that download and every later clip", async () => {
	const h = harness();
	h.args.render = async (options) => {
		h.rendered.push(options);
		h.controller.abort();
		return { success: true, buffer: new ArrayBuffer(1) };
	};
	expect(await runClipExportBatch(h.args)).toEqual({
		completed: 0,
		cancelled: true,
	});
	expect(h.rendered).toHaveLength(1);
	expect(h.published).toHaveLength(0);
});

test("project or session change after await cannot publish a stale buffer", async () => {
	const h = harness();
	let current = true;
	h.args.assertCurrent = () => {
		if (!current) throw new Error("stale timeline");
	};
	h.args.render = async () => {
		current = false;
		return { success: true, buffer: new ArrayBuffer(1) };
	};
	expect(await runClipExportBatch(h.args)).toEqual({
		completed: 0,
		cancelled: false,
		error: "stale timeline",
	});
	expect(h.published).toHaveLength(0);
});

test("a later encoder failure retains truthful partial completion and stops the batch", async () => {
	const h = harness();
	const render = h.args.render;
	h.args.render = async (options) =>
		h.published.length
			? { success: false, error: "encoder unavailable" }
			: render(options);
	expect(await runClipExportBatch(h.args)).toEqual({
		completed: 1,
		cancelled: false,
		error: "encoder unavailable",
	});
	expect(h.published).toHaveLength(1);
});

test("an empty or already-cancelled selection does not render a full project", async () => {
	const h = harness();
	expect(await runClipExportBatch({ ...h.args, clips: [] })).toEqual({
		completed: 0,
		cancelled: false,
	});
	h.controller.abort();
	expect(await runClipExportBatch(h.args)).toEqual({
		completed: 0,
		cancelled: true,
	});
	expect(h.rendered).toHaveLength(0);
});
