import { afterEach, beforeEach, expect, test } from "bun:test";
import { mediaTime } from "../../../wasm";
import { registerDefaultEffects } from "../../../effects";
import { registerDefaultMasks } from "../../../masks";
import { buildFrameDescriptor } from "../compositor/frame-descriptor";
import { resolveRenderTree } from "../resolve";
import { VideoNode } from "../nodes/video-node";
import { TransitionTrackNode } from "../nodes/transition-track-node";
import {
	fixture,
	decoder,
	renderer,
	frameRate,
	SampleCanvas,
	installCanvases,
} from "./transition-render-fixture";

let restore: () => void;
beforeEach(() => {
	restore = installCanvases();
});
afterEach(() => restore());
async function render({ data = fixture(), time = 360_000 } = {}) {
	const node = data.build();
	const cache = decoder();
	await resolveRenderTree({
		node,
		renderer,
		time,
		frameRate,
		videoCache: cache,
	});
	return { node, cache, ...(await buildFrameDescriptor({ node, renderer })) };
}

test("scene sampling emits one dissolve with Rust pre/post-roll clocks and stable branch textures", async () => {
	const result = await render();
	expect(result.cache.times).toEqual([4, 1]);
	expect(result.frame.items).toHaveLength(1);
	const transition = result.frame.items[0];
	if (transition.type !== "transition") throw new Error("Expected dissolve");
	expect(transition.progress).toBe(0.5);
	expect(transition.outgoing).toHaveLength(1);
	expect(transition.incoming).toHaveLength(1);
	expect(transition.outgoing[0].opacity).toBe(0.7);
	expect(transition.incoming[0].blendMode).toBe("screen");
	const samples = result.textures.map((texture) =>
		texture.kind === "external" && texture.source instanceof SampleCanvas
			? texture.source.sample
			: -1,
	);
	expect(samples).toEqual([4, 1]);
	const group = result.node.children[0];
	if (!(group instanceof TransitionTrackNode)) throw new Error("Missing track");
	const videos = group.children.filter((child) => child instanceof VideoNode);
	expect(videos.map((video) => video.resolved?.localTime)).toEqual([
		360_000, 0,
	]);
	await resolveRenderTree({
		node: result.node,
		renderer,
		time: 416_999,
		frameRate,
		videoCache: result.cache,
	});
	const later = await buildFrameDescriptor({ node: result.node, renderer });
	expect(later.textures.map((texture) => texture.id)).toEqual(
		result.textures.map((texture) => texture.id),
	);
	expect(videos.map((video) => video.resolved?.localTime)).toEqual([
		360_000, 56_000,
	]);
	expect(samples).toEqual([4, 1]);
});

test("half-open transition boundaries return to ordinary clip rendering", async () => {
	for (const [time, type, clocks] of [
		[299_999, "layer", [419_999 / 120_000]],
		[300_000, "transition", [3.5, 0.5]],
		[419_999, "transition", [536_000 / 120_000, 176_000 / 120_000]],
		[420_000, "layer", [1.5]],
	] as const) {
		const result = await render({ time });
		expect(result.frame.items.map((item) => item.type)).toEqual([type]);
		expect(result.cache.times).toEqual([...clocks]);
	}
});

test("blur backdrop and picture are mixed as one branch below upper overlays", async () => {
	const data = fixture({ blur: true });
	data.tracks.overlay.push({
		...data.tracks.main,
		id: "top",
		elements: [{ ...data.outgoing, id: "overlay", params: {} }],
	});
	const result = await render({ data, time: 328_000 });
	expect(result.frame.items.map((item) => item.type)).toEqual([
		"transition",
		"layer",
	]);
	const transition = result.frame.items[0];
	if (transition.type !== "transition") throw new Error("Expected dissolve");
	expect(transition.outgoing).toHaveLength(2);
	expect(transition.incoming).toHaveLength(2);
	expect(transition.outgoing[0].effectPassGroups[0].length).toBeGreaterThan(0);
	// Picture, blur and overlay share each same media/time decode, despite layer order.
	expect(result.cache.times).toHaveLength(2);
});

test("hidden endpoint disables only the visual relation without corrupting its graph", async () => {
	const data = fixture();
	data.outgoing.hidden = true;
	const before = await render({ data, time: 330_000 });
	expect(before.frame.items).toHaveLength(0);
	const cut = await render({ data });
	expect(cut.frame.items.map((item) => item.type)).toEqual(["layer"]);
	expect(cut.cache.times).toEqual([1]);
	expect(data.incoming.transitionIn?.outgoingClipId).toBe("a");
});

test("retime and explicit frame hold use Rust source samples, not the ordinary clock", async () => {
	const data = fixture();
	data.outgoing.freezeFrame = mediaTime({ ticks: 420_000 });
	data.incoming.retime = { rate: 2 };
	data.incoming.trimStart = mediaTime({ ticks: 240_000 });
	const result = await render({ data, time: 330_000 });
	// Playhead floors to frame 328000. Incoming signed local offset is -32000.
	expect(result.cache.times).toEqual([3.5, 176_000 / 120_000]);
});

test("preview and export build identical transition descriptors", async () => {
	const preview = await render({
		data: fixture({ preview: true, blur: true }),
	});
	const exported = await render({ data: fixture({ blur: true }) });
	expect(preview.frame).toEqual(exported.frame);
	expect(preview.cache.times).toEqual(exported.cache.times);
});

test("invalid graph, missing resource and missing source frame fail closed", async () => {
	const data = fixture();
	data.incoming.trimStart = mediaTime({ ticks: 0 });
	await expect(render({ data })).rejects.toThrow("missing-incoming-handle");
	const absent = fixture();
	absent.source.url = undefined;
	await expect(render({ data: absent })).rejects.toThrow("resource is missing");
	const node = fixture().build();
	await expect(
		resolveRenderTree({
			node,
			renderer,
			time: 360_000,
			frameRate,
			videoCache: { getFrameAt: async () => null },
		}),
	).rejects.toThrow("source frame is unavailable");
	expect(node.children[0].resolved).toBeNull();
	await resolveRenderTree({
		node,
		renderer,
		time: 360_000,
		frameRate,
		videoCache: decoder(),
	});
	expect(
		(await buildFrameDescriptor({ node, renderer })).frame.items[0].type,
	).toBe("transition");
});

test("transitions never guess a project frame rate", async () => {
	await expect(
		resolveRenderTree({
			node: fixture().build(),
			renderer,
			time: 360_000,
			videoCache: decoder(),
		}),
	).rejects.toThrow("project frame rate");
});

test("picture effects, masks and stroke layers remain inside their transition branch", async () => {
	registerDefaultEffects();
	registerDefaultMasks();
	const data = fixture();
	data.outgoing.effects = [
		{ id: "blur", type: "blur", enabled: true, params: { intensity: 10 } },
	];
	data.outgoing.masks = [
		{
			id: "mask",
			type: "rectangle",
			params: {
				centerX: 0,
				centerY: 0,
				width: 0.5,
				height: 0.5,
				rotation: 0,
				scale: 1,
				feather: 0,
				inverted: false,
				strokeColor: "#ffffff",
				strokeWidth: 3,
				strokeAlign: "center",
			},
		},
	];
	const result = await render({ data });
	const item = result.frame.items[0];
	if (item.type !== "transition") throw new Error("Expected dissolve");
	expect(item.outgoing).toHaveLength(2);
	expect(item.incoming).toHaveLength(1);
	expect(item.outgoing[0].mask).not.toBeNull();
	expect(item.outgoing[0].effectPassGroups[0].length).toBeGreaterThan(0);
	expect(item.outgoing[1].mask).toBeNull();
	expect(result.textures.length).toBeGreaterThan(2);
});

test("image transitions extend both pictures across the cut without requesting video", async () => {
	const originalImage = Object.getOwnPropertyDescriptor(globalThis, "Image");
	class TestImage {
		naturalWidth = 640;
		naturalHeight = 360;
		onload: (() => void) | null = null;
		set src(_value: string) {
			queueMicrotask(() => this.onload?.());
		}
	}
	Object.defineProperty(globalThis, "Image", {
		configurable: true,
		value: TestImage,
	});
	try {
		const data = fixture();
		data.source.type = "image";
		data.source.url = "blob:transition-image";
		data.tracks.main.elements = [
			{ ...data.outgoing, type: "image" },
			{ ...data.incoming, type: "image" },
		];
		for (const time of [300_000, 416_000]) {
			const result = await render({ data, time });
			expect(result.cache.times).toEqual([]);
			expect(result.frame.items[0].type).toBe("transition");
			expect(result.textures).toHaveLength(2);
		}
	} finally {
		if (originalImage)
			Object.defineProperty(globalThis, "Image", originalImage);
		else Reflect.deleteProperty(globalThis, "Image");
	}
});

test("source handle validation converts imported media duration seconds to ticks", async () => {
	const data = fixture();
	data.source.duration = 4.2;
	await expect(render({ data })).rejects.toThrow("missing-outgoing-handle");
	data.source.duration = 20;
	expect((await render({ data })).frame.items[0].type).toBe("transition");
});
