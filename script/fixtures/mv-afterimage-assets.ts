import type {
	ProgrammaticResource,
	ResolvedProgrammaticResource,
} from "@opencut/editor-contracts";
import { AFTERIMAGE_FONT_FACES } from "./mv-afterimage-reference-contract";
import { referenceDigest } from "./mv-afterimage-reference-realm";

export async function afterimageAssets() {
	const response = await fetch("/afterimage-font.ttf");
	if (!response.ok) throw Error("Local afterimage fixture font missing");
	const fontBody = await response.arrayBuffer();
	const character = new OffscreenCanvas(128, 256),
		ctx = character.getContext("2d")!;
	ctx.fillStyle = "white";
	ctx.beginPath();
	ctx.ellipse(61, 51, 31, 40, 0, 0, Math.PI * 2);
	ctx.fill();
	ctx.beginPath();
	ctx.moveTo(37, 89);
	ctx.lineTo(95, 89);
	ctx.lineTo(117, 237);
	ctx.lineTo(78, 246);
	ctx.lineTo(68, 164);
	ctx.lineTo(55, 248);
	ctx.lineTo(16, 237);
	ctx.closePath();
	ctx.fill();
	// An asymmetric partially transparent section catches lost destination-out alpha.
	ctx.globalCompositeOperation = "destination-out";
	ctx.globalAlpha = 0.5;
	ctx.fillRect(70, 110, 35, 40);
	const imageBody = await (
		await character.convertToBlob({ type: "image/png" })
	).arrayBuffer();
	const item = async (
		body: ArrayBuffer,
		metadata: Pick<ProgrammaticResource, "id" | "kind" | "mimeType" | "font">,
	): Promise<ResolvedProgrammaticResource> => {
		const sha256 = await referenceDigest(body);
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
	const resources = await Promise.all(
		AFTERIMAGE_FONT_FACES.map((definition) =>
			item(fontBody.slice(0), {
				id: definition.role,
				kind: "font",
				mimeType: "font/ttf",
				font: {
					family: definition.family,
					weight: Number(definition.weight),
					style: "normal",
				},
			}),
		),
	);
	resources.push(
		await item(imageBody, {
			id: "character",
			kind: "image",
			mimeType: "image/png",
		}),
	);
	return {
		resources,
		character,
		fonts: {
			title: fontBody.slice(0),
			subtitle: fontBody.slice(0),
			credit: fontBody.slice(0),
		},
	};
}
