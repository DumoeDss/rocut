import { degrees, stableIndex } from "./kinetic-layout-utils";
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
	horrorTime,
	outCubic,
} from "./horror-layout-utils";
import type { TypographyLayoutOptions } from "./typography-layout-types";

export function drawHorrorFoundFootageLayout(
	options: TypographyLayoutOptions,
): boolean {
	switch (options.frame.cut?.preset.layout) {
		case "hrFlashlight":
			drawFlashlight(options);
			return true;
		case "hrDoorGap":
			drawDoorGap(options);
			return true;
		case "hrWallScrawl":
			drawWallScrawl(options);
			return true;
		case "hrCctv":
			drawCctv(options);
			return true;
		case "hrOuija":
			drawOuija(options);
			return true;
		case "hrMissing":
			drawMissingPoster(options);
			return true;
		default:
			return false;
	}
}

function drawFlashlight(options: TypographyLayoutOptions): void {
	const text = options.frame.cut?.text ?? "";
	const lines = horrorLines({
		text,
		maximum: options.height > options.width ? 5 : 10,
	});
	if (lines.length === 0) return;
	const longest = lines.reduce((value, line) =>
		line.length > value.length ? line : value,
	);
	const size = fitKineticText({
		text: longest,
		width: options.width * 0.78,
		height: options.height * 0.2,
		maxSize: options.height * 0.18,
	});
	horrorTextBlock({
		options,
		lines,
		x: options.width / 2,
		y: options.height / 2,
		size,
		lineGap: size * 1.22,
	});

	const progress = options.frame.progress;
	const travel = clamp01(progress / 0.68);
	const wobble =
		horrorSignedRandom({ options, salt: horrorStep(options) + 31 }) *
		size *
		0.22;
	const beamX =
		options.width * (0.2 + travel * 0.6) +
		Math.sin(progress * Math.PI * 5) * size * 0.25 +
		wobble;
	const beamY =
		options.height / 2 +
		Math.sin(progress * Math.PI * 3.2 + 0.6) * options.height * 0.14;
	const open = outCubic(clamp01((progress - 0.62) / 0.22));
	const radius = Math.max(
		size * 0.92,
		Math.min(options.width, options.height) * (0.13 + open * 0.3),
	);
	const darkness = 0.86 - open * 0.24;
	const dark = options.frame.palette.background;
	fillHorrorRect({
		options,
		x: 0,
		y: 0,
		width: options.width,
		height: Math.max(0, beamY - radius),
		color: dark,
		alpha: darkness,
	});
	fillHorrorRect({
		options,
		x: 0,
		y: beamY + radius,
		width: options.width,
		height: Math.max(0, options.height - beamY - radius),
		color: dark,
		alpha: darkness,
	});
	fillHorrorRect({
		options,
		x: 0,
		y: Math.max(0, beamY - radius),
		width: Math.max(0, beamX - radius),
		height: radius * 2,
		color: dark,
		alpha: darkness,
	});
	fillHorrorRect({
		options,
		x: beamX + radius,
		y: Math.max(0, beamY - radius),
		width: Math.max(0, options.width - beamX - radius),
		height: radius * 2,
		color: dark,
		alpha: darkness,
	});
	for (let index = 0; index < 12; index += 1) {
		const x =
			beamX + horrorSignedRandom({ options, salt: 80 + index }) * radius * 0.82;
		const y =
			beamY + horrorSignedRandom({ options, salt: 100 + index }) * radius * 0.7;
		const particle = Math.max(1, size * (0.014 + (index % 3) * 0.006));
		fillHorrorRect({
			options,
			x,
			y,
			width: particle,
			height: particle,
			color: options.frame.palette.foreground,
			alpha: 0.18 + 0.16 * Math.sin(progress * Math.PI * 8 + index),
		});
	}
}

function drawDoorGap(options: TypographyLayoutOptions): void {
	const text = options.frame.cut?.text ?? "";
	const lines = horrorLines({
		text,
		maximum: options.height > options.width ? 5 : 11,
	});
	if (lines.length === 0) return;
	const longest = lines.reduce((value, line) =>
		line.length > value.length ? line : value,
	);
	const size = fitKineticText({
		text: longest,
		width: options.width * 0.75,
		height: options.height * 0.2,
		maxSize: options.height * 0.17,
	});
	horrorTextBlock({
		options,
		lines,
		x: options.width / 2,
		y: options.height / 2,
		size,
		lineGap: size * 1.2,
	});
	const vertical = horrorRandom({ options, salt: 141 }) > 0.35;
	const firstCrack = 0.14 * outCubic(clamp01(options.frame.progress / 0.12));
	const opening = outCubic(clamp01((options.frame.progress - 0.2) / 0.42));
	const close = 1 - outCubic(clamp01((options.frame.progress - 0.84) / 0.16));
	const gap =
		(vertical ? options.width : options.height) *
		(0.015 + firstCrack + opening * 0.42) *
		close;
	const dark = options.frame.palette.background;
	if (vertical) {
		const leftWidth = Math.max(0, options.width / 2 - gap / 2);
		fillHorrorRect({
			options,
			x: 0,
			y: 0,
			width: leftWidth,
			height: options.height,
			color: dark,
			alpha: 0.94,
		});
		fillHorrorRect({
			options,
			x: options.width / 2 + gap / 2,
			y: 0,
			width: leftWidth,
			height: options.height,
			color: dark,
			alpha: 0.94,
		});
		for (const side of [-1, 1]) {
			drawKineticRule({
				options,
				x: options.width / 2 + (side * gap) / 2 - 1.5,
				y: options.height * 0.08,
				width: 3,
				height: options.height * 0.84,
				color: options.frame.palette.secondary,
				alpha: 0.7,
			});
		}
		fillHorrorRect({
			options,
			x: options.width / 2 - gap / 2,
			y: options.height * 0.82,
			width: gap,
			height: options.height * 0.18,
			color: options.frame.palette.foreground,
			alpha: 0.06 * opening,
		});
	} else {
		const panelHeight = Math.max(0, options.height / 2 - gap / 2);
		fillHorrorRect({
			options,
			x: 0,
			y: 0,
			width: options.width,
			height: panelHeight,
			color: dark,
			alpha: 0.94,
		});
		fillHorrorRect({
			options,
			x: 0,
			y: options.height / 2 + gap / 2,
			width: options.width,
			height: panelHeight,
			color: dark,
			alpha: 0.94,
		});
		for (const side of [-1, 1]) {
			drawKineticRule({
				options,
				x: options.width * 0.08,
				y: options.height / 2 + (side * gap) / 2 - 1.5,
				width: options.width * 0.84,
				height: 3,
				color: options.frame.palette.secondary,
				alpha: 0.7,
			});
		}
	}
}

function drawWallScrawl(options: TypographyLayoutOptions): void {
	const text = options.frame.cut?.text.trim() ?? "";
	if (!text) return;
	const mainLines = horrorLines({ text, maximum: 10 });
	const mainLongest = mainLines.reduce((value, line) =>
		line.length > value.length ? line : value,
	);
	const mainSize = fitKineticText({
		text: mainLongest,
		width: options.width * 0.72,
		height: options.height * 0.2,
		maxSize: options.height * 0.17,
	});
	const rowHeight = options.height / 8;
	const visibleCopies = Math.max(
		8,
		Math.ceil(clamp01(options.frame.progress / 0.7) * 22),
	);
	for (let index = 0; index < visibleCopies; index += 1) {
		const row = index % 8;
		const column = Math.floor(index / 8);
		const size =
			rowHeight * (0.38 + horrorRandom({ options, salt: 200 + index }) * 0.18);
		const x =
			(column + 0.5) * (options.width / 5) +
			horrorSignedRandom({ options, salt: 240 + index }) * size;
		const y =
			(row + 0.55) * rowHeight +
			horrorSignedRandom({ options, salt: 280 + index }) * size * 0.28;
		drawKineticLayoutText({
			options,
			text: {
				text,
				x,
				y,
				size,
				alpha: index % 9 === 0 ? 0.62 : 0.28,
				color:
					index % 9 === 0
						? options.frame.palette.accent
						: options.frame.palette.secondary,
				rotation: degrees(
					horrorSignedRandom({ options, salt: 320 + index }) * 10,
				),
			},
		});
	}
	fillHorrorRect({
		options,
		x: options.width * 0.12,
		y: options.height * 0.34,
		width: options.width * 0.76,
		height: options.height * 0.32,
		color: options.frame.palette.background,
		alpha: 0.82,
	});
	horrorTextBlock({
		options,
		lines: mainLines,
		x: options.width / 2,
		y: options.height / 2,
		size: mainSize,
		lineGap: mainSize * 1.12,
	});
}

function drawCctv(options: TypographyLayoutOptions): void {
	const active = stableIndex({ count: 4, options, salt: 401 });
	const gap = Math.max(3, Math.min(options.width, options.height) * 0.009);
	const margin = Math.min(options.width, options.height) * 0.035;
	const panelWidth = (options.width - margin * 2 - gap) / 2;
	const panelHeight = (options.height - margin * 2 - gap) / 2;
	const labelSize = Math.max(
		10,
		Math.min(options.width, options.height) * 0.03,
	);
	const step = horrorStep(options);
	for (let index = 0; index < 4; index += 1) {
		const column = index % 2;
		const row = Math.floor(index / 2);
		const x = margin + column * (panelWidth + gap);
		const y = margin + row * (panelHeight + gap);
		fillHorrorRect({
			options,
			x,
			y,
			width: panelWidth,
			height: panelHeight,
			color: options.frame.palette.background,
			alpha: 0.88,
		});
		for (let scan = 0; scan < 10; scan += 1) {
			fillHorrorRect({
				options,
				x,
				y: y + ((scan * 17 + step * 3) % 100) * (panelHeight / 100),
				width: panelWidth,
				height: Math.max(1, panelHeight * 0.007),
				color: options.frame.palette.secondary,
				alpha: index === active ? 0.12 : 0.06,
			});
		}
		for (const edge of [
			[x, y, panelWidth, 2],
			[x, y + panelHeight - 2, panelWidth, 2],
			[x, y, 2, panelHeight],
			[x + panelWidth - 2, y, 2, panelHeight],
		] as const) {
			fillHorrorRect({
				options,
				x: edge[0],
				y: edge[1],
				width: edge[2],
				height: edge[3],
				color:
					index === active
						? options.frame.palette.accent
						: options.frame.palette.secondary,
				alpha: index === active ? 0.9 : 0.45,
			});
		}
		drawKineticLayoutText({
			options,
			text: {
				text: `CAM ${String(index + 1).padStart(2, "0")}`,
				x: x + labelSize * 0.65,
				y: y + labelSize,
				size: labelSize,
				align: "left",
				alpha: 0.78,
				color: options.frame.palette.foreground,
			},
		});
		if (index === active) {
			const size = fitKineticText({
				text: options.frame.cut?.text ?? "",
				width: panelWidth * 0.76,
				height: panelHeight * 0.25,
				maxSize: panelHeight * 0.22,
			});
			drawKineticLayoutText({
				options,
				text: {
					text: options.frame.cut?.text ?? "",
					x: x + panelWidth / 2,
					y: y + panelHeight / 2,
					size,
					maxWidth: panelWidth * 0.78,
					color: options.frame.palette.foreground,
				},
			});
			if (step % 4 < 2) {
				fillHorrorRect({
					options,
					x: x + panelWidth - labelSize * 3.4,
					y: y + labelSize * 0.55,
					width: labelSize * 0.45,
					height: labelSize * 0.45,
					color: options.frame.palette.accent,
				});
			}
			drawKineticLayoutText({
				options,
				text: {
					text: "REC",
					x: x + panelWidth - labelSize * 2.5,
					y: y + labelSize,
					size: labelSize,
					align: "left",
					color: options.frame.palette.foreground,
				},
			});
		} else if (horrorRandom({ options, salt: 430 + index }) > 0.5) {
			drawKineticLayoutText({
				options,
				text: {
					text: "NO SIGNAL",
					x: x + panelWidth / 2,
					y: y + panelHeight / 2,
					size: labelSize,
					alpha: step % 6 < 4 ? 0.6 : 0.2,
					color: options.frame.palette.secondary,
				},
			});
		}
		drawKineticLayoutText({
			options,
			text: {
				text: `${horrorDate(options)} ${horrorTime(options)}`,
				x: x + panelWidth - labelSize * 0.6,
				y: y + panelHeight - labelSize * 0.7,
				size: labelSize * 0.7,
				align: "right",
				alpha: 0.68,
				color: options.frame.palette.foreground,
			},
		});
	}
}

function drawOuija(options: TypographyLayoutOptions): void {
	const portrait = options.height > options.width;
	const boardWidth = Math.min(
		options.width * 0.88,
		options.height * (portrait ? 0.66 : 1.25),
	);
	const boardHeight = boardWidth * (portrait ? 0.72 : 0.52);
	const centerX = options.width / 2;
	const centerY = portrait ? options.height * 0.36 : options.height * 0.39;
	fillHorrorRect({
		options,
		x: centerX - boardWidth / 2,
		y: centerY - boardHeight / 2,
		width: boardWidth,
		height: boardHeight,
		color: options.frame.palette.background,
		alpha: 0.82,
	});
	for (const edge of [
		[centerX - boardWidth / 2, centerY - boardHeight / 2, boardWidth, 2],
		[centerX - boardWidth / 2, centerY + boardHeight / 2 - 2, boardWidth, 2],
		[centerX - boardWidth / 2, centerY - boardHeight / 2, 2, boardHeight],
		[centerX + boardWidth / 2 - 2, centerY - boardHeight / 2, 2, boardHeight],
	] as const) {
		fillHorrorRect({
			options,
			x: edge[0],
			y: edge[1],
			width: edge[2],
			height: edge[3],
			color: options.frame.palette.secondary,
			alpha: 0.75,
		});
	}
	const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
	const glyphSize = boardHeight * 0.075;
	for (const [index, glyph] of Array.from(alphabet).entries()) {
		const row = index < 13 ? 0 : 1;
		const rowIndex = row === 0 ? index : index - 13;
		const angle = degrees(-145 + rowIndex * (110 / 12));
		const radiusX = boardWidth * (row === 0 ? 0.39 : 0.31);
		const radiusY = boardHeight * (row === 0 ? 0.4 : 0.26);
		drawKineticLayoutText({
			options,
			text: {
				text: glyph,
				x: centerX + Math.cos(angle) * radiusX,
				y: centerY + Math.sin(angle) * radiusY + boardHeight * 0.1,
				size: glyphSize,
				rotation: angle + Math.PI / 2,
				alpha: 0.7,
				color: options.frame.palette.secondary,
			},
		});
	}
	for (const [label, x] of [
		["YES", centerX - boardWidth * 0.32],
		["NO", centerX + boardWidth * 0.32],
	] as const) {
		drawKineticLayoutText({
			options,
			text: {
				text: label,
				x,
				y: centerY - boardHeight * 0.34,
				size: glyphSize,
				color: options.frame.palette.foreground,
			},
		});
	}
	drawKineticLayoutText({
		options,
		text: {
			text: "GOOD BYE",
			x: centerX,
			y: centerY + boardHeight * 0.38,
			size: glyphSize * 0.82,
			color: options.frame.palette.secondary,
		},
	});
	const units = horrorGlyphs(options.frame.cut?.text ?? "");
	const targetIndex = units.length
		? Math.min(
				units.length - 1,
				Math.floor(options.frame.progress * units.length),
			)
		: 0;
	const targetGlyph = (units[targetIndex] ?? "A").toUpperCase();
	const alphabetIndex = Math.max(0, alphabet.indexOf(targetGlyph));
	const targetRow = alphabetIndex < 13 ? 0 : 1;
	const rowIndex = targetRow === 0 ? alphabetIndex : alphabetIndex - 13;
	const targetAngle = degrees(-145 + rowIndex * (110 / 12));
	const pointerX =
		centerX +
		Math.cos(targetAngle) * boardWidth * (targetRow === 0 ? 0.39 : 0.31);
	const pointerY =
		centerY +
		Math.sin(targetAngle) * boardHeight * (targetRow === 0 ? 0.4 : 0.26) +
		boardHeight * 0.17;
	const pointerSize = glyphSize * 1.35;
	for (const [rotation, length] of [
		[-58, pointerSize * 2.7],
		[58, pointerSize * 2.7],
		[0, pointerSize * 2.2],
	] as const) {
		const radians = degrees(rotation);
		options.ctx.save();
		options.ctx.translate(pointerX, pointerY);
		options.ctx.rotate(radians);
		fillHorrorRect({
			options,
			x: -length / 2,
			y: -1.5,
			width: length,
			height: 3,
			color: options.frame.palette.foreground,
			alpha: 0.82,
		});
		options.ctx.restore();
	}
	drawKineticLayoutText({
		options,
		text: {
			text: options.frame.cut?.text ?? "",
			x: centerX,
			y: portrait ? options.height * 0.78 : options.height * 0.84,
			size: fitKineticText({
				text: options.frame.cut?.text ?? "",
				width: options.width * 0.84,
				height: options.height * 0.12,
				maxSize: options.height * 0.11,
			}),
			color: options.frame.palette.foreground,
		},
	});
}

function drawMissingPoster(options: TypographyLayoutOptions): void {
	const portrait = options.height > options.width;
	const posterHeight = options.height * 0.88;
	const posterWidth = Math.min(
		options.width * (portrait ? 0.84 : 0.5),
		posterHeight * 0.72,
	);
	const angle = degrees(horrorSignedRandom({ options, salt: 501 }) * 3.5);
	const centerX = options.width / 2;
	const centerY = options.height / 2;
	const arrival =
		0.82 + outCubic(clamp01(options.frame.progress / 0.65)) * 0.18;
	options.ctx.save();
	options.ctx.translate(centerX, centerY);
	options.ctx.rotate(angle);
	options.ctx.scale(arrival, arrival);
	fillHorrorRect({
		options,
		x: -posterWidth / 2 + 7,
		y: -posterHeight / 2 + 9,
		width: posterWidth,
		height: posterHeight,
		color: "#000000",
		alpha: 0.22,
	});
	fillHorrorRect({
		options,
		x: -posterWidth / 2,
		y: -posterHeight / 2,
		width: posterWidth,
		height: posterHeight,
		color: options.frame.palette.foreground,
		alpha: 0.9,
	});
	const ink = options.frame.palette.background;
	drawKineticLayoutText({
		options,
		text: {
			text: "MISSING",
			x: 0,
			y: -posterHeight * 0.39,
			size: posterWidth * 0.14,
			color: options.frame.palette.accent,
		},
	});
	const photoWidth = posterWidth * 0.54;
	const photoHeight = posterHeight * 0.42;
	fillHorrorRect({
		options,
		x: -photoWidth / 2,
		y: -posterHeight * 0.29,
		width: photoWidth,
		height: photoHeight,
		color: ink,
		alpha: 0.76,
	});
	drawKineticLayoutText({
		options,
		text: {
			text: "?",
			x: 0,
			y: -posterHeight * 0.08,
			size: photoHeight * 0.58,
			alpha: 0.46,
			color: options.frame.palette.secondary,
		},
	});
	const nameSize = fitKineticText({
		text: options.frame.cut?.text ?? "",
		width: posterWidth * 0.82,
		height: posterHeight * 0.09,
		maxSize: posterWidth * 0.12,
	});
	drawKineticLayoutText({
		options,
		text: {
			text: options.frame.cut?.text ?? "",
			x: 0,
			y: posterHeight * 0.2,
			size: nameSize,
			color: ink,
			maxWidth: posterWidth * 0.82,
		},
	});
	drawKineticLayoutText({
		options,
		text: {
			text: `LAST SEEN ${horrorDate(options)} ${horrorTime(options).slice(0, 5)}`,
			x: 0,
			y: posterHeight * 0.29,
			size: Math.max(9, posterWidth * 0.032),
			color: ink,
			alpha: 0.72,
		},
	});
	const tabY = posterHeight * 0.38;
	const tabWidth = posterWidth / 7;
	for (let index = 0; index < 7; index += 1) {
		if (horrorRandom({ options, salt: 520 + index }) < 0.16) continue;
		fillHorrorRect({
			options,
			x: -posterWidth / 2 + index * tabWidth,
			y: tabY,
			width: 1,
			height: posterHeight * 0.11,
			color: ink,
			alpha: 0.45,
		});
		options.ctx.save();
		options.ctx.translate(
			-posterWidth / 2 + (index + 0.5) * tabWidth,
			tabY + posterHeight * 0.055,
		);
		options.ctx.rotate(-Math.PI / 2);
		drawKineticLayoutText({
			options,
			text: {
				text: `TEL 0${10 + index}-000${index}`,
				x: 0,
				y: 0,
				size: Math.max(7, tabWidth * 0.22),
				color: ink,
				alpha: 0.68,
			},
		});
		options.ctx.restore();
	}
	options.ctx.restore();
}
