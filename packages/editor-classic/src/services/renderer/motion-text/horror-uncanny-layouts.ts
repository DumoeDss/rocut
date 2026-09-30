import { degrees, inOutCubic, lerp, stableIndex } from "./kinetic-layout-utils";
import {
	clamp01,
	drawKineticLayoutText,
	drawKineticRule,
	fillHorrorRect,
	fitKineticText,
	horrorDate,
	horrorGlyphs,
	horrorLines,
	horrorRandom,
	horrorSignedRandom,
	horrorStep,
	horrorTextBlock,
	outCubic,
} from "./horror-layout-utils";
import type { TypographyLayoutOptions } from "./typography-layout-types";

export function drawHorrorUncannyLayout(
	options: TypographyLayoutOptions,
): boolean {
	switch (options.frame.cut?.preset.layout) {
		case "hrWrongOne":
			drawWrongOne(options);
			return true;
		case "hrRisingDark":
			drawRisingDark(options);
			return true;
		case "hrRedacted":
			drawRedacted(options);
			return true;
		case "hrStaticTv":
			drawStaticTv(options);
			return true;
		case "hrSpiritPhoto":
			drawSpiritPhoto(options);
			return true;
		case "hrWrongShadow":
			drawWrongShadow(options);
			return true;
		default:
			return false;
	}
}

function drawWrongOne(options: TypographyLayoutOptions): void {
	const glyphs = horrorGlyphs(options.frame.cut?.text ?? "");
	if (glyphs.length === 0) return;
	const wrong = stableIndex({ count: glyphs.length, options, salt: 601 });
	const columns = Math.min(
		options.height > options.width ? 5 : 9,
		glyphs.length,
	);
	const rows = Math.ceil(glyphs.length / columns);
	const cellWidth = (options.width * 0.78) / columns;
	const cellHeight = (options.height * 0.48) / rows;
	const size = Math.max(18, Math.min(cellWidth * 0.72, cellHeight * 0.62));
	const left = options.width / 2 - ((columns - 1) * cellWidth) / 2;
	const top = options.height / 2 - ((rows - 1) * cellHeight) / 2;
	const turn = inOutCubic(clamp01((options.frame.progress - 0.32) / 0.44));
	for (const [index, glyph] of glyphs.entries()) {
		const column = index % columns;
		const row = Math.floor(index / columns);
		const isWrong = index === wrong;
		drawKineticLayoutText({
			options,
			text: {
				text: glyph,
				x: left + column * cellWidth,
				y: top + row * cellHeight + (isWrong ? size * 0.14 * turn : 0),
				size,
				rotation: isWrong ? degrees(90 * turn) : 0,
				color:
					isWrong && turn > 0.35
						? options.frame.palette.accent
						: options.frame.palette.foreground,
			},
		});
		drawKineticLayoutText({
			options,
			text: {
				text:
					isWrong && turn > 0.55 ? "??" : String(index + 1).padStart(2, "0"),
				x: left + column * cellWidth,
				y: top + row * cellHeight + size * 0.72,
				size: Math.max(8, size * 0.15),
				alpha: 0.66,
				color: isWrong
					? options.frame.palette.accent
					: options.frame.palette.secondary,
			},
		});
	}
}

function drawRisingDark(options: TypographyLayoutOptions): void {
	const glyphs = horrorGlyphs(options.frame.cut?.text ?? "");
	if (glyphs.length === 0) return;
	const size = fitKineticText({
		text: glyphs.join(""),
		width: options.width * 0.78,
		height: options.height * 0.18,
		maxSize: options.height * 0.17,
	});
	const span = Math.min(options.width * 0.76, glyphs.length * size * 0.78);
	const startX = options.width / 2 - span / 2;
	const targetY = options.height * 0.43;
	const surfaceY = targetY + size * 1.08;
	for (const [index, glyph] of glyphs.entries()) {
		const stagger = index / Math.max(1, glyphs.length - 1);
		let rise = 0;
		for (let pull = 0; pull < 4; pull += 1) {
			const threshold = stagger * 0.26 + pull * 0.1;
			rise += outCubic(clamp01((options.frame.progress - threshold) / 0.1)) / 4;
		}
		const x =
			startX +
			span * ((index + 0.5) / glyphs.length) +
			horrorSignedRandom({ options, salt: 630 + index + horrorStep(options) }) *
				size *
				0.025 *
				(1 - rise);
		const y = lerp({
			start: surfaceY + size * 0.7,
			end: targetY,
			progress: rise,
		});
		drawKineticLayoutText({
			options,
			text: {
				text: glyph,
				x,
				y,
				size,
				rotation: degrees(
					horrorSignedRandom({ options, salt: 650 + index }) * 16 * (1 - rise),
				),
				alpha: 0.3 + rise * 0.7,
				color: options.frame.palette.foreground,
			},
		});
	}
	fillHorrorRect({
		options,
		x: 0,
		y: surfaceY,
		width: options.width,
		height: options.height - surfaceY,
		color: options.frame.palette.background,
		alpha: 0.92,
	});
	for (let index = 0; index < 18; index += 1) {
		fillHorrorRect({
			options,
			x: (index / 18) * options.width,
			y:
				surfaceY +
				Math.sin(index * 1.7 + options.frame.progress * Math.PI * 5) *
					size *
					0.08,
			width: options.width / 15,
			height: Math.max(2, size * 0.025),
			color: options.frame.palette.secondary,
			alpha: 0.24,
		});
	}
}

function drawRedacted(options: TypographyLayoutOptions): void {
	const margin = options.width * (options.height > options.width ? 0.08 : 0.12);
	const contentWidth = options.width - margin * 2;
	const small = Math.max(10, Math.min(options.width, options.height) * 0.035);
	drawKineticLayoutText({
		options,
		text: {
			text: `FILE NO. ${1000 + Math.floor(horrorRandom({ options, salt: 701 }) * 8999)}   ${horrorDate(options)}`,
			x: margin,
			y: options.height * 0.09,
			size: small,
			align: "left",
			alpha: 0.74,
			color: options.frame.palette.secondary,
		},
	});
	drawKineticRule({
		options,
		x: margin,
		y: options.height * 0.12,
		width: contentWidth * outCubic(clamp01(options.frame.progress / 0.2)),
		height: 2,
		color: options.frame.palette.secondary,
		alpha: 0.62,
	});
	const rowHeight = options.height * 0.075;
	for (let row = 0; row < 8; row += 1) {
		const y = options.height * 0.19 + row * rowHeight;
		const width = contentWidth * (row % 4 === 3 ? 0.58 : 0.92);
		const segmentCount = 3 + (row % 3);
		for (let segment = 0; segment < segmentCount; segment += 1) {
			if (horrorRandom({ options, salt: 720 + row * 9 + segment }) < 0.18) {
				continue;
			}
			const segmentWidth =
				(width / segmentCount) *
				(0.54 +
					horrorRandom({ options, salt: 760 + row * 9 + segment }) * 0.38);
			fillHorrorRect({
				options,
				x: margin + (segment / segmentCount) * width,
				y: y - small * 0.48,
				width: segmentWidth,
				height: small * 0.96,
				color: options.frame.palette.foreground,
				alpha: 0.84,
			});
		}
	}
	const lines = horrorLines({
		text: options.frame.cut?.text ?? "",
		maximum: options.height > options.width ? 7 : 15,
	});
	const longest = lines.reduce(
		(value, line) => (line.length > value.length ? line : value),
		"",
	);
	const size = fitKineticText({
		text: longest,
		width: contentWidth,
		height: options.height * 0.11,
		maxSize: options.height * 0.09,
	});
	const lyricY = options.height * 0.48;
	fillHorrorRect({
		options,
		x: margin - size * 0.2,
		y: lyricY - size * 0.68,
		width: contentWidth + size * 0.4,
		height: size * 1.36,
		color: options.frame.palette.background,
		alpha: 0.88,
	});
	horrorTextBlock({
		options,
		lines,
		x: margin,
		y: lyricY,
		size,
		lineGap: size * 1.22,
		color: options.frame.palette.foreground,
	});
	const cover = 1 - outCubic(clamp01((options.frame.progress - 0.16) / 0.42));
	fillHorrorRect({
		options,
		x: margin + contentWidth * (1 - cover),
		y: lyricY - size * 0.72,
		width: contentWidth * cover,
		height: size * 1.44,
		color: options.frame.palette.foreground,
		alpha: 0.94,
	});
	if (options.frame.progress > 0.44) {
		options.ctx.save();
		options.ctx.translate(options.width * 0.73, options.height * 0.8);
		options.ctx.rotate(degrees(-10));
		drawKineticLayoutText({
			options,
			text: {
				text: "CLASSIFIED",
				x: 0,
				y: 0,
				size: small * 1.5,
				color: options.frame.palette.accent,
				alpha: 0.85,
			},
		});
		for (const y of [-small * 1.15, small * 0.8]) {
			fillHorrorRect({
				options,
				x: -small * 5.1,
				y,
				width: small * 10.2,
				height: 3,
				color: options.frame.palette.accent,
				alpha: 0.85,
			});
		}
		options.ctx.restore();
	}
}

function drawStaticTv(options: TypographyLayoutOptions): void {
	const portrait = options.height > options.width;
	const tvWidth = Math.min(
		options.width * (portrait ? 0.86 : 0.64),
		options.height * 1.05,
	);
	const tvHeight = tvWidth / 1.35;
	const centerX = options.width / 2;
	const centerY = options.height / 2 + tvHeight * 0.05;
	const left = centerX - tvWidth / 2;
	const top = centerY - tvHeight / 2;
	for (const direction of [-1, 1]) {
		options.ctx.save();
		options.ctx.translate(centerX, top);
		options.ctx.rotate(degrees(direction * 24));
		fillHorrorRect({
			options,
			x: direction < 0 ? -tvHeight * 0.42 : 0,
			y: -2,
			width: tvHeight * 0.42,
			height: 4,
			color: options.frame.palette.secondary,
			alpha: 0.7,
		});
		options.ctx.restore();
	}
	fillHorrorRect({
		options,
		x: left,
		y: top,
		width: tvWidth,
		height: tvHeight,
		color: options.frame.palette.background,
		alpha: 0.9,
	});
	const screenLeft = left + tvWidth * 0.06;
	const screenTop = top + tvHeight * 0.1;
	const screenWidth = tvWidth * 0.73;
	const screenHeight = tvHeight * 0.78;
	fillHorrorRect({
		options,
		x: screenLeft,
		y: screenTop,
		width: screenWidth,
		height: screenHeight,
		color: "#000000",
		alpha: 0.76,
	});
	const step = horrorStep(options);
	const tune = inOutCubic(clamp01((options.frame.progress - 0.08) / 0.42));
	for (let index = 0; index < 42; index += 1) {
		const y = screenTop + ((index * 19 + step * 11) % 97) * (screenHeight / 97);
		const xOffset = horrorRandom({ options, salt: 820 + index + step }) * 0.16;
		fillHorrorRect({
			options,
			x: screenLeft + screenWidth * xOffset,
			y,
			width: screenWidth * (0.35 + (index % 5) * 0.12),
			height: Math.max(1, screenHeight * (0.004 + (index % 3) * 0.003)),
			color: options.frame.palette.foreground,
			alpha: (0.3 - tune * 0.2) * (index % 4 === 0 ? 1 : 0.55),
		});
	}
	const size = fitKineticText({
		text: options.frame.cut?.text ?? "",
		width: screenWidth * 0.8,
		height: screenHeight * 0.28,
		maxSize: screenHeight * 0.25,
	});
	drawKineticLayoutText({
		options,
		text: {
			text: options.frame.cut?.text ?? "",
			x: screenLeft + screenWidth / 2,
			y:
				screenTop +
				screenHeight / 2 +
				Math.sin(options.frame.progress * Math.PI * 18) *
					screenHeight *
					0.04 *
					(1 - tune),
			size,
			maxWidth: screenWidth * 0.82,
			alpha: 0.48 + tune * 0.52,
			color: options.frame.palette.foreground,
		},
	});
	for (let index = 0; index < 2; index += 1) {
		fillHorrorRect({
			options,
			x: left + tvWidth * 0.87,
			y: top + tvHeight * (0.22 + index * 0.2),
			width: tvWidth * 0.055,
			height: tvWidth * 0.055,
			color: options.frame.palette.secondary,
			alpha: 0.72,
		});
	}
	for (let index = 0; index < 5; index += 1) {
		fillHorrorRect({
			options,
			x: left + tvWidth * 0.84,
			y: top + tvHeight * (0.62 + index * 0.05),
			width: tvWidth * 0.12,
			height: 2,
			color: options.frame.palette.secondary,
			alpha: 0.5,
		});
	}
}

function drawSpiritPhoto(options: TypographyLayoutOptions): void {
	const portrait = options.height > options.width;
	const photoWidth = portrait
		? options.width * 0.78
		: Math.min(options.width * 0.46, options.height * 0.9);
	const photoHeight = photoWidth / 1.25;
	const side = horrorRandom({ options, salt: 901 }) > 0.5 ? 1 : -1;
	const photoX = portrait
		? options.width / 2
		: options.width * (side > 0 ? 0.3 : 0.7);
	const photoY = portrait ? options.height * 0.32 : options.height * 0.5;
	const angle = degrees(horrorSignedRandom({ options, salt: 902 }) * 5);
	options.ctx.save();
	options.ctx.translate(photoX, photoY);
	options.ctx.rotate(angle);
	fillHorrorRect({
		options,
		x: -photoWidth / 2 - 9,
		y: -photoHeight / 2 - 9,
		width: photoWidth + 18,
		height: photoHeight + 30,
		color: options.frame.palette.foreground,
		alpha: 0.86,
	});
	fillHorrorRect({
		options,
		x: -photoWidth / 2,
		y: -photoHeight / 2,
		width: photoWidth,
		height: photoHeight,
		color: options.frame.palette.background,
		alpha: 0.8,
	});
	fillHorrorRect({
		options,
		x: -photoWidth / 2,
		y: photoHeight * 0.16,
		width: photoWidth,
		height: photoHeight * 0.34,
		color: options.frame.palette.secondary,
		alpha: 0.16,
	});
	const spotX = photoWidth * 0.16;
	const spotY = -photoHeight * 0.12;
	for (const scale of [1, 0.68, 0.36]) {
		fillHorrorRect({
			options,
			x: spotX - photoWidth * 0.13 * scale,
			y: spotY - photoHeight * 0.18 * scale,
			width: photoWidth * 0.26 * scale,
			height: photoHeight * 0.36 * scale,
			color: options.frame.palette.foreground,
			alpha: 0.07 + (1 - scale) * 0.05,
		});
	}
	const marker = Math.min(photoWidth, photoHeight) * 0.16;
	for (const [x, y, width, height] of [
		[spotX - marker, spotY - marker, marker * 0.65, 3],
		[spotX - marker, spotY - marker, 3, marker * 0.65],
		[spotX + marker * 0.35, spotY - marker, marker * 0.65, 3],
		[spotX + marker - 3, spotY - marker, 3, marker * 0.65],
		[spotX - marker, spotY + marker - 3, marker * 0.65, 3],
		[spotX - marker, spotY + marker * 0.35, 3, marker * 0.65],
		[spotX + marker * 0.35, spotY + marker - 3, marker * 0.65, 3],
		[spotX + marker - 3, spotY + marker * 0.35, 3, marker * 0.65],
	] as const) {
		fillHorrorRect({
			options,
			x,
			y,
			width,
			height,
			color: options.frame.palette.accent,
			alpha: outCubic(clamp01((options.frame.progress - 0.28) / 0.28)),
		});
	}
	drawKineticLayoutText({
		options,
		text: {
			text: `'${horrorDate(options).slice(2)}`,
			x: photoWidth * 0.42,
			y: photoHeight * 0.42,
			size: Math.max(8, photoHeight * 0.055),
			align: "right",
			color: options.frame.palette.accent,
			alpha: 0.82,
		},
	});
	options.ctx.restore();
	const noteX = portrait
		? options.width / 2
		: options.width * (side > 0 ? 0.76 : 0.24);
	const noteY = portrait ? options.height * 0.76 : options.height * 0.5;
	const noteLines = horrorLines({
		text: options.frame.cut?.text ?? "",
		maximum: portrait ? 7 : 6,
	});
	const longest = noteLines.reduce(
		(value, line) => (line.length > value.length ? line : value),
		"",
	);
	const size = fitKineticText({
		text: longest,
		width: portrait ? options.width * 0.82 : options.width * 0.34,
		height: options.height * 0.13,
		maxSize: options.height * 0.12,
	});
	horrorTextBlock({
		options,
		lines: noteLines,
		x: noteX,
		y: noteY,
		size,
		lineGap: size * 1.18,
		rotation: -angle * 0.45,
	});
	options.ctx.save();
	options.ctx.translate((photoX + noteX) / 2, (photoY + noteY) / 2);
	options.ctx.rotate(Math.atan2(noteY - photoY, noteX - photoX));
	fillHorrorRect({
		options,
		x: -Math.hypot(noteX - photoX, noteY - photoY) * 0.27,
		y: -2,
		width: Math.hypot(noteX - photoX, noteY - photoY) * 0.54,
		height: 4,
		color: options.frame.palette.accent,
		alpha: 0.72,
	});
	options.ctx.restore();
}

function drawWrongShadow(options: TypographyLayoutOptions): void {
	const lines = horrorLines({
		text: options.frame.cut?.text ?? "",
		maximum: options.height > options.width ? 4 : 8,
	});
	if (lines.length === 0) return;
	const longest = lines.reduce((value, line) =>
		line.length > value.length ? line : value,
	);
	const size = fitKineticText({
		text: longest,
		width: options.width * 0.64,
		height: options.height * 0.15,
		maxSize: options.height * 0.14,
	});
	const shadowSize = Math.min(size * 1.65, options.height * 0.23);
	const turn = inOutCubic(clamp01((options.frame.progress - 0.42) / 0.38));
	const shadowScale = Math.cos(turn * Math.PI);
	const shake =
		horrorSignedRandom({ options, salt: 970 + horrorStep(options) }) *
		size *
		0.08;
	for (const [index, line] of lines.entries()) {
		for (const echo of [-0.035, 0.035]) {
			drawKineticLayoutText({
				options,
				text: {
					text: line,
					x: options.width / 2 + shake + shadowSize * echo,
					y:
						options.height * 0.25 +
						(index - (lines.length - 1) / 2) * shadowSize * 1.12 +
						Math.abs(echo) * shadowSize * 0.35,
					size: shadowSize,
					alpha: 0.18,
					color: options.frame.palette.background,
					scaleX: Math.abs(shadowScale) < 0.05 ? 0.05 : shadowScale,
					rotation: degrees(
						horrorSignedRandom({ options, salt: 980 + index }) *
							7 *
							Math.sin(options.frame.progress * Math.PI * 2),
					),
				},
			});
		}
	}
	horrorTextBlock({
		options,
		lines,
		x: options.width / 2,
		y: options.height * 0.69,
		size,
		lineGap: size * 1.12,
	});
	drawKineticRule({
		options,
		x: options.width * 0.18,
		y: options.height * 0.69 + lines.length * size * 0.62,
		width: options.width * 0.64,
		height: Math.max(2, size * 0.02),
		color: options.frame.palette.secondary,
		alpha: 0.52,
	});
}
