import type { InkImage } from "./mv-ink-contract";
import { inkDigest } from "./mv-ink-oracle-realm";

/** Synthetic partially transparent asymmetric character; no Ink scene geometry. */
export function inkCharacterPixels({
	width = 480,
	height = 960,
	changedBody = false,
}: {
	width?: number;
	height?: number;
	changedBody?: boolean;
} = {}) {
	if (
		!Number.isSafeInteger(width) ||
		!Number.isSafeInteger(height) ||
		width < 32 ||
		height < 32 ||
		width > 2048 ||
		height > 2048
	)
		throw Error("Invalid Ink fixture image dimensions");
	const data = new Uint8ClampedArray(width * height * 4);
	for (let y = 0; y < height; y++)
		for (let x = 0; x < width; x++) {
			const u = x / width,
				v = y / height;
			const head =
				(u - (changedBody ? 0.53 : 0.49)) ** 2 / 0.0225 +
					(v - 0.15) ** 2 / 0.0121 <
				1;
			const body =
				v >= 0.24 && v < 0.7 && u > 0.22 + 0.1 * v && u < 0.76 - 0.03 * v;
			const legs =
				v >= 0.68 &&
				v < 0.97 &&
				((u > 0.32 && u < 0.46) || (u > 0.54 && u < 0.67));
			if (!head && !body && !legs) continue;
			const offset = (y * width + x) * 4;
			data[offset] = head ? 228 : changedBody ? 36 : 91;
			data[offset + 1] = head ? 184 : changedBody ? 142 : 74;
			data[offset + 2] = head ? 163 : changedBody ? 214 : 119;
			data[offset + 3] = x % 17 === 0 ? 128 : 236;
		}
	return { width, height, data };
}
export async function createInkImage({
	variant,
}: {
	variant?: "changed-body" | "dimensions" | "new-id";
} = {}): Promise<InkImage> {
	const pixels = inkCharacterPixels({
		width: variant === "dimensions" ? 720 : 480,
		height: variant === "dimensions" ? 1200 : 960,
		changedBody: variant === "changed-body",
	});
	const canvas = document.createElement("canvas");
	canvas.width = pixels.width;
	canvas.height = pixels.height;
	try {
		const ctx = canvas.getContext("2d");
		if (!ctx) throw Error("Ink fixture context unavailable");
		ctx.putImageData(
			new ImageData(pixels.data, pixels.width, pixels.height),
			0,
			0,
		);
		const blob = await new Promise<Blob>((resolve, reject) =>
			canvas.toBlob(
				(value) =>
					value ? resolve(value) : reject(Error("Ink PNG encoding failed")),
				"image/png",
			),
		);
		const body = await blob.arrayBuffer();
		return {
			id: variant === "new-id" ? "ink-renamed" : "ink-character",
			mimeType: "image/png",
			byteLength: body.byteLength,
			sha256: await inkDigest(body),
			width: pixels.width,
			height: pixels.height,
			body,
		};
	} finally {
		canvas.width = canvas.height = 1;
	}
}
