import { drawKineticDecor } from "./kinetic-decors";
import type { MotionTextCanvasContext, MotionTextRenderFrame } from "./types";

const TICKS_PER_SECOND = 120_000;

interface TypographyDecorDraw {
	readonly ctx: MotionTextCanvasContext;
	readonly frame: MotionTextRenderFrame;
	readonly height: number;
	readonly width: number;
}

interface TextBounds {
	readonly x0: number;
	readonly x1: number;
	readonly y0: number;
	readonly y1: number;
	readonly width: number;
	readonly height: number;
}

export function drawTypographyDecors(options: TypographyDecorDraw): void {
	const decors = options.frame.cut?.preset.decor ?? [];
	for (const decor of decors) {
		if (drawKineticDecor({ ...options, decor })) continue;
		switch (decor) {
			case "tyColophon":
				drawColophon(options);
				break;
			case "tyRunningHead":
				drawRunningHead(options);
				break;
			case "tyGlyphBody":
				drawGlyphBody(options);
				break;
			case "tyTextRule":
				drawTextRule(options);
				break;
			case "tyTypeScale":
				drawTypeScale(options);
				break;
			case "tyBigPunct":
				drawBigPunct(options);
				break;
		}
	}
}

function drawColophon(options: TypographyDecorDraw): void {
	const cut = options.frame.cut;
	if (!cut) return;
	const alpha = decorAlpha(options.frame);
	if (alpha <= 0.003) return;
	const size = Math.min(options.width, options.height) * 0.026;
	const lineHeight = size * 1.65;
	const margin = Math.min(options.width, options.height) * 0.055;
	const raw = cut.text.replace(/\s+/gu, "");
	const title = truncate({
		text: cut.text.replace(/\s+/gu, " ").trim(),
		length: 18,
	});
	const start = cut.startTime / TICKS_PER_SECOND;
	const end = (cut.startTime + cut.duration) / TICKS_PER_SECOND;
	const lines = [
		{ text: title, color: options.frame.palette.foreground },
		{
			text: `No.01  ${formatTime(start)} – ${formatTime(end)}`,
			color: options.frame.palette.secondary,
		},
		{
			text: `${Array.from(raw).length} CHARS`,
			color: options.frame.palette.secondary,
		},
	];
	const x = margin + size * 1.35;
	const y = options.height - margin - lineHeight * lines.length;
	options.ctx.globalAlpha *= alpha;
	options.ctx.fillStyle = options.frame.palette.accent;
	options.ctx.fillRect(margin, y, Math.max(1.5, size * 0.08), lineHeight * 3);
	for (const [index, line] of lines.entries()) {
		drawLabel({
			...options,
			alpha: index === 0 ? 1 : 0.82,
			color: line.color,
			size,
			text: line.text,
			x,
			y: y + lineHeight * (index + 0.52),
		});
	}
	options.ctx.globalAlpha /= alpha;
}

function drawRunningHead(options: TypographyDecorDraw): void {
	const cut = options.frame.cut;
	if (!cut) return;
	const alpha = decorAlpha(options.frame);
	if (alpha <= 0.003) return;
	const margin = Math.min(options.width, options.height) * 0.055;
	const size = Math.min(options.width, options.height) * 0.023;
	const head = `01 / ${truncate({ text: cut.text.replace(/\s+/gu, " ").trim(), length: 28 })}`;
	const headWidth = Math.min(options.width * 0.48, head.length * size * 0.64);
	const top = margin + size * 0.6;
	options.ctx.globalAlpha *= alpha;
	drawLabel({
		...options,
		alpha: 0.82,
		color: options.frame.palette.secondary,
		size,
		text: head,
		x: margin,
		y: top,
	});
	options.ctx.fillStyle = options.frame.palette.secondary;
	options.ctx.fillRect(
		margin + headWidth + size,
		top,
		Math.max(0, options.width - margin * 2 - headWidth - size),
		Math.max(1, size * 0.05),
	);
	const folio = "001";
	const folioX = options.width - margin - size;
	const folioY = options.height - margin;
	drawLabel({
		...options,
		align: "center",
		color: options.frame.palette.foreground,
		size: size * 1.3,
		text: folio,
		x: folioX,
		y: folioY,
	});
	options.ctx.fillStyle = options.frame.palette.accent;
	options.ctx.fillRect(
		folioX - size * 1.4,
		folioY - size * 1.35,
		size * 2.8,
		Math.max(1.5, size * 0.08),
	);
	options.ctx.globalAlpha /= alpha;
}

function drawGlyphBody(options: TypographyDecorDraw): void {
	const cut = options.frame.cut;
	if (!cut) return;
	const alpha = decorAlpha(options.frame);
	const bounds = textBounds(options);
	if (alpha <= 0.003 || bounds.height > bounds.width * 1.3) return;
	const margin = Math.min(options.width, options.height) * 0.035;
	const gap = Math.min(options.width, options.height) * 0.025;
	const glyphCount = Math.max(
		1,
		Math.min(
			16,
			Array.from(cut.text).filter((character) => !/\s/u.test(character)).length,
		),
	);
	const line = Math.max(1, Math.min(options.width, options.height) * 0.0025);
	options.ctx.globalAlpha *= alpha * 0.45;
	options.ctx.fillStyle = options.frame.palette.secondary;
	for (let index = 0; index <= glyphCount; index += 1) {
		const x = bounds.x0 + (bounds.width * index) / glyphCount;
		options.ctx.fillRect(
			x,
			margin,
			line,
			Math.max(0, bounds.y0 - gap - margin),
		);
		options.ctx.fillRect(
			x,
			bounds.y1 + gap,
			line,
			Math.max(0, options.height - margin - bounds.y1 - gap),
		);
	}
	for (const y of [bounds.y0, bounds.y1]) {
		options.ctx.fillRect(
			margin,
			y,
			Math.max(0, bounds.x0 - gap - margin),
			line,
		);
		options.ctx.fillRect(
			bounds.x1 + gap,
			y,
			Math.max(0, options.width - margin - bounds.x1 - gap),
			line,
		);
	}
	options.ctx.globalAlpha /= alpha * 0.45;
	drawLabel({
		...options,
		color: options.frame.palette.accent,
		size: Math.min(options.width, options.height) * 0.018,
		text: `${String(glyphCount).padStart(2, "0")} / W${Math.round(bounds.width)}`,
		x: bounds.x0,
		y: Math.max(margin, bounds.y0 - gap * 1.4),
	});
}

function drawTextRule(options: TypographyDecorDraw): void {
	const cut = options.frame.cut;
	if (!cut) return;
	const alpha = decorAlpha(options.frame);
	if (alpha <= 0.003) return;
	const margin = Math.min(options.width, options.height) * 0.055;
	const size = Math.min(options.width, options.height) * 0.018;
	const unit = `${cut.text.replace(/\s+/gu, " ").trim()} / `;
	const repeated = unit.repeat(
		Math.max(3, Math.ceil(48 / Math.max(1, unit.length))),
	);
	const drift =
		((options.frame.localTime / TICKS_PER_SECOND) * size * 2.2) %
		(size * Math.max(3, unit.length * 0.55));
	const rows = [margin * 0.75, options.height - margin * 0.75];
	for (const [index, y] of rows.entries()) {
		const direction = index === 0 ? -1 : 1;
		options.ctx.save();
		options.ctx.beginPath();
		options.ctx.rect(margin, y - size, options.width - margin * 2, size * 2);
		options.ctx.clip();
		drawLabel({
			...options,
			alpha: alpha * 0.8,
			color: options.frame.palette.secondary,
			size,
			text: repeated,
			x: margin - size * 2 + drift * direction,
			y,
		});
		options.ctx.restore();
		options.ctx.globalAlpha *= alpha * 0.5;
		options.ctx.fillStyle = options.frame.palette.secondary;
		options.ctx.fillRect(
			margin,
			y + (index === 0 ? size : -size * 1.05),
			options.width - margin * 2,
			Math.max(1, size * 0.05),
		);
		options.ctx.globalAlpha /= alpha * 0.5;
	}
}

function drawTypeScale(options: TypographyDecorDraw): void {
	const cut = options.frame.cut;
	if (!cut) return;
	const character = keyCharacter(cut.text);
	const alpha = decorAlpha(options.frame);
	if (!character || alpha <= 0.003) return;
	const margin = Math.min(options.width, options.height) * 0.055;
	const baseSize = Math.min(options.width, options.height) * 0.085;
	const scales = [1, 0.72, 0.52, 0.37, 0.26] as const;
	const labelSize = Math.min(options.width, options.height) * 0.017;
	let x = margin;
	const baseline = options.height - margin - labelSize * 1.8;
	for (const [index, scale] of scales.entries()) {
		const size = baseSize * scale;
		drawLabel({
			...options,
			align: "center",
			alpha,
			color:
				index === 0
					? options.frame.palette.foreground
					: options.frame.palette.secondary,
			size,
			text: character,
			x: x + size / 2,
			y: baseline - size * 0.42,
		});
		drawLabel({
			...options,
			align: "center",
			alpha: alpha * 0.9,
			color: options.frame.palette.secondary,
			size: labelSize,
			text: String(Math.round(size * 0.75)),
			x: x + size / 2,
			y: baseline + labelSize,
		});
		x += size * 1.18;
	}
	options.ctx.globalAlpha *= alpha * 0.8;
	options.ctx.fillStyle = options.frame.palette.accent;
	options.ctx.fillRect(
		margin,
		baseline + labelSize * 0.2,
		x - margin,
		Math.max(1, labelSize * 0.06),
	);
	options.ctx.globalAlpha /= alpha * 0.8;
}

function drawBigPunct(options: TypographyDecorDraw): void {
	const alpha = decorAlpha(options.frame);
	if (alpha <= 0.003) return;
	const bounds = textBounds(options);
	const size = clampRange({
		value: bounds.height * 2.1,
		minimum: Math.min(options.width, options.height) * 0.22,
		maximum: Math.min(options.width, options.height) * 0.55,
	});
	const progress = outCubic(
		clamp01(options.frame.localTime / (TICKS_PER_SECOND * 0.7)),
	);
	const slide = (1 - progress) * size * 0.25;
	drawLabel({
		...options,
		align: "center",
		alpha: alpha * progress * 0.34,
		color: options.frame.palette.secondary,
		size,
		text: "「",
		x: bounds.x0 - size * 0.2 - slide,
		y: bounds.y0 + size * 0.4 - slide,
	});
	drawLabel({
		...options,
		align: "center",
		alpha: alpha * progress * 0.34,
		color: options.frame.palette.secondary,
		size,
		text: "」",
		x: bounds.x1 + size * 0.2 + slide,
		y: bounds.y1 - size * 0.4 + slide,
	});
}

function drawLabel({
	align = "left",
	alpha = 1,
	color,
	ctx,
	frame,
	size,
	text,
	x,
	y,
}: TypographyDecorDraw & {
	readonly align?: CanvasTextAlign;
	readonly alpha?: number;
	readonly color: string;
	readonly size: number;
	readonly text: string;
	readonly x: number;
	readonly y: number;
}): void {
	const baseAlpha = ctx.globalAlpha;
	ctx.globalAlpha = baseAlpha * alpha;
	ctx.fillStyle = color;
	ctx.textAlign = align;
	ctx.textBaseline = "middle";
	ctx.font = `${frame.font.style} ${frame.font.weight} ${Math.max(8, size)}px ${quoteFamily(frame.font.family)}`;
	ctx.fillText(text, x, y);
	ctx.globalAlpha = baseAlpha;
}

function textBounds({ frame, height, width }: TypographyDecorDraw): TextBounds {
	const text = frame.cut?.text ?? "";
	const characters = Array.from(text);
	const baseSize = Math.min(
		height * 0.22,
		width / Math.max(4, characters.length * 0.72),
	);
	const vertical = frame.cut?.preset.layout === "vcols";
	const textWidth = vertical
		? baseSize * 1.2
		: Math.min(
				width * 0.86,
				Math.max(baseSize, characters.length * baseSize * 0.62),
			);
	const textHeight = vertical
		? Math.min(
				height * 0.8,
				Math.max(baseSize, characters.length * baseSize * 1.05),
			)
		: baseSize * 1.25;
	return {
		x0: width / 2 - textWidth / 2,
		x1: width / 2 + textWidth / 2,
		y0: height / 2 - textHeight / 2,
		y1: height / 2 + textHeight / 2,
		width: textWidth,
		height: textHeight,
	};
}

function decorAlpha(frame: MotionTextRenderFrame): number {
	const enter = smooth(frame.enterProgress);
	const exit = smooth(1 - frame.exitProgress);
	return enter * exit;
}

function keyCharacter(text: string): string | null {
	const characters = Array.from(text);
	return (
		characters.find((character) => /\p{Script=Han}/u.test(character)) ??
		characters.find((character) => /[\p{L}\p{N}]/u.test(character)) ??
		null
	);
}

function formatTime(seconds: number): string {
	const minutes = Math.floor(seconds / 60);
	const remaining = Math.max(0, seconds - minutes * 60);
	return `${String(minutes).padStart(2, "0")}:${remaining.toFixed(2).padStart(5, "0")}`;
}

function truncate({
	text,
	length,
}: {
	readonly text: string;
	readonly length: number;
}): string {
	const characters = Array.from(text);
	return characters.length > length
		? `${characters.slice(0, length - 1).join("")}…`
		: text;
}

function quoteFamily(family: string): string {
	return `"${family.replaceAll('"', '\\"')}"`;
}

function smooth(value: number): number {
	const progress = clamp01(value);
	return progress * progress * (3 - 2 * progress);
}

function outCubic(value: number): number {
	return 1 - (1 - clamp01(value)) ** 3;
}

function clamp01(value: number): number {
	return Math.min(1, Math.max(0, value));
}

function clampRange({
	value,
	minimum,
	maximum,
}: {
	readonly value: number;
	readonly minimum: number;
	readonly maximum: number;
}): number {
	return Math.min(maximum, Math.max(minimum, value));
}
