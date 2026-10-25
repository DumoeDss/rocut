import { expect, mock, test } from "bun:test";
import { buildFrameDescriptor } from "../compositor/frame-descriptor";
import { ImageNode } from "../nodes/image-node";
import { VideoNode } from "../nodes/video-node";
import { BlurBackgroundNode } from "../nodes/blur-background-node";

const crop = {
	sourceX: 250,
	sourceY: 0,
	sourceWidth: 500,
	sourceHeight: 500,
	width: 500,
	height: 500,
};
const source: ImageBitmap = { width: 1000, height: 500, close() {} };
const transform = {
	position: { x: 10, y: 20 },
	scaleX: 1,
	scaleY: 1,
	rotate: 0,
};
const params = {
	duration: 120000,
	timeOffset: 0,
	trimStart: 0,
	trimEnd: 0,
	transform,
	opacity: 0.8,
	url: "fixture",
};
const renderer = { width: 200, height: 100 };

for (const type of ["image", "video"] as const)
	test(`${type} crops before contain/transform and refreshes pooled frames`, async () => {
		const node =
			type === "image"
				? new ImageNode(params)
				: new VideoNode({
						...params,
						mediaId: "video",
						file: new File([], "fixture.mp4"),
					});
		node.resolved = {
			source,
			sourceVersion: "frame:1",
			sourceWidth: 500,
			sourceHeight: 500,
			sourceCrop: crop,
			transform,
			opacity: 0.8,
			localTime: 0,
			effectPasses: [],
		};
		const first = await buildFrameDescriptor({ node, renderer });
		expect(first.frame.items[0]).toMatchObject({
			type: "layer",
			opacity: 0.8,
			transform: { centerX: 110, centerY: 70, width: 100, height: 100 },
		});
		const texture = first.textures[0];
		if (texture.kind !== "rendered") throw new Error("Missing cropped texture");
		const drawImage = mock(() => {});
		// eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- Isolated draw-call recorder; no browser canvas is rendered.
		texture.draw({ drawImage } as unknown as CanvasRenderingContext2D);
		expect(drawImage).toHaveBeenCalledWith(
			source,
			250,
			0,
			500,
			500,
			0,
			0,
			500,
			500,
		);
		node.resolved.sourceVersion = "frame:2";
		const second = await buildFrameDescriptor({ node, renderer });
		expect(second.textures[0]).not.toMatchObject({
			contentHash: texture.contentHash,
		});
		delete node.resolved.sourceCrop;
		node.resolved.sourceWidth = 1000;
		const full = await buildFrameDescriptor({ node, renderer });
		expect(full.textures[0].kind).toBe("external");
	});

test("blur backdrops sample the same cropped source instead of exposing removed pixels", async () => {
	const node = new BlurBackgroundNode({
		...params,
		mediaType: "image",
		mediaId: "image",
		file: new File([], "fixture.png"),
		blurIntensity: 0,
	});
	node.resolved = {
		backdropSource: { source, width: 500, height: 500, sourceCrop: crop },
		passes: [],
	};
	const result = await buildFrameDescriptor({ node, renderer });
	const texture = result.textures[0];
	if (texture.kind !== "rendered") throw new Error("Missing backdrop texture");
	const drawImage = mock(() => {});
	// eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- Isolated draw-call recorder; no browser canvas is rendered.
	texture.draw({ drawImage } as unknown as CanvasRenderingContext2D);
	expect(drawImage).toHaveBeenCalledWith(
		source,
		250,
		0,
		500,
		500,
		0,
		-50,
		200,
		200,
	);
});
