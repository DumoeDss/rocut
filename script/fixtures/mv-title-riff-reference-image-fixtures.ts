import type { TitleRiffImage } from "./mv-title-riff-reference-contract";
import { convergeReferenceDigest } from "./mv-converge-reference-realm";

/** Encoded, decoded and alpha-verified marker images; not claimed original film art. */
export async function titleRiffTestImages(): Promise<TitleRiffImage[]> {
	const images: TitleRiffImage[] = [];
	for (const [id, width, height] of [["character.png", 192, 320], ["sky.png", 480, 270], ["dawn.png", 270, 480]] as const) {
		const canvas = document.createElement("canvas"); canvas.width = width; canvas.height = height;
		const ctx = canvas.getContext("2d")!;
		if (id === "character.png") {
			ctx.fillStyle = "#3cb5d9"; ctx.beginPath(); ctx.ellipse(94, 70, 39, 48, 0.1, 0, Math.PI * 2); ctx.fill();
			ctx.fillStyle = "rgba(220,90,120,.75)"; ctx.fillRect(52, 98, 87, 181);
			ctx.fillStyle = "#f0ba72"; ctx.fillRect(55, 275, 26, 38); ctx.fillRect(105, 275, 26, 38);
		} else {
			const gradient = ctx.createLinearGradient(0, 0, width, height);
			gradient.addColorStop(0, id === "sky.png" ? "#2655ac" : "#faad76"); gradient.addColorStop(1, "#18253c");
			ctx.fillStyle = gradient; ctx.fillRect(0, 0, width, height);
			for (let i = 0; i < 9; i++) { ctx.fillStyle = i % 2 ? "#daf5dd" : "#c54b79"; ctx.fillRect(i * width / 9, height * .6, width / 18, height * .4); }
		}
		const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(Error("Marker PNG failed")), "image/png"));
		const body = await blob.arrayBuffer(); canvas.width = canvas.height = 1;
		images.push({ id, width, height, hasTransparency: id === "character.png", mimeType: "image/png", byteLength: body.byteLength, sha256: await convergeReferenceDigest(body), body });
	}
	return images;
}
