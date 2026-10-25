import * as wasm from "opencut-wasm";

export type MediaCropBounds = {
	left: unknown;
	top: unknown;
	right: unknown;
	bottom: unknown;
};
export type MediaCropGeometry = {
	sourceX: number;
	sourceY: number;
	sourceWidth: number;
	sourceHeight: number;
	width: number;
	height: number;
};

function isCropGeometry(value: unknown): value is MediaCropGeometry {
	return (
		!!value &&
		typeof value === "object" &&
		[
			"sourceX",
			"sourceY",
			"sourceWidth",
			"sourceHeight",
			"width",
			"height",
		].every(
			(key) =>
				typeof Reflect.get(value, key) === "number" &&
				Number.isFinite(Reflect.get(value, key)),
		)
	);
}

export function readMediaCropParams({
	params,
}: {
	params: Record<string, unknown>;
}): MediaCropBounds {
	return {
		left: "crop.left" in params ? params["crop.left"] : 0,
		top: "crop.top" in params ? params["crop.top"] : 0,
		right: "crop.right" in params ? params["crop.right"] : 1,
		bottom: "crop.bottom" in params ? params["crop.bottom"] : 1,
	};
}

/** Transport only; normalized bounds and source geometry are owned by Rust. */
export function resolveMediaCrop({
	crop,
	sourceWidth,
	sourceHeight,
	core,
}: {
	crop?: MediaCropBounds;
	sourceWidth: number;
	sourceHeight: number;
	core?: (input: string) => string;
}): MediaCropGeometry | undefined {
	if (
		!crop ||
		(crop.left === 0 && crop.top === 0 && crop.right === 1 && crop.bottom === 1)
	)
		return undefined;
	const candidate: unknown = core ?? Reflect.get(wasm, "resolveMediaCropJson");
	if (typeof candidate !== "function")
		throw new Error(
			"The installed native runtime does not support media source crop",
		);
	const response: unknown = JSON.parse(
		candidate(JSON.stringify({ version: 1, sourceWidth, sourceHeight, crop })),
	);
	if (
		!response ||
		typeof response !== "object" ||
		Reflect.get(response, "version") !== 1
	)
		throw new Error("Invalid native crop response");
	if (Reflect.has(response, "error"))
		throw new Error(
			"Native source crop rejected its bounds or source dimensions",
		);
	const geometry: unknown = Reflect.get(response, "geometry");
	if (!isCropGeometry(geometry))
		throw new Error("Invalid native crop geometry");
	return geometry;
}
