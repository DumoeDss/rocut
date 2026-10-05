import type { MotionTextSequence } from "@opencut/editor-contracts";

import { signedRandom, unitRandom } from "./deterministic-random";
import type { MotionTextCanvasContext, MotionTextRenderFrame } from "./types";

const TICKS_PER_SECOND = 90_000;

type ScratchCanvas = HTMLCanvasElement | OffscreenCanvas;

interface PixelContext extends MotionTextCanvasContext {
	readonly canvas: ScratchCanvas;
	globalCompositeOperation: GlobalCompositeOperation;
	imageSmoothingEnabled: boolean;
	clearRect(x: number, y: number, width: number, height: number): void;
	drawImage(image: CanvasImageSource, dx: number, dy: number): void;
	drawImage(
		image: CanvasImageSource,
		dx: number,
		dy: number,
		dWidth: number,
		dHeight: number,
	): void;
	drawImage(
		image: CanvasImageSource,
		sx: number,
		sy: number,
		sWidth: number,
		sHeight: number,
		dx: number,
		dy: number,
		dWidth: number,
		dHeight: number,
	): void;
}

interface ScratchSurfaces {
	readonly source: ScratchCanvas;
	readonly sourceContext: PixelContext;
	readonly work: ScratchCanvas;
	readonly workContext: PixelContext;
	readonly tiny: ScratchCanvas;
	readonly tinyContext: PixelContext;
}

interface CoreScreenEffectDraw {
	readonly compositionMode: MotionTextSequence["compositionMode"];
	readonly ctx: MotionTextCanvasContext;
	readonly effect: string;
	readonly effectIndex: number;
	readonly frame: MotionTextRenderFrame;
	readonly height: number;
	readonly width: number;
}

const CORE_SCREEN_EFFECTS = new Set([
	"block",
	"chroma",
	"flash",
	"invert",
	"mosaic",
	"shake",
	"slice",
	"zoom",
]);

const scratchByCanvas = new WeakMap<object, ScratchSurfaces>();

export function drawCoreScreenEffect(options: CoreScreenEffectDraw): boolean {
	if (!CORE_SCREEN_EFFECTS.has(options.effect)) return false;
	// Shake is composed into the content transform in runtime.ts. Treating it as
	// a post effect would move an opaque scene background and expose clear edges.
	if (options.effect === "shake") return true;
	if (!isPixelContext(options.ctx)) {
		drawFallbackSignature(options);
		return true;
	}
	const pixelContext = options.ctx;
	const surfaces = scratchSurfaces({
		ctx: pixelContext,
		height: options.height,
		width: options.width,
	});
	if (!surfaces) {
		drawFallbackSignature(options);
		return true;
	}
	capture({ ...options, ctx: pixelContext, surfaces });
	const pulse = effectPulse({
		effectIndex: options.effectIndex,
		localTime: options.frame.localTime,
	});
	switch (options.effect) {
		case "chroma":
			drawChroma({ ...options, ctx: pixelContext, pulse, surfaces });
			break;
		case "slice":
			drawSlice({ ...options, ctx: pixelContext, pulse, surfaces });
			break;
		case "block":
			drawBlock({ ...options, ctx: pixelContext, pulse, surfaces });
			break;
		case "invert":
			drawInvert({ ...options, ctx: pixelContext, pulse, surfaces });
			break;
		case "flash":
			drawFlash({ ...options, ctx: pixelContext, pulse, surfaces });
			break;
		case "zoom":
			drawZoom({ ...options, ctx: pixelContext, pulse, surfaces });
			break;
		case "mosaic":
			drawMosaic({ ...options, ctx: pixelContext, pulse, surfaces });
			break;
	}
	return true;
}

export function resolveCoreShake({
	cut,
	localTime,
}: {
	readonly cut: MotionTextRenderFrame["cut"];
	readonly localTime: number;
}): { readonly translateX: number; readonly translateY: number } | null {
	if (!cut) return null;
	const effectIndex = cut.preset.fx.indexOf("shake");
	if (effectIndex < 0) return null;
	const pulse = effectPulse({ effectIndex, localTime });
	const step = Math.floor(localTime / (TICKS_PER_SECOND / 24));
	return {
		translateX:
			signedRandom({ seed: cut.seed, salt: 31_001 + step * 2 }) * 0.016 * pulse,
		translateY:
			signedRandom({ seed: cut.seed, salt: 31_002 + step * 2 }) * 0.011 * pulse,
	};
}

function drawChroma(
	options: CoreScreenEffectDraw & {
		readonly ctx: PixelContext;
		readonly pulse: number;
		readonly surfaces: ScratchSurfaces;
	},
): void {
	const unit = Math.min(options.width, options.height);
	const offset = unit * (0.004 + options.pulse * 0.016);
	const baseAlpha = options.ctx.globalAlpha;
	options.ctx.save();
	options.ctx.globalCompositeOperation = "screen";
	options.ctx.globalAlpha = baseAlpha * (0.18 + options.pulse * 0.34);
	tintSurface({
		color: options.frame.palette.accent,
		height: options.height,
		surfaces: options.surfaces,
		width: options.width,
	});
	options.ctx.drawImage(options.surfaces.work, offset, -offset * 0.35);
	tintSurface({
		color: options.frame.palette.secondary,
		height: options.height,
		surfaces: options.surfaces,
		width: options.width,
	});
	options.ctx.drawImage(options.surfaces.work, -offset, offset * 0.45);
	options.ctx.restore();
}

function drawSlice(
	options: CoreScreenEffectDraw & {
		readonly ctx: PixelContext;
		readonly pulse: number;
		readonly surfaces: ScratchSurfaces;
	},
): void {
	const cut = options.frame.cut;
	if (!cut) return;
	const step = Math.floor(options.frame.localTime / (TICKS_PER_SECOND / 24));
	const bands =
		7 + Math.floor(unitRandom({ seed: cut.seed, salt: step + 32_001 }) * 5);
	const bandHeight = options.height / bands;
	options.ctx.save();
	options.ctx.globalAlpha = 0.45 + options.pulse * 0.5;
	for (let index = 0; index < bands; index += 1) {
		const y = Math.floor(index * bandHeight);
		const height = Math.ceil((index + 1) * bandHeight) - y;
		const offset =
			signedRandom({ seed: cut.seed, salt: step * 97 + index + 32_100 }) *
			options.width *
			0.075 *
			options.pulse;
		if (Math.abs(offset) < 0.5) continue;
		options.ctx.drawImage(
			options.surfaces.source,
			0,
			y,
			options.width,
			height,
			offset,
			y,
			options.width,
			height,
		);
	}
	options.ctx.restore();
}

function drawBlock(
	options: CoreScreenEffectDraw & {
		readonly ctx: PixelContext;
		readonly pulse: number;
		readonly surfaces: ScratchSurfaces;
	},
): void {
	const cut = options.frame.cut;
	if (!cut) return;
	const step = Math.floor(options.frame.localTime / (TICKS_PER_SECOND / 24));
	options.ctx.save();
	options.ctx.globalAlpha = 0.42 + options.pulse * 0.52;
	for (let index = 0; index < 10; index += 1) {
		const salt = step * 131 + index * 13 + 33_000;
		const width =
			options.width * (0.05 + unitRandom({ seed: cut.seed, salt }) * 0.23);
		const height =
			options.height *
			(0.018 + unitRandom({ seed: cut.seed, salt: salt + 1 }) * 0.075);
		const x =
			unitRandom({ seed: cut.seed, salt: salt + 2 }) * (options.width - width);
		const y =
			unitRandom({ seed: cut.seed, salt: salt + 3 }) *
			(options.height - height);
		const dx =
			signedRandom({ seed: cut.seed, salt: salt + 4 }) *
			options.width *
			0.09 *
			options.pulse;
		const dy =
			signedRandom({ seed: cut.seed, salt: salt + 5 }) *
			options.height *
			0.045 *
			options.pulse;
		options.ctx.drawImage(
			options.surfaces.source,
			x,
			y,
			width,
			height,
			x + dx,
			y + dy,
			width,
			height,
		);
	}
	options.ctx.restore();
}

function drawInvert(
	options: CoreScreenEffectDraw & {
		readonly ctx: PixelContext;
		readonly pulse: number;
		readonly surfaces: ScratchSurfaces;
	},
): void {
	options.ctx.save();
	options.ctx.globalCompositeOperation = "difference";
	options.ctx.globalAlpha = 0.35 + options.pulse * 0.65;
	options.ctx.fillStyle = "#ffffff";
	options.ctx.fillRect(0, 0, options.width, options.height);
	options.ctx.globalCompositeOperation = "destination-in";
	options.ctx.globalAlpha = 1;
	options.ctx.drawImage(options.surfaces.source, 0, 0);
	options.ctx.restore();
}

function drawFlash(
	options: CoreScreenEffectDraw & {
		readonly ctx: PixelContext;
		readonly pulse: number;
		readonly surfaces: ScratchSurfaces;
	},
): void {
	tintSurface({
		color: options.frame.palette.foreground,
		height: options.height,
		surfaces: options.surfaces,
		width: options.width,
	});
	options.ctx.save();
	options.ctx.globalAlpha = 0.18 + options.pulse * 0.72;
	options.ctx.drawImage(options.surfaces.work, 0, 0);
	options.ctx.restore();
}

function drawZoom(
	options: CoreScreenEffectDraw & {
		readonly ctx: PixelContext;
		readonly pulse: number;
		readonly surfaces: ScratchSurfaces;
	},
): void {
	options.ctx.save();
	for (let index = 1; index <= 6; index += 1) {
		const scale = 1 + index * 0.018 * options.pulse;
		const width = options.width * scale;
		const height = options.height * scale;
		options.ctx.globalAlpha =
			0.16 * (1 - index / 7) * (0.3 + options.pulse * 0.7);
		options.ctx.drawImage(
			options.surfaces.source,
			(options.width - width) / 2,
			(options.height - height) / 2,
			width,
			height,
		);
	}
	options.ctx.restore();
}

function drawMosaic(
	options: CoreScreenEffectDraw & {
		readonly ctx: PixelContext;
		readonly pulse: number;
		readonly surfaces: ScratchSurfaces;
	},
): void {
	const columns = Math.max(10, Math.round(options.width / 42));
	const rows = Math.max(8, Math.round(options.height / 42));
	resizeCanvas({
		canvas: options.surfaces.tiny,
		height: rows,
		width: columns,
	});
	options.surfaces.tinyContext.save();
	options.surfaces.tinyContext.setTransform(1, 0, 0, 1, 0, 0);
	options.surfaces.tinyContext.clearRect(0, 0, columns, rows);
	options.surfaces.tinyContext.imageSmoothingEnabled = true;
	options.surfaces.tinyContext.drawImage(
		options.surfaces.source,
		0,
		0,
		columns,
		rows,
	);
	options.surfaces.tinyContext.restore();
	options.ctx.save();
	options.ctx.imageSmoothingEnabled = false;
	options.ctx.globalAlpha = 0.28 + options.pulse * 0.62;
	options.ctx.drawImage(
		options.surfaces.tiny,
		0,
		0,
		options.width,
		options.height,
	);
	options.ctx.restore();
}

function drawFallbackSignature(options: CoreScreenEffectDraw): void {
	const cut = options.frame.cut;
	if (!cut) return;
	const pulse = effectPulse({
		effectIndex: options.effectIndex,
		localTime: options.frame.localTime,
	});
	const step = Math.floor(options.frame.localTime / (TICKS_PER_SECOND / 24));
	const unit = Math.min(options.width, options.height);
	const baseAlpha = options.ctx.globalAlpha;
	options.ctx.save();
	options.ctx.globalAlpha = baseAlpha * (0.18 + pulse * 0.54);
	options.ctx.fillStyle = options.frame.palette.accent;
	const marker = CORE_EFFECT_MARKERS[options.effect] ?? 0;
	for (let index = 0; index < marker + 1; index += 1) {
		const x =
			unitRandom({ seed: cut.seed, salt: step * 41 + marker * 101 + index }) *
			options.width *
			0.84;
		const y =
			unitRandom({ seed: cut.seed, salt: step * 43 + marker * 103 + index }) *
			options.height *
			0.84;
		options.ctx.fillRect(
			x,
			y,
			unit * (0.015 + marker * 0.003),
			unit * (0.006 + index * 0.002),
		);
	}
	options.ctx.restore();
}

const CORE_EFFECT_MARKERS: Readonly<Record<string, number>> = {
	block: 2,
	chroma: 1,
	flash: 5,
	invert: 4,
	mosaic: 7,
	slice: 3,
	zoom: 6,
};

function effectPulse({
	effectIndex,
	localTime,
}: {
	readonly effectIndex: number;
	readonly localTime: number;
}): number {
	const period = TICKS_PER_SECOND * 0.6;
	const shifted = localTime / period + effectIndex * 0.173;
	const phase = shifted - Math.floor(shifted);
	return 0.22 + Math.pow(1 - phase, 2) * 0.78;
}

function capture({
	ctx,
	height,
	surfaces,
	width,
}: CoreScreenEffectDraw & {
	readonly ctx: PixelContext;
	readonly surfaces: ScratchSurfaces;
}): void {
	resizeCanvas({ canvas: surfaces.source, height, width });
	surfaces.sourceContext.save();
	surfaces.sourceContext.setTransform(1, 0, 0, 1, 0, 0);
	surfaces.sourceContext.clearRect(0, 0, width, height);
	surfaces.sourceContext.globalCompositeOperation = "copy";
	surfaces.sourceContext.globalAlpha = 1;
	surfaces.sourceContext.drawImage(ctx.canvas, 0, 0, width, height);
	surfaces.sourceContext.restore();
}

function tintSurface({
	color,
	height,
	surfaces,
	width,
}: {
	readonly color: string;
	readonly height: number;
	readonly surfaces: ScratchSurfaces;
	readonly width: number;
}): void {
	resizeCanvas({ canvas: surfaces.work, height, width });
	surfaces.workContext.save();
	surfaces.workContext.setTransform(1, 0, 0, 1, 0, 0);
	surfaces.workContext.clearRect(0, 0, width, height);
	surfaces.workContext.globalCompositeOperation = "copy";
	surfaces.workContext.globalAlpha = 1;
	surfaces.workContext.drawImage(surfaces.source, 0, 0);
	surfaces.workContext.globalCompositeOperation = "source-in";
	surfaces.workContext.fillStyle = color;
	surfaces.workContext.fillRect(0, 0, width, height);
	surfaces.workContext.restore();
}

function scratchSurfaces({
	ctx,
	height,
	width,
}: {
	readonly ctx: PixelContext;
	readonly height: number;
	readonly width: number;
}): ScratchSurfaces | null {
	const cached = scratchByCanvas.get(ctx.canvas);
	if (cached) return cached;
	const source = createScratchCanvas({
		height,
		source: ctx.canvas,
		width,
	});
	const work = createScratchCanvas({
		height,
		source: ctx.canvas,
		width,
	});
	const tiny = createScratchCanvas({
		height: 16,
		source: ctx.canvas,
		width: 16,
	});
	if (!source || !work || !tiny) return null;
	const surfaces = {
		source: source.canvas,
		sourceContext: source.context,
		work: work.canvas,
		workContext: work.context,
		tiny: tiny.canvas,
		tinyContext: tiny.context,
	};
	scratchByCanvas.set(ctx.canvas, surfaces);
	return surfaces;
}

function createScratchCanvas({
	height,
	source,
	width,
}: {
	readonly height: number;
	readonly source: ScratchCanvas;
	readonly width: number;
}): { readonly canvas: ScratchCanvas; readonly context: PixelContext } | null {
	let canvas: ScratchCanvas;
	if (
		typeof OffscreenCanvas !== "undefined" &&
		source instanceof OffscreenCanvas
	) {
		canvas = new OffscreenCanvas(width, height);
	} else if ("ownerDocument" in source) {
		canvas = source.ownerDocument.createElement("canvas");
		canvas.width = width;
		canvas.height = height;
	} else if (typeof OffscreenCanvas !== "undefined") {
		canvas = new OffscreenCanvas(width, height);
	} else {
		return null;
	}
	// Resolve each canvas's 2D overload before joining the DOM context types.
	const context = "ownerDocument" in canvas
		? canvas.getContext("2d")
		: canvas.getContext("2d");
	return context && isPixelContext(context) ? { canvas, context } : null;
}

function resizeCanvas({
	canvas,
	height,
	width,
}: {
	readonly canvas: ScratchCanvas;
	readonly height: number;
	readonly width: number;
}): void {
	if (canvas.width !== width) canvas.width = width;
	if (canvas.height !== height) canvas.height = height;
}

function isPixelContext(ctx: MotionTextCanvasContext): ctx is PixelContext {
	return (
		ctx.canvas !== undefined &&
		typeof ctx.clearRect === "function" &&
		typeof ctx.drawImage === "function" &&
		typeof ctx.globalCompositeOperation === "string" &&
		typeof ctx.imageSmoothingEnabled === "boolean"
	);
}
