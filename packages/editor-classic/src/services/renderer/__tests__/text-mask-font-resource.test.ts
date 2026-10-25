import { afterEach, expect, mock, spyOn, test } from "bun:test";
import * as resources from "../nodes/text-font-resource";
import { VisualNode } from "../nodes/visual-node";
import { MotionTextFontRuntime } from "../motion-text/font-runtime";
import type { TextMask } from "../../../masks/types";
import * as masks from "../../../masks";
import { ImageNode } from "../nodes/image-node";
import { buildFrameDescriptor } from "../compositor/frame-descriptor";
import { getElementFontFamilies } from "../../../timeline/element-utils";
import * as canvasUtils from "../canvas-utils";

afterEach(() => mock.restore());

function fixture() {
	const font = {
		id: "main",
		source: "project",
		assetId: "fixed-font",
		family: "Fixture",
		style: "normal",
		weight: 400,
	} as const;
	const admission = spyOn(resources, "pinnedTextFont").mockReturnValue(
		font as never,
	);
	const prepareFont = mock(async () => ({ ...font, family: "isolated-font" }));
	let generation = 0;
	const runtime = {
		inspect: () => ({ generation }),
		prepareFont,
	} as unknown as MotionTextFontRuntime;
	const mask = {
		id: "title-mask",
		type: "text",
		params: {
			content: "Title",
			fontFamily: "Fixture",
			"mv.fontResource": "descriptor",
		},
	} as TextMask;
	class Node extends VisualNode {}
	const node = new Node({
		duration: 10,
		timeOffset: 0,
		trimStart: 0,
		trimEnd: 0,
		transform: {} as never,
		opacity: 1,
		masks: [mask],
		fontRuntime: runtime,
		projectId: "project",
	});
	node.resolved = {
		localTime: 0,
		opacity: 1,
		transform: {} as never,
		effectPasses: [],
	};
	return {
		node,
		mask,
		font,
		admission,
		prepareFont,
		invalidate: () => {
			generation++;
		},
	};
}

test("text masks prepare project bytes without editing persisted font parameters", async () => {
	const { node, mask, admission, prepareFont, font } = fixture();
	await node.prepareMasks();
	expect(admission).toHaveBeenCalledWith("descriptor", undefined, "Fixture");
	expect(prepareFont).toHaveBeenCalledWith({
		projectId: "project",
		font,
		text: "Title",
	});
	expect(node.resolvedMasks?.[0].params).toMatchObject({
		fontFamily: "isolated-font",
		"mv.fontResource": "descriptor",
	});
	expect(mask.params.fontFamily).toBe("Fixture");
	expect(node.params.masks?.[0]).toBe(mask);
});

test("inactive clips and empty masks do not require unrelated fonts", async () => {
	const { node, mask, admission } = fixture();
	node.resolved = null;
	await node.prepareMasks();
	expect(admission).not.toHaveBeenCalled();
	node.resolved = {
		localTime: 0,
		opacity: 1,
		transform: {} as never,
		effectPasses: [],
	};
	mask.params.content = "  ";
	await node.prepareMasks();
	expect(admission).not.toHaveBeenCalled();
});

test("missing attachments, cancellation, and stale loads never fall back", async () => {
	const { node, prepareFont, invalidate } = fixture();
	prepareFont.mockImplementationOnce(async () => {
		throw Error("font attachment is missing");
	});
	await expect(node.prepareMasks()).rejects.toThrow(
		"Text mask title-mask font resource: font attachment is missing",
	);
	expect(node.resolvedMasks).toBeUndefined();
	prepareFont.mockImplementationOnce(async () => {
		invalidate();
		return { family: "stale" } as never;
	});
	await expect(node.prepareMasks()).rejects.toThrow("became stale");
	expect(node.resolvedMasks).toBeUndefined();
	const controller = new AbortController();
	controller.abort();
	await expect(node.prepareMasks(controller.signal)).rejects.toThrow();
	expect(node.resolvedMasks).toBeUndefined();
});

test("changing the mask selection during a pending font load rejects the old result", async () => {
	const { node, mask, prepareFont } = fixture();
	prepareFont.mockImplementationOnce(async () => {
		mask.params["mv.fontResource"] = "new-selection";
		return { family: "old-font" } as never;
	});
	await expect(node.prepareMasks()).rejects.toThrow("selection changed");
	expect(node.resolvedMasks).toBeUndefined();
});

test("the compositor passes the prepared family to the text mask producer", async () => {
	const { node: prepared, mask } = fixture();
	await prepared.prepareMasks();
	const drawOpaque = mock(
		(_args: { resolvedParams: { fontFamily: string } }) => {},
	);
	spyOn(masks, "getMaskDefinition").mockReturnValue({
		renderer: { body: { kind: "drawOpaque", drawOpaque } },
	} as never);
	const transform = {
		position: { x: 0, y: 0 },
		scaleX: 1,
		scaleY: 1,
		rotate: 0,
	};
	const node = new ImageNode({ ...prepared.params, transform, url: "fixture" });
	node.resolvedMasks = prepared.resolvedMasks;
	node.resolved = {
		localTime: 0,
		transform,
		opacity: 1,
		effectPasses: [],
		source: { width: 100, height: 100 } as ImageBitmap,
		sourceWidth: 100,
		sourceHeight: 100,
	};
	const result = await buildFrameDescriptor({
		node,
		renderer: { width: 100, height: 100 },
	});
	const ctx = new Proxy(
		{},
		{ get: () => () => {} },
	) as CanvasRenderingContext2D;
	spyOn(canvasUtils, "createCanvasSurface").mockReturnValue({
		canvas: {} as OffscreenCanvas,
		context: ctx as OffscreenCanvasRenderingContext2D,
	});
	for (const texture of result.textures)
		if (texture.kind === "rendered") texture.draw(ctx);
	expect(drawOpaque).toHaveBeenCalled();
	expect(drawOpaque.mock.calls[0][0].resolvedParams.fontFamily).toBe(
		"isolated-font",
	);
	expect(mask.params.fontFamily).toBe("Fixture");
});

test("pinned masks do not trigger system or network font family loading", () => {
	const { mask } = fixture();
	const track = { elements: [{ type: "image", masks: [mask] }] };
	const tracks = { main: track, overlay: [], audio: [] } as never;
	expect(getElementFontFamilies({ tracks })).toEqual([]);
	delete mask.params["mv.fontResource"];
	expect(getElementFontFamilies({ tracks })).toEqual(["Fixture"]);
});

test("a missing project attachment is rejected by the actual shared font runtime", async () => {
	const { node } = fixture();
	const loadProjectFont = mock(async () => null);
	const runtime = new MotionTextFontRuntime({
		loadProjectFont,
		loadBuiltinFont: async () => {
			throw Error("A project mask must not load a builtin font");
		},
	});
	node.params.fontRuntime = runtime;
	try {
		await expect(node.prepareMasks()).rejects.toThrow(
			"font attachment is missing",
		);
		expect(loadProjectFont).toHaveBeenCalledWith({
			projectId: "project",
			assetId: "fixed-font",
			signal: expect.any(AbortSignal),
		});
		expect(node.resolvedMasks).toBeUndefined();
	} finally {
		runtime.dispose();
	}
});
