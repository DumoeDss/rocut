import type { TypographyTextDraw } from "./typography-layout-types";
import {
	mixHex,
	randomSigned,
	randomUnit,
	secondsOf,
} from "./exit-hold-geometry";
import type { MotionTextCanvasContext, MotionTextRenderFrame } from "./types";

export interface TreatTransTreatmentDraw extends TypographyTextDraw {
	readonly ctx: MotionTextCanvasContext;
	readonly frame: MotionTextRenderFrame;
}

export interface TreatTransGlyph {
	readonly character: string;
	readonly index: number;
	readonly order: number;
	readonly x: number;
	readonly y: number;
	readonly width: number;
}

export function clamp01(value: number): number {
	return Math.min(1, Math.max(0, value));
}

export function inOutCubic(value: number): number {
	const progress = clamp01(value);
	return progress < 0.5 ? 4 * progress ** 3 : 1 - (-2 * progress + 2) ** 3 / 2;
}

export function outCubic(value: number): number {
	return 1 - (1 - clamp01(value)) ** 3;
}

export function treatSeconds(options: TreatTransTreatmentDraw): number {
	return secondsOf(options.frame);
}

export function treatSeed(options: TreatTransTreatmentDraw): number {
	return options.frame.cut?.seed ?? 0;
}

// eslint-disable-next-line opencut/prefer-object-params -- Seeded drawing reads compactly as (options, index, salt).
export function treatRandom(
	options: TreatTransTreatmentDraw,
	index: number,
	salt: number,
): number {
	return randomUnit(treatSeed(options), index, salt);
}

// eslint-disable-next-line opencut/prefer-object-params -- Seeded drawing reads compactly as (options, index, salt).
export function treatRandomSigned(
	options: TreatTransTreatmentDraw,
	index: number,
	salt: number,
): number {
	return randomSigned(treatSeed(options), index, salt);
}

// eslint-disable-next-line opencut/prefer-object-params -- Tracking is an optional geometry scalar, not an options bag.
export function treatTransGlyphs(
	options: TreatTransTreatmentDraw,
	tracking = 0,
): TreatTransGlyph[] {
	const characters = Array.from(options.text);
	const advances = characters.map((character) =>
		/\s/u.test(character) ? options.size * 0.34 : options.size * 0.62,
	);
	const visible = characters.filter(
		(character) => !/\s/u.test(character),
	).length;
	const trackingWidth = Math.max(0, visible - 1) * options.size * tracking;
	const naturalWidth = advances.reduce((sum, advance) => sum + advance, 0);
	const scale =
		naturalWidth + trackingWidth > 0
			? Math.min(1, options.maxWidth / (naturalWidth + trackingWidth))
			: 1;
	const width = (naturalWidth + trackingWidth) * scale;
	const startX =
		options.ctx.textAlign === "left" || options.ctx.textAlign === "start"
			? options.x
			: options.ctx.textAlign === "right" || options.ctx.textAlign === "end"
				? options.x - width
				: options.x - width / 2;
	let cursor = startX;
	let order = 0;
	const glyphs: TreatTransGlyph[] = [];
	for (const [index, character] of characters.entries()) {
		const advance = (advances[index] ?? 0) * scale;
		if (/\s/u.test(character)) {
			cursor += advance;
			continue;
		}
		const glyphWidth = options.size * 0.62 * scale;
		glyphs.push({
			character,
			index,
			order,
			width: glyphWidth,
			x: cursor + advance / 2,
			y: options.y,
		});
		cursor += advance + options.size * tracking * scale;
		order += 1;
	}
	return glyphs;
}

export function drawTreatGlyph({
	alpha = 1,
	character,
	color,
	ctx,
	maxWidth,
	rotation = 0,
	scaleX = 1,
	scaleY = 1,
	strokeColor,
	strokeWidth = 0,
	x,
	y,
}: TreatTransTreatmentDraw & {
	readonly alpha?: number;
	readonly character: string;
	readonly color?: string;
	readonly rotation?: number;
	readonly scaleX?: number;
	readonly scaleY?: number;
	readonly strokeColor?: string;
	readonly strokeWidth?: number;
	readonly x: number;
	readonly y: number;
}): void {
	ctx.save();
	ctx.translate(x, y);
	ctx.rotate(rotation);
	ctx.scale(scaleX, scaleY);
	ctx.textAlign = "center";
	ctx.globalAlpha *= alpha;
	if (strokeColor && strokeWidth > 0) {
		ctx.lineWidth = strokeWidth;
		ctx.strokeStyle = strokeColor;
		ctx.strokeText(character, 0, 0, maxWidth);
	}
	ctx.fillStyle = color ?? "#ffffff";
	ctx.fillText(character, 0, 0, maxWidth);
	ctx.restore();
}

// eslint-disable-next-line opencut/prefer-object-params -- The treatment options and draw overrides are separate concepts.
export function drawTreatText(
	options: TreatTransTreatmentDraw,
	input: {
		readonly alpha?: number;
		readonly color?: string;
		readonly offsetX?: number;
		readonly offsetY?: number;
		readonly strokeColor?: string;
		readonly strokeWidth?: number;
	},
): void {
	const {
		alpha = 1,
		color = options.frame.palette.foreground,
		offsetX = 0,
		offsetY = 0,
		strokeColor,
		strokeWidth = 0,
	} = input;
	options.ctx.save();
	options.ctx.globalAlpha *= alpha;
	options.ctx.fillStyle = color;
	if (strokeColor && strokeWidth > 0) {
		options.ctx.lineWidth = strokeWidth;
		options.ctx.strokeStyle = strokeColor;
		options.ctx.strokeText(
			options.text,
			options.x + offsetX,
			options.y + offsetY,
			options.maxWidth,
		);
	}
	options.ctx.fillText(
		options.text,
		options.x + offsetX,
		options.y + offsetY,
		options.maxWidth,
	);
	options.ctx.restore();
}

export function treatBounds(options: TreatTransTreatmentDraw): {
	readonly bottom: number;
	readonly height: number;
	readonly left: number;
	readonly right: number;
	readonly top: number;
	readonly width: number;
} {
	const glyphs = treatTransGlyphs(options);
	const fallbackWidth = Math.min(
		options.maxWidth,
		Math.max(
			options.size * 0.62,
			Array.from(options.text).length * options.size * 0.62,
		),
	);
	const left = glyphs[0]
		? glyphs[0].x - glyphs[0].width / 2
		: options.x - fallbackWidth / 2;
	const right = glyphs.at(-1)
		? glyphs.at(-1)!.x + glyphs.at(-1)!.width / 2
		: options.x + fallbackWidth / 2;
	const height = options.size * 1.18;
	return {
		bottom: options.y + height * 0.5,
		height,
		left,
		right,
		top: options.y - height * 0.5,
		width: right - left,
	};
}

// eslint-disable-next-line opencut/prefer-object-params -- Palette interpolation mirrors the compact color-mix API.
export function paletteMix(
	options: TreatTransTreatmentDraw,
	from: string,
	to: string,
	progress: number,
): string {
	void options;
	return mixHex({ from, to, progress: clamp01(progress) });
}

// eslint-disable-next-line opencut/prefer-object-params -- The callback-based clip helper mirrors Canvas save/clip/draw usage.
export function withRectClip(
	ctx: MotionTextCanvasContext,
	rect: readonly [number, number, number, number],
	draw: () => void,
): void {
	ctx.save();
	ctx.beginPath();
	ctx.rect(...rect);
	ctx.clip();
	draw();
	ctx.restore();
}

// eslint-disable-next-line opencut/prefer-object-params -- Canvas context remains distinct from circle geometry.
export function drawCircle(
	ctx: MotionTextCanvasContext,
	input: {
		readonly alpha?: number;
		readonly color: string;
		readonly radius: number;
		readonly stroke?: boolean;
		readonly width?: number;
		readonly x: number;
		readonly y: number;
	},
): void {
	if (!ctx.arc || (!ctx.fill && !ctx.stroke)) {
		ctx.save();
		ctx.globalAlpha *= input.alpha ?? 1;
		ctx.fillStyle = input.color;
		ctx.fillRect(
			input.x - input.radius,
			input.y - input.radius,
			input.radius * 2,
			input.radius * 2,
		);
		ctx.restore();
		return;
	}
	ctx.save();
	ctx.globalAlpha *= input.alpha ?? 1;
	ctx.beginPath();
	ctx.arc(input.x, input.y, input.radius, 0, Math.PI * 2);
	if (input.stroke && ctx.stroke) {
		ctx.strokeStyle = input.color;
		ctx.lineWidth = input.width ?? 2;
		ctx.stroke();
	} else if (ctx.fill) {
		ctx.fillStyle = input.color;
		ctx.fill();
	} else {
		ctx.strokeStyle = input.color;
		ctx.lineWidth = input.radius * 2;
		ctx.stroke?.();
	}
	ctx.restore();
}
