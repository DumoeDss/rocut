import {
	KANJI_SLAM_FONTS,
	type KanjiSlamAsset,
	type KanjiSlamEngine,
	type KanjiSlamFont,
	type KanjiSlamFrame,
	type KanjiSlamImage,
} from "./mv-kanji-slam-reference-contract";
import { kanjiId, kanjiKeys } from "./mv-kanji-slam-reference-input";
import { kanjiDigest } from "./mv-kanji-slam-reference-realm";
import { titleRiffFontIdentity } from "./mv-title-riff-reference-font-identity";
import { typeCardFontCoverage } from "./mv-type-card-reference-cmap";

export function snapshotKanjiAssets(
	fonts: readonly KanjiSlamFont[],
	images: readonly KanjiSlamImage[],
) {
	if (
		!Array.isArray(fonts) ||
		fonts.length !== 3 ||
		!Array.isArray(images) ||
		!images.length ||
		images.length > 32
	)
		throw Error(
			"kanjiSlam requires three exact real font faces and 1–32 declared images",
		);
	const ids = new Set<string>();
	let total = 0;
	const copy = <T extends KanjiSlamAsset>(
		asset: T,
		extra: readonly string[],
	) => {
		kanjiKeys(asset, [
			"id",
			"mimeType",
			"byteLength",
			"sha256",
			"body",
			...extra,
		]);
		if (
			!kanjiId(asset.id) ||
			ids.has(asset.id) ||
			!(asset.body instanceof ArrayBuffer) ||
			!Number.isInteger(asset.byteLength) ||
			asset.byteLength !== asset.body.byteLength ||
			!asset.byteLength ||
			asset.byteLength > 16 * 1024 * 1024 ||
			!/^[a-f0-9]{64}$/.test(asset.sha256)
		)
			throw Error("Invalid kanjiSlam asset byte identity");
		ids.add(asset.id);
		total += asset.byteLength;
		if (total > 64 * 1024 * 1024)
			throw Error("kanjiSlam encoded asset budget exceeded");
		return { ...asset, body: asset.body.slice(0) };
	};
	const roles = new Set<string>();
	const copiedFonts = fonts.map((value) => {
		const font = copy(value, ["family", "weight"]),
			key = `${font.family}|${font.weight}`;
		if (
			!KANJI_SLAM_FONTS.some(
				(f) => f.family === font.family && f.weight === font.weight,
			) ||
			roles.has(key) ||
			!["font/ttf", "font/otf"].includes(font.mimeType)
		)
			throw Error("Missing or duplicate exact kanjiSlam face");
		roles.add(key);
		return {
			...font,
			identity: titleRiffFontIdentity(font.body, font.family, font.weight),
			coverage: typeCardFontCoverage(font.body),
		};
	});
	const copiedImages = images.map((value) => {
		const image = copy(value, ["width", "height", "hasTransparency"]);
		if (
			!["image/png", "image/jpeg", "image/webp"].includes(image.mimeType) ||
			typeof image.hasTransparency !== "boolean" ||
			![image.width, image.height].every(
				(n) => Number.isInteger(n) && n > 0 && n <= 8192,
			)
		)
			throw Error("Invalid kanjiSlam image geometry/alpha");
		return image;
	});
	return { fonts: copiedFonts, images: copiedImages };
}

export async function verifyKanjiAssets(
	assets: ReturnType<typeof snapshotKanjiAssets>,
) {
	for (const asset of [...assets.fonts, ...assets.images])
		if ((await kanjiDigest(asset.body)) !== asset.sha256)
			throw Error(`kanjiSlam asset byte identity mismatch: ${asset.id}`);
}

export async function loadKanjiFonts(
	realm: Window & typeof globalThis,
	engine: KanjiSlamEngine,
	fonts: ReturnType<typeof snapshotKanjiAssets>["fonts"],
) {
	for (const role of KANJI_SLAM_FONTS)
		if (engine.FONT[role.alias]?.replace(/^"(.*)"$/, "$1") !== role.family)
			throw Error(`Original kanjiSlam font alias changed: ${role.alias}`);
	const loaded = await Promise.all(
		fonts.map(async (font) => {
			const face = new realm.FontFace(font.family, font.body, {
				style: "normal",
				weight: String(font.weight),
			});
			await face.load();
			realm.document.fonts.add(face);
			if (face.status !== "loaded" || !realm.document.fonts.has(face))
				throw Error(`Failed actual kanjiSlam face: ${font.id}`);
			return { ...font, face };
		}),
	);
	return async (frame: KanjiSlamFrame) =>
		Promise.all(
			loaded.map(async (font) => {
				const text =
					font.family === "DotGothic16"
						? "0123456789 /"
						: frame.args.glyphs.join("");
				const glyphs = font.coverage(text),
					spec = `${font.weight} 100px "${font.family}"`;
				if (
					!(await realm.document.fonts.load(spec, text)).includes(font.face) ||
					!realm.document.fonts.check(spec, text)
				)
					throw Error(`Exact kanjiSlam face unavailable: ${font.family}`);
				return {
					id: font.id,
					family: font.family,
					weight: font.weight,
					sha256: font.sha256,
					identity: font.identity,
					text,
					glyphs,
				};
			}),
		);
}

export async function loadKanjiImages(
	realm: Window & typeof globalThis,
	engine: KanjiSlamEngine,
	images: readonly KanjiSlamImage[],
	owned: Set<ImageBitmap>,
) {
	let decodedBytes = 0;
	const proof = [];
	for (const value of images) {
		const image = await realm.createImageBitmap(
			new realm.Blob([value.body], { type: value.mimeType }),
			{ premultiplyAlpha: "default", colorSpaceConversion: "none" },
		);
		owned.add(image);
		decodedBytes += image.width * image.height * 4;
		if (
			image.width !== value.width ||
			image.height !== value.height ||
			decodedBytes > 128 * 1024 * 1024
		)
			throw Error("kanjiSlam decoded image dimensions/budget mismatch");
		const canvas = engine.canvas(image.width, image.height),
			ctx = canvas.getContext("2d", { willReadFrequently: true });
		if (!ctx) throw Error("kanjiSlam needs image alpha validation");
		try {
			ctx.drawImage(image, 0, 0);
			const data = ctx.getImageData(0, 0, image.width, image.height).data;
			let transparent = 0,
				partial = 0;
			for (let i = 3; i < data.length; i += 4) {
				if (data[i]! < 255) transparent++;
				if (data[i]! > 0 && data[i]! < 255) partial++;
			}
			if (transparent > 0 !== value.hasTransparency)
				throw Error(`kanjiSlam decoded alpha mismatch: ${value.id}`);
			proof.push({
				id: value.id,
				sha256: value.sha256,
				width: image.width,
				height: image.height,
				transparentPixels: transparent,
				partialAlphaPixels: partial,
			});
		} finally {
			canvas.width = canvas.height = 1;
		}
		engine.loaded.set(value.id, image);
	}
	return proof;
}
