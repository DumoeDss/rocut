import type { ProgrammaticResource } from "@opencut/editor-contracts";
import type {
	MvMemoriesPlan,
	MvMemoriesRaster,
	MvMemoriesFontMeasurementRequest,
} from "./mv-memories-owner-protocol";
import { rasterKey, digest } from "./mv-memories-owner-protocol";
type Context = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
type Surface = HTMLCanvasElement | OffscreenCanvas;
export interface MemoriesAssets {
	descriptor(id: string): ProgrammaticResource;
	image(id: string): ImageBitmap;
	memoriesRaster(r: MvMemoriesRaster): ImageBitmap;
	memoriesPixels(r: MvMemoriesRaster): ImageData;
}
/** Root passes the fixed production MV_MEMORIES_RENDERER_SOURCE functions.
 * Never supplied by authored scene JSON; no eval or fixture import here. */
export interface MemoriesReplay {
	draw(
		ctx: Context,
		plan: MvMemoriesPlan,
		assets: MemoriesAssets,
		make: (w: number, h: number) => Surface,
	): void;
	measure(
		ctx: Context,
		requests: readonly MvMemoriesFontMeasurementRequest[],
		assets: MemoriesAssets,
	): {
		font: string;
		fontSize: number;
		weight: number;
		widths: Record<string, number>;
	}[];
}
export function createMemoriesNativePlatform({
	replay,
	makeSurface,
	fontSet,
}: {
	replay: MemoriesReplay;
	makeSurface: (w: number, h: number) => Surface;
	fontSet: FontFaceSet;
}) {
	const descriptors = new Map<string, ProgrammaticResource>(),
		images = new Map<string, ImageBitmap>();
	const rasters = new Map<string, { bitmap: ImageBitmap; pixels: ImageData }>(),
		faces: FontFace[] = [];
	let disposed = false;
	const check = () => {
		if (disposed) throw Error("Memories native platform disposed");
	};
	const retainBitmap = (bitmap: ImageBitmap) => {
		if (disposed) bitmap.close();
		check();
		return bitmap;
	};
	const make = (...[w, h]: [number, number]) => {
		check();
		const s = makeSurface(w, h);
		if (s.width !== w || s.height !== h)
			throw Error("Memories native surface dimensions mismatch");
		return s;
	};
	const context = (s: Surface) => {
		const c = s.getContext("2d", {
			colorSpace: "srgb",
			willReadFrequently: true,
		}) as Context | null;
		if (!c) throw Error("Memories native Canvas2D unavailable");
		return c;
	};
	const assets: MemoriesAssets = {
		descriptor(id) {
			const d = descriptors.get(id);
			if (!d) throw Error("Memories undeclared native descriptor");
			return d;
		},
		image(id) {
			const image = images.get(id);
			if (!image) throw Error("Memories missing native image");
			return image;
		},
		memoriesRaster(r) {
			const value = rasters.get(rasterKey(r));
			if (!value) throw Error("Memories unknown raster binding");
			return value.bitmap;
		},
		memoriesPixels(r) {
			const value = rasters.get(rasterKey(r));
			if (!value) throw Error("Memories unknown RGBA binding");
			return value.pixels;
		},
	};
	return {
		assets,
		async image({
			resource,
			bytes,
			width,
			height,
		}: {
			resource: ProgrammaticResource;
			bytes: Uint8Array;
			width: number;
			height: number;
		}) {
			check();
			if (!(bytes.buffer instanceof ArrayBuffer))
				throw Error("Memories encoded native buffer mismatch");
			const bitmap = retainBitmap(
				await createImageBitmap(
					new Blob(
						[new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength)],
						{
							type: resource.mimeType,
						},
					),
					{ premultiplyAlpha: "default", colorSpaceConversion: "none" },
				),
			);
			if (bitmap.width !== width || bitmap.height !== height) {
				bitmap.close();
				throw Error("Memories decoded native dimensions mismatch");
			}
			let s: Surface | undefined;
			try {
				s = make(width, height);
				const ctx = context(s);
				ctx.drawImage(bitmap, 0, 0);
				const rgba = new Uint8Array(
					ctx.getImageData(0, 0, width, height).data.buffer,
				);
				images.set(resource.id, bitmap);
				descriptors.set(resource.id, resource);
				return rgba;
			} catch (error) {
				bitmap.close();
				throw error;
			} finally {
				if (s) s.width = s.height = 1;
			}
		},
		async font({
			resource,
			bytes,
		}: {
			resource: ProgrammaticResource;
			bytes: Uint8Array;
		}) {
			check();
			if (
				resource.kind !== "font" ||
				!resource.font ||
				!(bytes.buffer instanceof ArrayBuffer)
			)
				throw Error("Memories native font descriptor missing");
			const font = resource.font,
				alias = `mv-memories-${resource.sha256}-${font.weight}`;
			const face = new FontFace(
				alias,
				new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength),
				{
					weight: String(font.weight),
					style: font.style,
					variationSettings:
						Object.entries(font.axes ?? {})
							.map(([k, v]) => `"${k}" ${v}`)
							.join(",") || "normal",
				},
			);
			await face.load();
			check();
			fontSet.add(face);
			faces.push(face);
			descriptors.set(resource.id, {
				...resource,
				font: { ...font, family: alias },
			});
		},
		measure(requests: readonly MvMemoriesFontMeasurementRequest[]) {
			const s = make(1, 1);
			try {
				return replay.measure(context(s), requests, assets);
			} finally {
				s.width = s.height = 1;
			}
		},
		async upload({ r, bytes }: { r: MvMemoriesRaster; bytes: Uint8Array }) {
			check();
			if (
				bytes.byteLength !== r.width * r.height * 4 ||
				(await digest(bytes)) !== r.rgbaSha256
			)
				throw Error("Memories upload actual RGBA digest/dimensions mismatch");
			check();
			if (!(bytes.buffer instanceof ArrayBuffer))
				throw Error("Memories upload must be private");
			const pixels = new ImageData(
				new Uint8ClampedArray(bytes.buffer, bytes.byteOffset, bytes.byteLength),
				r.width,
				r.height,
				{ colorSpace: "srgb" },
			);
			const bitmap = retainBitmap(await createImageBitmap(pixels));
			if (bitmap.width !== r.width || bitmap.height !== r.height) {
				bitmap.close();
				throw Error("Memories native upload dimensions mismatch");
			}
			const key = rasterKey(r);
			if (rasters.has(key)) {
				bitmap.close();
				throw Error("Memories repeated raster upload");
			}
			rasters.set(key, { bitmap, pixels });
		},
		release(r: MvMemoriesRaster) {
			const key = rasterKey(r),
				v = rasters.get(key);
			v?.bitmap.close();
			rasters.delete(key);
		},
		readback({
			plan,
			size,
		}: {
			plan: MvMemoriesPlan;
			size: readonly [number, number];
		}) {
			const s = make(...size);
			try {
				const ctx = context(s);
				replay.draw(ctx, plan, assets, make);
				return new Uint8Array(ctx.getImageData(0, 0, ...size).data.buffer);
			} finally {
				s.width = s.height = 1;
			}
		},
		draw({ ctx, plan }: { ctx: Context; plan: MvMemoriesPlan }) {
			check();
			if (ctx.canvas.width !== 1920 || ctx.canvas.height !== 1080)
				throw Error("Memories main canvas dimensions mismatch");
			replay.draw(ctx, plan, assets, make);
		},
		dispose() {
			disposed = true;
			for (const v of images.values()) v.close();
			images.clear();
			for (const v of rasters.values()) v.bitmap.close();
			rasters.clear();
			for (const face of faces) fontSet.delete(face);
			faces.length = 0;
			descriptors.clear();
		},
	};
}
export type MemoriesNativePlatform = ReturnType<
	typeof createMemoriesNativePlatform
>;
