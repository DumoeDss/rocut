import type {
	ProgrammaticResource,
	ResolvedProgrammaticResource,
} from "@opencut/editor-contracts";

export const generatorHash = async (data: ArrayBuffer) =>
	[...new Uint8Array(await crypto.subtle.digest("SHA-256", data))]
		.map((b) => b.toString(16).padStart(2, "0"))
		.join("");
export function generatorPixels(
	image: CanvasImageSource,
	width: number,
	height: number,
) {
	const ctx = new OffscreenCanvas(width, height).getContext("2d")!;
	ctx.drawImage(image, 0, 0);
	return ctx.getImageData(0, 0, width, height).data;
}
export function assertGenerator(
	value: unknown,
	message: string,
): asserts value {
	if (!value) throw Error(message);
}

/** Exclude empty background, so a missing layer cannot pass on whole-frame MAE alone. */
export function generatorDetail(
	actual: Uint8ClampedArray,
	expected: Uint8ClampedArray,
) {
	const background = [16, 32, 48];
	let pixels = 0,
		error = 0,
		expectedContrast = 0,
		actualContrast = 0;
	for (let p = 0; p < expected.length; p += 4) {
		let e = 0,
			a = 0;
		for (let c = 0; c < 3; c++) {
			e += Math.abs(expected[p + c] - background[c]);
			a += Math.abs(actual[p + c] - background[c]);
		}
		if (e <= 45) continue;
		pixels++;
		expectedContrast += e;
		actualContrast += a;
		for (let c = 0; c < 3; c++)
			error += Math.abs(expected[p + c] - actual[p + c]);
	}
	return {
		pixels,
		error: error / (pixels * 3),
		contrastRatio: actualContrast / expectedContrast,
	};
}

export async function generatorAssets() {
	const fontResponse = await fetch(
		"/apps/web/public/motion-text/fonts/ibm-plex-mono-medium.ttf",
	);
	assertGenerator(fontResponse.ok, "Fixture font unavailable");
	const fontBody = await fontResponse.arrayBuffer();
	const image = new OffscreenCanvas(64, 48),
		ctx = image.getContext("2d")!;
	for (let y = 4; y < 44; y += 4)
		for (let x = 4; x < 60; x += 4) {
			ctx.fillStyle =
				(x + y) % 8 ? "rgba(255,50,30,0.5)" : "rgba(20,170,250,0.8)";
			ctx.fillRect(x, y, 4, 4);
		}
	ctx.fillStyle = "#ffff00";
	ctx.fillRect(4, 4, 8, 8);
	const imageBody = await (
		await image.convertToBlob({ type: "image/png" })
	).arrayBuffer();
	const item = async (
		body: ArrayBuffer,
		fields: Pick<ProgrammaticResource, "id" | "kind" | "mimeType" | "font">,
	): Promise<ResolvedProgrammaticResource> => {
		const sha256 = await generatorHash(body);
		return {
			body,
			resource: {
				...fields,
				byteLength: body.byteLength,
				sha256,
				attachmentKey: `programmatic-sha256-${sha256}`,
			},
		};
	};
	const resources = [
		await item(fontBody, {
			id: "rain.ttf",
			kind: "font",
			mimeType: "font/ttf",
			font: { family: "RocutGeneratorFixture", weight: 500, style: "normal" },
		}),
		await item(imageBody, {
			id: "logo.png",
			kind: "image",
			mimeType: "image/png",
		}),
	];
	return { resources, image };
}
