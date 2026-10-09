import {
	materialBoolean,
	materialFail as fail,
	materialInteger,
	materialNumber,
	materialRecord,
	type TextureSnapshot,
} from "./three-particle-material-types";

const UV_MAPPING = 300;
const REPEAT = 1000;
const CLAMP = 1001;
const MIRROR = 1002;
const RGBA_FORMAT = 1023;
const UNSIGNED_BYTE = 1009;

function textureMatrix(texture: Record<string, unknown>): readonly number[] {
	if (!materialBoolean(texture.matrixAutoUpdate, "matrixAutoUpdate")) {
		const elements = materialRecord(texture.matrix).elements;
		if (!Array.isArray(elements) || elements.length !== 9)
			return fail("texture matrix must have 9 elements");
		const matrix = elements.map((value) =>
			materialNumber(value, "texture matrix"),
		);
		if (matrix[2] !== 0 || matrix[5] !== 0 || matrix[8] !== 1)
			fail("texture matrix must be affine");
		return matrix;
	}
	const offset = materialRecord(texture.offset);
	const repeat = materialRecord(texture.repeat);
	const center = materialRecord(texture.center);
	const tx = materialNumber(offset.x, "offset.x");
	const ty = materialNumber(offset.y, "offset.y");
	const sx = materialNumber(repeat.x, "repeat.x");
	const sy = materialNumber(repeat.y, "repeat.y");
	const cx = materialNumber(center.x, "center.x");
	const cy = materialNumber(center.y, "center.y");
	const rotation = materialNumber(texture.rotation, "rotation");
	const c = Math.cos(rotation),
		s = Math.sin(rotation);
	return [
		sx * c,
		-sy * s,
		0,
		sx * s,
		sy * c,
		0,
		-sx * (c * cx + s * cy) + cx + tx,
		-sy * (-s * cx + c * cy) + cy + ty,
		1,
	].map((value) => materialNumber(value, "derived texture matrix"));
}

function isInstance(value: unknown, name: string): boolean {
	const ctor = (globalThis as unknown as Record<string, unknown>)[name];
	return typeof ctor === "function" && value instanceof ctor;
}

/** Browser readback has browser color conversion/alpha precision semantics. */
function browserPixels(
	image: unknown,
	width: number,
	height: number,
): Uint8ClampedArray {
	let canvas: OffscreenCanvas | HTMLCanvasElement;
	if (typeof OffscreenCanvas !== "undefined")
		canvas = new OffscreenCanvas(width, height);
	else if (typeof document !== "undefined") {
		canvas = document.createElement("canvas");
		canvas.width = width;
		canvas.height = height;
	} else return fail("browser image readback requires a 2D canvas");
	try {
		const context = canvas.getContext("2d", {
			colorSpace: "srgb",
			willReadFrequently: true,
		}) as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
		if (!context) return fail("browser image readback has no 2D context");
		context.drawImage(image as CanvasImageSource, 0, 0, width, height);
		const result = context.getImageData(0, 0, width, height, {
			colorSpace: "srgb",
		});
		if (
			!(result.data instanceof Uint8ClampedArray) ||
			result.data.length !== width * height * 4 ||
			result.colorSpace !== "srgb"
		)
			return fail("browser readback must provide sRGB RGBA8 pixels");
		return result.data;
	} catch (cause) {
		throw Error(
			"Three particle materials: browser image readback failed (including tainted canvas)",
			{ cause },
		);
	} finally {
		canvas.width = 0;
		canvas.height = 0;
	}
}

export function snapshotParticleTexture(
	value: unknown,
	maxDimension: number,
	reserve: (bytes: number) => void,
): TextureSnapshot {
	const texture = materialRecord(value);
	if (texture.isTexture !== true) fail("map must be a Three Texture");
	for (const flag of [
		"isVideoTexture",
		"isVideoFrameTexture",
		"isRenderTargetTexture",
		"isCompressedTexture",
		"isCompressedArrayTexture",
		"isCompressedCubeTexture",
		"isDataArrayTexture",
		"isData3DTexture",
		"isCubeTexture",
		"isDepthTexture",
		"isFramebufferTexture",
	])
		if (texture[flag]) fail(`unsupported dynamic or non-2D texture: ${flag}`);
	if (texture.mapping !== UV_MAPPING || texture.channel !== 0)
		fail("only UV0 mapping is supported");
	if (
		texture.format !== RGBA_FORMAT ||
		texture.type !== UNSIGNED_BYTE ||
		texture.internalFormat != null
	)
		fail("only RGBA8 UnsignedByte textures are supported");
	if (texture.premultiplyAlpha !== false)
		fail("premultiplied texture upload is unsupported");
	if (!Array.isArray(texture.mipmaps) || texture.mipmaps.length)
		fail("explicit texture mipmaps are unsupported");
	if (!["", "srgb", "srgb-linear"].includes(texture.colorSpace as string))
		fail("unsupported texture color space");
	const wrapS = materialNumber(texture.wrapS, "wrapS"),
		wrapT = materialNumber(texture.wrapT, "wrapT");
	if (
		![REPEAT, CLAMP, MIRROR].includes(wrapS) ||
		![REPEAT, CLAMP, MIRROR].includes(wrapT)
	)
		fail("unsupported texture wrapping");
	const matrix = textureMatrix(texture);
	const flipY = materialBoolean(texture.flipY, "flipY");
	const image = materialRecord(texture.image);
	let width: number, height: number, pixels: Uint8Array | Uint8ClampedArray;
	if (texture.isDataTexture === true) {
		width = materialInteger(image.width, "texture width", maxDimension);
		height = materialInteger(image.height, "texture height", maxDimension);
		const data = image.data;
		if (
			!(data instanceof Uint8Array || data instanceof Uint8ClampedArray) ||
			data.length !== width * height * 4
		)
			return fail("DataTexture requires exact RGBA8 storage");
		if (
			typeof SharedArrayBuffer !== "undefined" &&
			data.buffer instanceof SharedArrayBuffer
		)
			fail("shared mutable texture buffers are unsupported");
		reserve(data.byteLength);
		pixels = new Uint8Array(data);
	} else {
		const bitmap = isInstance(texture.image, "ImageBitmap");
		const htmlImage = isInstance(texture.image, "HTMLImageElement");
		if (
			!bitmap &&
			!htmlImage &&
			!isInstance(texture.image, "HTMLCanvasElement") &&
			!isInstance(texture.image, "OffscreenCanvas")
		)
			return fail(
				"texture source must be a decoded image, canvas or ImageBitmap",
			);
		if (bitmap && flipY)
			fail("ImageBitmap requires flipY=false; orientation is baked at decode");
		if (htmlImage && image.complete !== true)
			fail("image must already be decoded");
		width = materialInteger(
			htmlImage ? image.naturalWidth : image.width,
			"texture width",
			maxDimension,
		);
		height = materialInteger(
			htmlImage ? image.naturalHeight : image.height,
			"texture height",
			maxDimension,
		);
		// Reserve both temporary canvas backing and retained ImageData before draw/read.
		reserve(width * height * 8);
		pixels = browserPixels(texture.image, width, height);
	}
	return {
		width,
		height,
		pixels,
		matrix,
		wrapS,
		wrapT,
		flipY,
		srgb: texture.colorSpace === "srgb",
	};
}

function wrapped(value: number, mode: number): number {
	if (mode === CLAMP) return Math.min(1, Math.max(0, value));
	const unit = value - Math.floor(value);
	return mode === MIRROR && Math.abs(Math.floor(value) % 2) === 1
		? 1 - unit
		: unit;
}

/** Explicit nearest texel, base level only; no derivatives, filtering or GPU parity. */
export function particleTexturePixel(
	texture: TextureSnapshot,
	uv: readonly [number, number],
): readonly [number, number, number, number] {
	const m = texture.matrix;
	const u = materialNumber(m[0] * uv[0] + m[3] * uv[1] + m[6], "transformed u");
	const v = materialNumber(m[1] * uv[0] + m[4] * uv[1] + m[7], "transformed v");
	const x = Math.min(
		texture.width - 1,
		Math.floor(wrapped(u, texture.wrapS) * texture.width),
	);
	const wrappedV = wrapped(v, texture.wrapT);
	const y = Math.min(
		texture.height - 1,
		Math.floor((texture.flipY ? 1 - wrappedV : wrappedV) * texture.height),
	);
	const offset = (y * texture.width + x) * 4;
	const channel = (index: number) => {
		const c = texture.pixels[offset + index] / 255;
		return texture.srgb && index < 3
			? c <= 0.04045
				? c / 12.92
				: ((c + 0.055) / 1.055) ** 2.4
			: c;
	};
	return [channel(0), channel(1), channel(2), channel(3)];
}
