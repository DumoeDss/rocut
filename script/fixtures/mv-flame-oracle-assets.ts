import type { ResolvedProgrammaticResource } from "@opencut/editor-contracts";
import { kanjiDigest as digest } from "./mv-kanji-slam-reference-realm";

/** Synthetic painting, not reference-film artwork. Warm pixels trigger the
 * original mask; cool edges, alpha and column markers expose repair/feathering.
 */
export async function flameOracleAssets(): Promise<
	ResolvedProgrammaticResource[]
> {
	const canvas = document.createElement("canvas");
	canvas.width = 960;
	canvas.height = 1600;
	try {
		const ctx = canvas.getContext("2d")!;
		ctx.fillStyle = "rgba(45,78,119,.74)";
		ctx.fillRect(0, 0, 960, 1600);
		for (let i = 0; i < 36; i++) {
			ctx.fillStyle = i % 2 ? "#625795" : "rgba(27,63,93,.55)";
			ctx.fillRect(15 + i * 26, 20 + (i % 5) * 9, 11, 550 + (i % 3) * 30);
		}
		ctx.fillStyle = "#628fbc";
		ctx.beginPath();
		ctx.ellipse(440, 1030, 270, 460, 0, 0, Math.PI * 2);
		ctx.fill();
		ctx.fillStyle = "#d2aaa4";
		ctx.beginPath();
		ctx.ellipse(432, 328, 145, 210, 0, 0, Math.PI * 2);
		ctx.fill();
		ctx.fillStyle = "#ece2c8";
		ctx.fillRect(380, 657, 380, 34);
		ctx.fillStyle = "#e35d16";
		ctx.beginPath();
		ctx.ellipse(588, 565, 91, 174, 0.12, 0, Math.PI * 2);
		ctx.fill();
		ctx.fillStyle = "#fff1d8";
		ctx.beginPath();
		ctx.arc(588, 632, 33, 0, Math.PI * 2);
		ctx.fill();
		const blob = await new Promise<Blob>((resolve, reject) =>
			canvas.toBlob(
				(value) =>
					value ? resolve(value) : reject(Error("Flame marker PNG failed")),
				"image/png",
			),
		);
		const body = await blob.arrayBuffer(),
			sha256 = await digest(body);
		return ["assets/char/flame_hands.png", "assets/char/bust_calm.png"].map(
			(id) => ({
				body: body.slice(0),
				resource: {
					id,
					kind: "image",
					mimeType: "image/png",
					byteLength: body.byteLength,
					sha256,
					attachmentKey: `programmatic-sha256-${sha256}`,
				},
			}),
		);
	} finally {
		canvas.width = canvas.height = 1;
	}
}
