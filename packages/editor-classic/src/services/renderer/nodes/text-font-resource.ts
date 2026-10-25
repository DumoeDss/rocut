import {
	assetId,
	isProgrammaticResource,
	motionTextFontId,
	type MotionTextFontAssetRef,
} from "@opencut/editor-contracts";

/** A pinned text face is stored with the clip, while its bytes remain a project attachment. */
export function pinnedTextFont(
	value: unknown,
): MotionTextFontAssetRef | undefined {
	if (value === undefined || value === "") return undefined;
	if (typeof value !== "string" || value.length > 4096)
		throw Error("Invalid pinned text font descriptor");
	const descriptor: unknown = JSON.parse(value);
	if (
		!isProgrammaticResource(descriptor) ||
		descriptor.kind !== "font" ||
		!descriptor.font ||
		!/^[a-f0-9]{64}$/.test(descriptor.sha256) ||
		descriptor.attachmentKey !== `programmatic-sha256-${descriptor.sha256}` ||
		!Number.isSafeInteger(descriptor.byteLength) ||
		descriptor.byteLength <= 0 ||
		descriptor.byteLength > 64 * 1024 * 1024 ||
		!["font/ttf", "font/otf"].includes(descriptor.mimeType) ||
		!descriptor.font.family ||
		descriptor.font.weight < 1 ||
		descriptor.font.weight > 1000 ||
		descriptor.font.axes
	)
		throw Error("Invalid pinned text font resource");
	return {
		id: motionTextFontId(descriptor.id),
		source: "project",
		assetId: assetId(descriptor.attachmentKey),
		contentDigest: descriptor.sha256,
		family: descriptor.font.family,
		style: descriptor.font.style,
		weight: descriptor.font.weight,
	};
}
