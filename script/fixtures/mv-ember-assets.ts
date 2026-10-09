import type { ResolvedProgrammaticResource } from "@opencut/editor-contracts";
import type { EmberReferenceAsset } from "./mv-ember-reference-contract";
import { convergeReferenceDigest } from "./mv-converge-reference-realm";
import { orientedJpeg } from "./mv-image-metrics-support";

async function declared(id: string, mimeType: string, body: ArrayBuffer) {
	const sha256 = await convergeReferenceDigest(body);
	const asset: EmberReferenceAsset = { id, mimeType, body, sha256 };
	const resolved: ResolvedProgrammaticResource = {
		body,
		resource: {
			id,
			kind: "image",
			mimeType,
			byteLength: body.byteLength,
			sha256,
			attachmentKey: `programmatic-sha256-${sha256}`,
		},
	};
	return { asset, resolved };
}

export async function emberAssets() {
	const response = await fetch("/ember-assets/dot-gothic-16-regular.ttf");
	if (!response.ok)
		throw Error("Missing explicit local DotGothic16 font bytes");
	const font = await declared(
		"ember-dot.ttf",
		"font/ttf",
		await response.arrayBuffer(),
	);
	font.resolved = {
		...font.resolved,
		resource: {
			...font.resolved.resource,
			kind: "font",
			font: { family: "DotGothic16", weight: 400, style: "normal" },
		},
	};
	const images: Awaited<ReturnType<typeof declared>>[] = [];
	for (const [id, width, height, type] of [
		["wide.png", 360, 140, "image/png"],
		["portrait.png", 140, 360, "image/png"],
		["oriented.jpeg", 360, 140, "image/jpeg"],
	] as const) {
		const canvas = new OffscreenCanvas(width, height),
			ctx = canvas.getContext("2d")!;
		ctx.fillStyle = "#123456";
		ctx.fillRect(0, 0, width, height);
		for (let row = 0; row < 7; row++)
			for (let col = 0; col < 9; col++) {
				ctx.fillStyle = `rgb(${20 + col * 25},${20 + row * 32},${((row + col) % 2) * 180})`;
				ctx.fillRect(
					(col * width) / 9 + 3,
					(row * height) / 7 + 3,
					width / 9 - 6,
					height / 7 - 6,
				);
			}
		const blob = await canvas.convertToBlob({ type, quality: 0.95 });
		if (blob.type !== type) throw Error("Missing genuine image encoder");
		let body = await blob.arrayBuffer();
		if (type === "image/jpeg") body = orientedJpeg(body);
		images.push(await declared(id, type, body));
		canvas.width = canvas.height = 1;
	}
	return { font, images };
}
