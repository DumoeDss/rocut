import type {
	ProgrammaticResource,
	ResolvedProgrammaticResource,
} from "@opencut/editor-contracts";
import {
	assertGenerator as assert,
	generatorHash,
} from "./generator-browser-assets";

export async function sweepScrollAssets() {
	const response = await fetch(
		"/apps/web/public/motion-text/fonts/ibm-plex-mono-medium.ttf",
	);
	assert(response.ok, "Sweep fixture font unavailable");
	const fontBody = await response.arrayBuffer();
	const image = new OffscreenCanvas(64, 36),
		ctx = image.getContext("2d")!;
	const pixels = ctx.createImageData(64, 36);
	for (let y = 0; y < 36; y++)
		for (let x = 0; x < 64; x++) {
			const i = (y * 64 + x) * 4;
			pixels.data[i] = 20 + x * 3;
			pixels.data[i + 1] = 30 + y * 6;
			pixels.data[i + 2] = (x * 7 + y * 11) % 256;
			pixels.data[i + 3] =
				x < 4 ||
				x >= 60 ||
				y < 4 ||
				y >= 32 ||
				(x >= 28 && x < 36 && y >= 14 && y < 22)
					? 0
					: x < 32
						? 255
						: 128;
		}
	ctx.putImageData(pixels, 0, 0);
	const imageBody = await (
		await image.convertToBlob({ type: "image/png" })
	).arrayBuffer();
	const item = async (
		body: ArrayBuffer,
		metadata: Pick<ProgrammaticResource, "id" | "kind" | "mimeType" | "font">,
	): Promise<ResolvedProgrammaticResource> => {
		const sha256 = await generatorHash(body);
		return {
			body,
			resource: {
				...metadata,
				byteLength: body.byteLength,
				sha256,
				attachmentKey: `programmatic-sha256-${sha256}`,
			},
		};
	};
	const resources = [
		await item(fontBody, {
			id: "sweep.ttf",
			kind: "font",
			mimeType: "font/ttf",
			font: { family: "RocutSweepFixture", weight: 500, style: "normal" },
		}),
		await item(imageBody, {
			id: "scroll.png",
			kind: "image",
			mimeType: "image/png",
		}),
	];
	const font = new FontFace("RocutSweepFixture", fontBody, {
		weight: "500",
		style: "normal",
	});
	await font.load();
	document.fonts.add(font);
	return { resources, image };
}
