import {
	mediaTime,
	type MotionTextParameterValue,
	type MotionTextSequence,
} from "@opencut/editor-contracts";

import { drawMotionTextBackground } from "./backgrounds";
import { drawCoreDecors } from "./core-decors";
import { signedRandom, unitRandom } from "./deterministic-random";
import { drawHorrorDecors } from "./horror-decors";
import { drawScreenEffects } from "./screen-effects";
import { drawTypographyDecors } from "./typography-decors";
import { drawTypographyEntrance } from "./typography-entrances";
import { drawTypographyExit } from "./typography-exits";
import { drawTypographyHold } from "./typography-holds";
import type { TypographyTextDraw } from "./typography-layout-types";
import { drawTypographyLayout } from "./typography-layouts";
import { drawTypographyTreatment } from "./typography-treatments";
import { drawTypographyTransition } from "./typography-transitions";
import type { MotionTextCanvasContext, MotionTextRenderFrame } from "./types";

export function drawMotionTextFrame({
	ctx,
	frame,
	width,
	height,
	compositionMode,
}: {
	ctx: MotionTextCanvasContext;
	frame: MotionTextRenderFrame;
	width: number;
	height: number;
	compositionMode: MotionTextSequence["compositionMode"];
}): void {
	ctx.save();
	ctx.setTransform(1, 0, 0, 1, 0, 0);
	if (compositionMode === "scene") {
		ctx.fillStyle = frame.palette.background;
		ctx.fillRect(0, 0, width, height);
	}
	const { cut } = frame;
	if (!cut) {
		ctx.restore();
		return;
	}
	drawMotionTextBackground({ ctx, frame, width, height });

	if (cut.text.length > 0) {
		ctx.save();
		ctx.globalAlpha = frame.opacity;
		ctx.translate(
			width / 2 + frame.translateX * width,
			height / 2 + frame.translateY * height,
		);
		ctx.rotate(frame.rotation);
		ctx.scale(frame.scale * frame.scaleX, frame.scale * frame.scaleY);
		if (Math.abs(frame.skewX) > Number.EPSILON) {
			ctx.transform(1, 0, Math.tan(frame.skewX), 1, 0, 0);
		}
		ctx.translate(-width / 2, -height / 2);
		if (frame.wipe < 1) {
			ctx.beginPath();
			ctx.rect(0, 0, width * frame.wipe, height);
			ctx.clip();
		}
		ctx.filter =
			frame.blur > 0.01 ? `blur(${frame.blur.toFixed(2)}px)` : "none";
		const drawSingleContent = ({
			contentFrame,
			contentWidth = width,
			contentHeight = height,
		}: {
			readonly contentFrame: MotionTextRenderFrame;
			readonly contentWidth?: number;
			readonly contentHeight?: number;
		}) => {
			drawHorrorDecors({
				ctx,
				frame: contentFrame,
				width: contentWidth,
				height: contentHeight,
				layer: "back",
			});
			drawCoreDecors({
				ctx,
				frame: contentFrame,
				width: contentWidth,
				height: contentHeight,
				layer: "back",
			});
			drawLayout({
				ctx,
				frame: contentFrame,
				width: contentWidth,
				height: contentHeight,
			});
			drawTypographyDecors({
				ctx,
				frame: contentFrame,
				width: contentWidth,
				height: contentHeight,
			});
			drawCoreDecors({
				ctx,
				frame: contentFrame,
				width: contentWidth,
				height: contentHeight,
				layer: "front",
			});
			drawHorrorDecors({
				ctx,
				frame: contentFrame,
				width: contentWidth,
				height: contentHeight,
				layer: "front",
			});
		};
		const drawContent = (contentFrame: MotionTextRenderFrame) => {
			const centerFree = readCenterFree(contentFrame);
			if (!centerFree) {
				drawSingleContent({ contentFrame });
				return;
			}
			const zones = centerFreeZones({
				width,
				height,
				direction: centerFree.direction,
			});
			for (const [index, zone] of zones.entries()) {
				const delay = index === 0 ? 0 : centerFree.delayTicks;
				if (contentFrame.localTime < delay) continue;
				const text = index === 0 ? centerFree.firstText : centerFree.secondText;
				const localTime = Math.max(0, contentFrame.localTime - delay);
				const duration = Math.max(1, (contentFrame.cut?.duration ?? 1) - delay);
				const zonedFrame: MotionTextRenderFrame = {
					...contentFrame,
					cut: contentFrame.cut
						? {
								...contentFrame.cut,
								text,
								duration: mediaTime({ ticks: duration }),
							}
						: null,
					localTime,
					progress: Math.min(1, localTime / duration),
					enterProgress:
						index === 0
							? contentFrame.enterProgress
							: Math.max(
									0,
									contentFrame.enterProgress -
										delay / Math.max(1, contentFrame.cut?.duration ?? 1),
								),
				};
				ctx.save();
				ctx.translate(zone.x, zone.y);
				ctx.beginPath();
				ctx.rect(0, 0, zone.width, zone.height);
				ctx.clip();
				drawSingleContent({
					contentFrame: zonedFrame,
					contentWidth: zone.width,
					contentHeight: zone.height,
				});
				ctx.restore();
			}
		};
		const previousFrame = frame.previousCut
			? {
					...frame,
					cut: frame.previousCut,
					previousCut: null,
					palette: frame.previousPalette ?? frame.palette,
					previousPalette: null,
					font: frame.previousFont ?? frame.font,
					previousFont: null,
					localTime: frame.previousCut.duration,
					progress: 1,
					enterProgress: 1,
					exitProgress: 0,
				}
			: null;
		if (
			!drawTypographyTransition({
				ctx,
				drawCurrent: () => drawContent(frame),
				drawPrevious: () => {
					if (previousFrame) drawContent(previousFrame);
				},
				frame,
				height,
				width,
			})
		) {
			drawContent(frame);
		}
		ctx.restore();
	}
	drawScreenEffects({ compositionMode, ctx, frame, width, height });
	ctx.restore();
}

interface CenterFreeParameters {
	readonly direction: "tb" | "lr";
	readonly firstText: string;
	readonly secondText: string;
	readonly delayTicks: number;
}

interface CenterFreeZone {
	readonly x: number;
	readonly y: number;
	readonly width: number;
	readonly height: number;
}

function isParameterRecord(
	value: MotionTextParameterValue | undefined,
): value is Readonly<Record<string, MotionTextParameterValue>> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function readCenterFree(
	frame: MotionTextRenderFrame,
): CenterFreeParameters | null {
	const value = frame.cut?.parameters["jizura.centerFree"];
	if (!isParameterRecord(value)) return null;
	const direction = value.direction;
	const firstText = value.firstText;
	const secondText = value.secondText;
	const delayTicks = value.delayTicks;
	if (
		value.enabled !== true ||
		(direction !== "tb" && direction !== "lr") ||
		typeof firstText !== "string" ||
		typeof secondText !== "string" ||
		typeof delayTicks !== "number" ||
		!Number.isFinite(delayTicks) ||
		delayTicks < 0
	) {
		return null;
	}
	return { direction, firstText, secondText, delayTicks };
}

function centerFreeZones({
	width,
	height,
	direction,
}: {
	readonly width: number;
	readonly height: number;
	readonly direction: "tb" | "lr";
}): readonly [CenterFreeZone, CenterFreeZone] {
	if (height > width * 1.1 && direction === "lr") {
		const zoneWidth = Math.round(width * 0.34);
		return [
			{ x: 0, y: 0, width: zoneWidth, height },
			{ x: width - zoneWidth, y: 0, width: zoneWidth, height },
		];
	}
	if (height > width * 1.1) {
		const zoneHeight = Math.round(height * 0.33);
		return [
			{ x: 0, y: 0, width, height: zoneHeight },
			{ x: 0, y: height - zoneHeight, width, height: zoneHeight },
		];
	}
	const zoneWidth = Math.round(width * (width / height > 2 ? 0.3 : 0.36));
	return [
		{ x: 0, y: 0, width: zoneWidth, height },
		{ x: width - zoneWidth, y: 0, width: zoneWidth, height },
	];
}

function drawLayout({
	ctx,
	frame,
	width,
	height,
}: {
	ctx: MotionTextCanvasContext;
	frame: MotionTextRenderFrame;
	width: number;
	height: number;
}): void {
	const cut = frame.cut;
	if (!cut) return;
	const characters = Array.from(cut.text);
	const baseSize = Math.min(
		height * 0.22,
		width / Math.max(4, characters.length * 0.72),
	);
	ctx.fillStyle = frame.palette.foreground;
	ctx.textAlign = "center";
	ctx.textBaseline = "middle";
	ctx.font = `${frame.font.style} ${frame.font.weight} ${Math.max(18, baseSize)}px ${quoteFamily(frame.font.family)}`;
	configureTreatment({ ctx, frame, baseSize });
	const setFontSize = (size: number) => {
		ctx.font = `${frame.font.style} ${frame.font.weight} ${Math.max(18, size)}px ${quoteFamily(frame.font.family)}`;
	};
	const drawText = (draw: TypographyTextDraw) => {
		setFontSize(draw.size);
		if (
			drawTypographyEntrance({
				...draw,
				ctx,
				drawGlyph: (glyph) => {
					setFontSize(glyph.size);
					drawTreatedText({ ctx, frame, ...glyph });
				},
				frame,
			})
		) {
			return;
		}
		if (
			drawTypographyExit({
				...draw,
				ctx,
				drawGlyph: (glyph) => {
					setFontSize(glyph.size);
					drawTreatedText({ ctx, frame, ...glyph });
				},
				frame,
			})
		) {
			return;
		}
		if (
			drawTypographyHold({
				...draw,
				ctx,
				drawGlyph: (glyph) => {
					setFontSize(glyph.size);
					drawTreatedText({ ctx, frame, ...glyph });
				},
				frame,
			})
		) {
			return;
		}
		drawTreatedText({ ctx, frame, ...draw });
	};
	if (
		drawTypographyLayout({
			ctx,
			drawText,
			frame,
			height,
			setFontSize,
			width,
		})
	) {
		return;
	}

	switch (cut.preset.layout) {
		case "vcols":
			drawVertical({
				drawText,
				text: characters,
				width,
				height,
				size: baseSize,
			});
			break;
		case "mixed":
			drawMixed({
				ctx,
				drawText,
				text: characters,
				width,
				height,
				size: baseSize,
				frame,
			});
			break;
		case "stack":
			if (frame.enterProgress >= 0.999) {
				ctx.globalAlpha *= 0.18;
				ctx.fillText(
					cut.text,
					width / 2 - baseSize * 0.12,
					height / 2 - baseSize * 0.48,
					width * 0.86,
				);
				ctx.fillText(
					cut.text,
					width / 2 + baseSize * 0.12,
					height / 2 + baseSize * 0.48,
					width * 0.86,
				);
				ctx.globalAlpha /= 0.18;
			}
			drawText({
				text: cut.text,
				x: width / 2,
				y: height / 2,
				maxWidth: width * 0.86,
				size: baseSize,
			});
			break;
		case "huge":
			drawText({
				text: cut.text,
				x: width / 2,
				y: height / 2,
				maxWidth: width * 1.1,
				size: height * 0.5,
			});
			break;
		case "marquee": {
			const offset = (frame.progress - 0.5) * width * 0.28;
			drawText({
				text: cut.text,
				x: width / 2 - offset,
				y: height / 2,
				maxWidth: width * 0.9,
				size: baseSize,
			});
			break;
		}
		case "type": {
			const count = Math.max(1, Math.ceil(characters.length * frame.progress));
			drawText({
				text: characters.slice(0, count).join(""),
				x: width / 2,
				y: height / 2,
				maxWidth: width * 0.86,
				size: baseSize,
			});
			break;
		}
		default:
			drawText({
				text: cut.text,
				x: width / 2,
				y: height / 2,
				maxWidth: width * 0.86,
				size: baseSize,
			});
	}
}

function drawTreatedText({
	ctx,
	frame,
	text,
	x,
	y,
	maxWidth,
	size,
}: {
	ctx: MotionTextCanvasContext;
	frame: MotionTextRenderFrame;
	text: string;
	x: number;
	y: number;
	maxWidth: number;
	size: number;
}): void {
	if (drawTypographyTreatment({ ctx, frame, text, x, y, maxWidth, size })) {
		return;
	}
	const treat = frame.cut?.preset.treat;
	if (treat === "outline" || treat === "outlineFill") {
		ctx.lineWidth = Math.max(1, size * 0.045);
		ctx.strokeStyle = frame.palette.accent;
		ctx.strokeText(text, x, y, maxWidth);
	}
	if (treat !== "outline") ctx.fillText(text, x, y, maxWidth);
	if (treat === "underline") {
		ctx.fillStyle = frame.palette.accent;
		ctx.fillRect(
			x - maxWidth * 0.34,
			y + size * 0.62,
			maxWidth * 0.68,
			Math.max(2, size * 0.035),
		);
	}
}

function configureTreatment({
	ctx,
	frame,
	baseSize,
}: {
	ctx: MotionTextCanvasContext;
	frame: MotionTextRenderFrame;
	baseSize: number;
}): void {
	if (frame.cut?.preset.treat !== "glow") return;
	ctx.shadowColor = frame.palette.accent;
	ctx.shadowBlur = Math.max(4, baseSize * 0.16);
}

function drawVertical({
	drawText,
	text,
	width,
	height,
	size,
}: {
	drawText: (draw: TypographyTextDraw) => void;
	text: readonly string[];
	width: number;
	height: number;
	size: number;
}): void {
	const rows = Math.max(1, Math.floor((height * 0.72) / (size * 1.05)));
	const columns = Math.ceil(text.length / rows);
	for (let index = 0; index < text.length; index += 1) {
		const column = Math.floor(index / rows);
		const row = index % rows;
		const x = width / 2 + (columns / 2 - column - 0.5) * size * 1.2;
		const y =
			height / 2 + (row - (Math.min(rows, text.length) - 1) / 2) * size * 1.05;
		drawText({
			text: text[index],
			x,
			y,
			maxWidth: size * 1.1,
			size,
		});
	}
}

function drawMixed({
	ctx,
	drawText,
	text,
	width,
	height,
	size,
	frame,
}: {
	ctx: MotionTextCanvasContext;
	drawText: (draw: TypographyTextDraw) => void;
	text: readonly string[];
	width: number;
	height: number;
	size: number;
	frame: MotionTextRenderFrame;
}): void {
	const step = Math.min(size * 1.05, (width * 0.78) / Math.max(1, text.length));
	for (let index = 0; index < text.length; index += 1) {
		const factor =
			0.72 + unitRandom({ seed: frame.cut?.seed ?? 0, salt: index }) * 0.55;
		ctx.fillStyle =
			index % 3 === 1 ? frame.palette.accent : frame.palette.foreground;
		drawText({
			text: text[index],
			x: width / 2 + (index - (text.length - 1) / 2) * step,
			y:
				height / 2 +
				signedRandom({ seed: frame.cut?.seed ?? 0, salt: index + 101 }) *
					size *
					0.18,
			maxWidth: size * factor * 1.1,
			size: size * factor,
		});
	}
}

function quoteFamily(family: string): string {
	return `"${family.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}
