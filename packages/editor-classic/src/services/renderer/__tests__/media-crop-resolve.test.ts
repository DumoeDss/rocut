import { afterEach, expect, mock, spyOn, test } from "bun:test";
import * as mediaCrop from "../../../wasm/media-crop";
import * as images from "../nodes/image-node";
import { VideoNode } from "../nodes/video-node";
import {
	resolveImageNode,
	resolveVideoNode,
	resolveBlurBackgroundNode,
} from "../resolve-picture";
import { BlurBackgroundNode } from "../nodes/blur-background-node";
import type { ResolveContext } from "../resolve-context";

afterEach(() => mock.restore());
const bounds = { left: 0.25, top: 0, right: 0.75, bottom: 1 };
const geometry = {
	sourceX: 250,
	sourceY: 0,
	sourceWidth: 500,
	sourceHeight: 500,
	width: 500,
	height: 500,
};
class FixtureCanvas extends EventTarget implements OffscreenCanvas {
	width = 1000;
	height = 500;
	oncontextlost = null;
	oncontextrestored = null;
	getContext(): null {
		return null;
	}
	convertToBlob(): Promise<Blob> {
		throw new Error("No rendering in source-resolution fixture");
	}
	transferToImageBitmap(): ImageBitmap {
		throw new Error("No rendering in source-resolution fixture");
	}
}
const canvas = new FixtureCanvas();
const base = {
	duration: 120000,
	timeOffset: 0,
	trimStart: 0,
	trimEnd: 0,
	url: "fixture",
	crop: bounds,
	opacity: 1,
	transform: { position: { x: 0, y: 0 }, scaleX: 1, scaleY: 1, rotate: 0 },
};

test("image and video resolution use native cropped dimensions before effect and transform sizing", async () => {
	const crop = spyOn(mediaCrop, "resolveMediaCrop").mockReturnValue(geometry);
	spyOn(images, "loadImageSource").mockResolvedValue({
		source: canvas,
		width: 1000,
		height: 500,
	});
	const context: ResolveContext = {
		renderer: { width: 200, height: 100 },
		time: 0,
		sample: { sourceTime: 0, localTime: 0 },
		videoCache: { getFrameAt: mock(async () => ({ canvas, timestamp: 0 })) },
	};
	const image = await resolveImageNode({
		node: new images.ImageNode(base),
		context,
	});
	const video = await resolveVideoNode({
		node: new VideoNode({
			...base,
			mediaId: "video",
			file: new File([], "video.mp4"),
		}),
		context,
	});
	for (const state of [image, video])
		expect(state).toMatchObject({
			source: canvas,
			sourceWidth: 500,
			sourceHeight: 500,
			sourceCrop: geometry,
		});
	expect(crop).toHaveBeenCalledWith({
		crop: bounds,
		sourceWidth: 1000,
		sourceHeight: 500,
	});
});

test("blur source resolution shares native crop geometry for images and videos", async () => {
	spyOn(mediaCrop, "resolveMediaCrop").mockReturnValue(geometry);
	spyOn(images, "loadImageSource").mockResolvedValue({
		source: canvas,
		width: 1000,
		height: 500,
	});
	const context: ResolveContext = {
		renderer: { width: 200, height: 100 },
		time: 0,
		sample: { sourceTime: 0, localTime: 0 },
		videoCache: { getFrameAt: mock(async () => ({ canvas, timestamp: 0 })) },
	};
	for (const mediaType of ["image", "video"] as const) {
		const node = new BlurBackgroundNode({
			...base,
			mediaType,
			mediaId: "media",
			file: new File([], "media"),
			blurIntensity: 0,
		});
		expect(await resolveBlurBackgroundNode({ node, context })).toMatchObject({
			backdropSource: {
				source: canvas,
				width: 500,
				height: 500,
				sourceCrop: geometry,
			},
		});
	}
});

test("inactive images do not load missing bytes or prepare an unrelated source crop", async () => {
	const crop = spyOn(mediaCrop, "resolveMediaCrop").mockImplementation(() => {
		throw new Error("Unrelated crop must not run");
	});
	// Bun 1.2.18 creates an eager rejected promise for mockRejectedValue;
	// this negative-call assertion needs a rejection only if the loader runs.
	const load = spyOn(images, "loadImageSource").mockImplementation(async () => {
		throw new Error("Unrelated image must not load");
	});
	const context: ResolveContext = {
		renderer: { width: 200, height: 100 },
		time: 240000,
		videoCache: { getFrameAt: mock(async () => null) },
	};
	expect(
		await resolveImageNode({ node: new images.ImageNode(base), context }),
	).toBeNull();
	expect(crop).not.toHaveBeenCalled();
	expect(load).not.toHaveBeenCalled();
});
