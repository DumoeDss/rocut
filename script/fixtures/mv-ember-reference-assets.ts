import type {
	EmberOriginalEngine,
	EmberReferenceAsset,
} from "./mv-ember-reference-contract";
import { convergeReferenceDigest } from "./mv-converge-reference-realm";

export function snapshotEmberAsset(
	asset: EmberReferenceAsset,
): EmberReferenceAsset {
	if (
		!(asset.body instanceof ArrayBuffer) ||
		!asset.body.byteLength ||
		asset.body.byteLength > 16 * 1024 * 1024 ||
		!asset.id ||
		!/^[a-f0-9]{64}$/.test(asset.sha256)
	)
		throw Error("Ember oracle requires bounded identified asset bytes");
	return { ...asset, body: asset.body.slice(0) };
}

export async function loadEmberAssets({
	realm,
	engine,
	font,
	images,
	owned,
}: {
	realm: Window & typeof globalThis;
	engine: EmberOriginalEngine;
	font?: EmberReferenceAsset;
	images: readonly EmberReferenceAsset[];
	owned: Set<ImageBitmap>;
}) {
	const ids = new Set<string>();
	let decodedBytes = 0;
	for (const asset of [...(font ? [font] : []), ...images]) {
		if (
			ids.has(asset.id) ||
			(await convergeReferenceDigest(asset.body)) !== asset.sha256
		)
			throw Error("Ember oracle asset identity mismatch");
		ids.add(asset.id);
	}
	if (font) {
		if (
			!["font/ttf", "font/otf", "font/woff", "font/woff2"].includes(
				font.mimeType,
			)
		)
			throw Error("Ember HUD requires actual DotGothic16 400 font bytes");
		const face = new realm.FontFace("DotGothic16", font.body, {
			weight: "400",
			style: "normal",
		});
		await face.load();
		realm.document.fonts.add(face);
	}
	for (const asset of images) {
		if (!["image/png", "image/jpeg", "image/webp"].includes(asset.mimeType))
			throw Error("Unsupported Ember oracle image");
		// The exact decode options from original core/assets.js. Inject only the
		// decoded fixture into its public loaded map; do not replace imgSync/draw.
		const bitmap = await realm.createImageBitmap(
			new realm.Blob([asset.body], { type: asset.mimeType }),
			{
				premultiplyAlpha: "default",
				colorSpaceConversion: "none",
			},
		);
		owned.add(bitmap);
		decodedBytes += bitmap.width * bitmap.height * 4;
		if (
			!bitmap.width ||
			!bitmap.height ||
			bitmap.width > 8192 ||
			bitmap.height > 8192 ||
			decodedBytes > 128 * 1024 * 1024
		)
			throw Error("Ember oracle decoded image budget exceeded");
		engine.loaded.set(asset.id, bitmap);
	}
}
