import type { TitleRiffAsset, TitleRiffFont, TitleRiffImage, TitleRiffEngine } from "./mv-title-riff-reference-contract";
import { TITLE_RIFF_FONTS } from "./mv-title-riff-reference-contract";
import { boundedString, exactKeys } from "./mv-title-riff-reference-input";
import { convergeReferenceDigest } from "./mv-converge-reference-realm";
import { titleRiffFontIdentity } from "./mv-title-riff-reference-font-identity";
import { typeCardFontCoverage } from "./mv-type-card-reference-cmap";

export function snapshotTitleRiffAssets(fonts: readonly TitleRiffFont[], images: readonly TitleRiffImage[]) {
	if (!Array.isArray(fonts) || fonts.length !== 4 || !Array.isArray(images) || !images.length || images.length > 64) throw Error("titleRiff requires all four real fonts and 1–64 explicit images");
	const ids = new Set<string>();
	let total = 0;
	const copy = <T extends TitleRiffAsset>(asset: T, extra: readonly string[]) => {
		exactKeys(asset, ["id", "mimeType", "byteLength", "sha256", "body", ...extra]);
		if (!boundedString(asset.id, 256, false) || ids.has(asset.id) || !(asset.body instanceof ArrayBuffer) ||
			!Number.isInteger(asset.byteLength) || asset.byteLength !== asset.body.byteLength || !asset.byteLength || asset.byteLength > 16 * 1024 * 1024 || !/^[a-f0-9]{64}$/.test(asset.sha256)) throw Error("Invalid complete titleRiff asset identity");
		ids.add(asset.id); total += asset.byteLength;
		if (total > 64 * 1024 * 1024) throw Error("titleRiff encoded asset budget exceeded");
		return { ...asset, body: asset.body.slice(0) };
	};
	const faces = new Set<string>();
	const copiedFonts = fonts.map((f) => {
		const font = copy(f, ["family", "weight"]), key = `${font.family}|${font.weight}`;
		if (!TITLE_RIFF_FONTS.some((f) => f.family === font.family && f.weight === font.weight) || faces.has(key) || !["font/ttf", "font/otf"].includes(font.mimeType)) throw Error("Missing or duplicate exact titleRiff font role");
		faces.add(key);
		return { ...font, identity: titleRiffFontIdentity(font.body, font.family, font.weight), coverage: typeCardFontCoverage(font.body) };
	});
	const copiedImages = images.map((i) => {
		const image = copy(i, ["width", "height", "hasTransparency"]);
		if (!["image/png", "image/jpeg", "image/webp"].includes(image.mimeType) ||
			![image.width, image.height].every((n) => Number.isInteger(n) && n > 0 && n <= 8192) || typeof image.hasTransparency !== "boolean") throw Error("Invalid titleRiff image geometry/alpha declaration");
		return image;
	});
	return { fonts: copiedFonts, images: copiedImages };
}

export async function verifyTitleRiffAssetHashes(assets: ReturnType<typeof snapshotTitleRiffAssets>) {
	for (const a of [...assets.fonts, ...assets.images]) if (await convergeReferenceDigest(a.body) !== a.sha256) throw Error(`titleRiff asset byte identity mismatch: ${a.id}`);
}

export async function loadTitleRiffImages(realm: Window & typeof globalThis, engine: TitleRiffEngine,
	images: readonly TitleRiffImage[], owned: Set<ImageBitmap>) {
	let decodedBytes = 0;
	const proof = [];
	for (const a of images) {
		const image = await realm.createImageBitmap(new realm.Blob([a.body], { type: a.mimeType }), { premultiplyAlpha: "default", colorSpaceConversion: "none" });
		owned.add(image); decodedBytes += image.width * image.height * 4;
		if (image.width !== a.width || image.height !== a.height || decodedBytes > 128 * 1024 * 1024) throw Error("titleRiff decoded image dimensions/budget mismatch");
		const canvas = engine.canvas(image.width, image.height), ctx = canvas.getContext("2d", { willReadFrequently: true });
		if (!ctx) throw Error("titleRiff image alpha verification needs Canvas2D");
		try {
			ctx.drawImage(image, 0, 0);
			const rgba = ctx.getImageData(0, 0, image.width, image.height).data;
			let transparent = 0, partial = 0;
			for (let i = 3; i < rgba.length; i += 4) { if (rgba[i]! < 255) transparent++; if (rgba[i]! > 0 && rgba[i]! < 255) partial++; }
			if ((transparent > 0) !== a.hasTransparency) throw Error(`titleRiff decoded alpha mismatch: ${a.id}`);
			proof.push({ id: a.id, sha256: a.sha256, byteLength: a.byteLength, mimeType: a.mimeType, width: image.width, height: image.height, transparentPixels: transparent, partialAlphaPixels: partial });
		} finally { canvas.width = canvas.height = 1; }
		engine.loaded.set(a.id, image);
	}
	return proof;
}
