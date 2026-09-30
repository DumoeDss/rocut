import type { TypographyLayoutOptions } from "./typography-layout-types";

export function drawEditorialTypographyLayout(
	options: TypographyLayoutOptions,
): boolean {
	switch (options.frame.cut?.preset.layout) {
		case "tyKeySplit":
			drawKeySplit(options);
			return true;
		case "tyCropGiant":
			drawCropGiant(options);
			return true;
		case "tyCross":
			drawCross(options);
			return true;
		case "tyScaleSteps":
			drawScaleSteps(options);
			return true;
		case "tyJustify":
			drawJustify(options);
			return true;
		case "tyIndexTable":
			drawIndexTable(options);
			return true;
		case "tyStatCount":
			drawStatCount(options);
			return true;
		case "tyLineFocus":
			drawLineFocus(options);
			return true;
		default:
			return false;
	}
}

function drawKeySplit({
	ctx,
	drawText,
	frame,
	height,
	setFontSize,
	width,
}: TypographyLayoutOptions): void {
	const text = frame.cut?.text ?? "";
	const { before, key, after } = splitAtKey(text);
	const portrait = height > width;
	const bigSize = Math.max(
		24,
		Math.min(
			portrait ? width * 0.5 : height * 0.52,
			(width * 0.42) / Math.max(1, glyphs(key).length * 0.62),
		),
	);
	const keyWidth = estimateTextWidth({ text: key, size: bigSize });
	const smallSize = Math.max(16, Math.min(bigSize * 0.28, height * 0.14));
	const gap = bigSize * 0.14;
	const centerX = width / 2;
	const centerY = height / 2;

	ctx.fillStyle = frame.palette.accent;
	ctx.textAlign = "center";
	setFontSize(bigSize);
	drawText({
		text: key,
		x: centerX,
		y: centerY,
		maxWidth: portrait ? width * 0.78 : width * 0.45,
		size: bigSize,
	});

	setFontSize(smallSize);
	ctx.fillStyle = frame.palette.foreground;
	if (portrait) {
		if (before) {
			ctx.textAlign = "left";
			drawText({
				text: before,
				x: width * 0.1,
				y: centerY - bigSize / 2 - gap,
				maxWidth: width * 0.8,
				size: smallSize,
			});
		}
		if (after) {
			ctx.textAlign = "right";
			drawText({
				text: after,
				x: width * 0.9,
				y: centerY + bigSize / 2 + gap,
				maxWidth: width * 0.8,
				size: smallSize,
			});
		}
	} else {
		if (before) {
			ctx.textAlign = "right";
			drawText({
				text: before,
				x: centerX - keyWidth / 2 - gap,
				y: centerY - bigSize * 0.22,
				maxWidth: width * 0.24,
				size: smallSize,
			});
		}
		if (after) {
			ctx.textAlign = "left";
			drawText({
				text: after,
				x: centerX + keyWidth / 2 + gap,
				y: centerY + bigSize * 0.22,
				maxWidth: width * 0.24,
				size: smallSize,
			});
		}
	}

	ctx.fillStyle = frame.palette.secondary;
	const rule = Math.max(1, Math.min(width, height) * 0.0015);
	ctx.fillRect(width * 0.08, centerY + bigSize * 0.58, width * 0.84, rule);
}

function drawCropGiant({
	ctx,
	drawText,
	frame,
	height,
	setFontSize,
	width,
}: TypographyLayoutOptions): void {
	const cut = frame.cut;
	if (!cut) return;
	const portrait = height > width;
	const lowEdge = Math.abs(cut.seed) % 2 === 0;
	const giantSize = Math.max(36, portrait ? width * 0.62 : height * 0.66);
	const baseAlpha = ctx.globalAlpha;

	ctx.globalAlpha = baseAlpha * 0.2;
	ctx.fillStyle = frame.palette.secondary;
	ctx.textAlign = "center";
	setFontSize(giantSize);
	drawText({
		text: glyphs(cut.text).join(""),
		x: portrait
			? lowEdge
				? width + giantSize * 0.04
				: -giantSize * 0.04
			: width / 2,
		y: portrait
			? height / 2
			: lowEdge
				? height + giantSize * 0.06
				: -giantSize * 0.06,
		maxWidth: portrait ? giantSize * 1.1 : width * 0.94,
		size: giantSize,
	});
	ctx.globalAlpha = baseAlpha;

	const lines = wrapText({ text: cut.text, lineCount: portrait ? 3 : 2 });
	const size = Math.max(
		18,
		Math.min(
			portrait ? width * 0.16 : height * 0.16,
			(width * 0.66) /
				Math.max(
					1,
					Math.max(...lines.map((line) => glyphs(line).length)) * 0.65,
				),
		),
	);
	const x = width * 0.08;
	const startY = lowEdge ? height * 0.28 : height * 0.62;
	ctx.textAlign = "left";
	ctx.fillStyle = frame.palette.foreground;
	setFontSize(size);
	for (const [index, line] of lines.entries()) {
		drawText({
			text: line,
			x,
			y: startY + index * size * 1.18,
			maxWidth: width * 0.72,
			size,
		});
	}
	ctx.fillStyle = frame.palette.accent;
	ctx.fillRect(
		x,
		startY - size * 0.9,
		Math.min(width * 0.2, size * 2.8),
		Math.max(2, size * 0.05),
	);
}

function drawCross({
	ctx,
	drawText,
	frame,
	height,
	setFontSize,
	width,
}: TypographyLayoutOptions): void {
	const { before, key, after } = splitAtKey(frame.cut?.text ?? "");
	const arms = Math.max(glyphs(before).length, glyphs(after).length, 1);
	const size = Math.max(
		18,
		Math.min(height * 0.16, width / Math.max(7, arms * 2.6)),
	);
	const centerX = width / 2;
	const centerY = height / 2;
	const rule = Math.max(1, Math.min(width, height) * 0.0015);

	ctx.fillStyle = frame.palette.secondary;
	ctx.fillRect(width * 0.08, centerY - rule / 2, width * 0.84, rule);
	ctx.fillRect(centerX - rule / 2, height * 0.08, rule, height * 0.84);

	setFontSize(size);
	ctx.fillStyle = frame.palette.foreground;
	if (before) {
		ctx.textAlign = "right";
		drawText({
			text: before,
			x: centerX - size * 0.75,
			y: centerY,
			maxWidth: width * 0.38,
			size,
		});
		drawVerticalGlyphs({
			ctx,
			drawText,
			setFontSize,
			text: before,
			x: centerX,
			y: centerY - size * 0.8,
			size,
			direction: -1,
		});
	}
	if (after) {
		ctx.textAlign = "left";
		drawText({
			text: after,
			x: centerX + size * 0.75,
			y: centerY,
			maxWidth: width * 0.38,
			size,
		});
		drawVerticalGlyphs({
			ctx,
			drawText,
			setFontSize,
			text: after,
			x: centerX,
			y: centerY + size * 0.8,
			size,
			direction: 1,
		});
	}
	ctx.textAlign = "center";
	ctx.fillStyle = frame.palette.accent;
	setFontSize(size * 1.25);
	drawText({
		text: key,
		x: centerX,
		y: centerY,
		maxWidth: size * 1.4,
		size: size * 1.25,
	});
}

function drawScaleSteps({
	ctx,
	drawText,
	frame,
	height,
	setFontSize,
	width,
}: TypographyLayoutOptions): void {
	const units = scaleUnits(frame.cut?.text ?? "");
	if (units.length === 0) return;
	const factors = units.map((_, index) =>
		units.length === 1 ? 1 : 0.58 + (index / (units.length - 1)) * 0.82,
	);
	const totalFactorWidth = factors.reduce(
		(total, factor, index) =>
			total + factor * Math.max(0.8, glyphs(units[index]).length * 0.62),
		0,
	);
	const baseSize = Math.max(
		16,
		Math.min(height * 0.24, (width * 0.82) / Math.max(1, totalFactorWidth)),
	);
	const baseline = height / 2 + baseSize * Math.max(...factors) * 0.3;
	let x = width * 0.09;

	ctx.textAlign = "left";
	for (const [index, unit] of units.entries()) {
		const size = baseSize * factors[index];
		setFontSize(size);
		ctx.fillStyle =
			index === units.length - 1
				? frame.palette.accent
				: frame.palette.foreground;
		drawText({
			text: unit,
			x,
			y: baseline - size * 0.12,
			maxWidth: width * 0.3,
			size,
		});
		x += estimateTextWidth({ text: unit, size }) + baseSize * 0.12;
	}
	ctx.fillStyle = frame.palette.secondary;
	ctx.fillRect(
		width * 0.09,
		baseline + baseSize * 0.18,
		Math.min(width * 0.82, x - width * 0.09),
		Math.max(1, baseSize * 0.025),
	);
}

function drawJustify({
	ctx,
	drawText,
	frame,
	height,
	setFontSize,
	width,
}: TypographyLayoutOptions): void {
	const count = glyphs(frame.cut?.text ?? "").length;
	const lines = wrapText({
		text: frame.cut?.text ?? "",
		lineCount: count <= 5 ? 2 : count <= 10 ? 3 : 4,
	});
	const targetWidth = Math.min(width * 0.68, height * 1.16);
	const sizes = lines.map((line) =>
		Math.max(
			16,
			Math.min(
				height * 0.28,
				targetWidth / Math.max(1, glyphs(line).length * 0.62),
			),
		),
	);
	const totalHeight = sizes.reduce((total, size) => total + size * 1.08, 0);
	let y = height / 2 - totalHeight / 2;
	ctx.textAlign = "center";
	for (const [index, line] of lines.entries()) {
		const size = sizes[index];
		y += size / 2;
		setFontSize(size);
		ctx.fillStyle =
			index === 1 && lines.length > 2
				? frame.palette.accent
				: frame.palette.foreground;
		drawText({
			text: line,
			x: width / 2,
			y,
			maxWidth: targetWidth,
			size,
		});
		if (index < lines.length - 1) {
			ctx.fillStyle = frame.palette.secondary;
			ctx.fillRect(
				width / 2 - targetWidth / 2,
				y + size * 0.58,
				targetWidth,
				Math.max(1, size * 0.022),
			);
		}
		y += size * 0.58;
	}
}

function drawIndexTable({
	ctx,
	drawText,
	frame,
	height,
	setFontSize,
	width,
}: TypographyLayoutOptions): void {
	const items = glyphs(frame.cut?.text ?? "").slice(0, 9);
	if (items.length === 0) return;
	const tableWidth = Math.min(width * 0.76, height * 1.35);
	const left = width / 2 - tableWidth / 2;
	const right = width / 2 + tableWidth / 2;
	const rowHeight = Math.min(
		(height * 0.76) / items.length,
		Math.min(width, height) * 0.18,
	);
	const top = height / 2 - (rowHeight * items.length) / 2;
	const rule = Math.max(1, Math.min(width, height) * 0.0015);

	for (const [index, character] of items.entries()) {
		const y = top + (index + 0.5) * rowHeight;
		ctx.textAlign = "left";
		ctx.fillStyle =
			index === 0 ? frame.palette.accent : frame.palette.secondary;
		setFontSize(Math.max(12, rowHeight * 0.27));
		drawText({
			text: String(index + 1).padStart(2, "0"),
			x: left,
			y,
			maxWidth: rowHeight,
			size: Math.max(12, rowHeight * 0.27),
		});
		ctx.fillStyle = frame.palette.foreground;
		setFontSize(rowHeight * 0.72);
		drawText({
			text: character,
			x: left + tableWidth * 0.22,
			y,
			maxWidth: rowHeight,
			size: rowHeight * 0.72,
		});
		const code = `U+${character.codePointAt(0)?.toString(16).toUpperCase().padStart(4, "0")}`;
		ctx.textAlign = "right";
		ctx.fillStyle = frame.palette.secondary;
		setFontSize(Math.max(12, rowHeight * 0.24));
		drawText({
			text: code,
			x: right,
			y,
			maxWidth: tableWidth * 0.36,
			size: Math.max(12, rowHeight * 0.24),
		});
		ctx.fillStyle = frame.palette.secondary;
		ctx.fillRect(
			left,
			top + (index + 1) * rowHeight - rule / 2,
			tableWidth,
			rule,
		);
	}
	ctx.fillStyle = frame.palette.foreground;
	ctx.fillRect(left, top - rule, tableWidth, rule * 2);
}

function drawStatCount({
	ctx,
	drawText,
	frame,
	height,
	setFontSize,
	width,
}: TypographyLayoutOptions): void {
	const text = frame.cut?.text ?? "";
	const count = glyphs(text).length;
	const lines = wrapText({ text, lineCount: count > 8 ? 2 : 1 });
	const longest = Math.max(...lines.map((line) => glyphs(line).length));
	const textSize = Math.max(
		18,
		Math.min(height * 0.18, (width * 0.48) / Math.max(1, longest * 0.64)),
	);
	const dividerX = width * 0.64;

	ctx.textAlign = "left";
	ctx.fillStyle = frame.palette.foreground;
	setFontSize(textSize);
	const startY = height / 2 - ((lines.length - 1) * textSize * 1.18) / 2;
	for (const [index, line] of lines.entries()) {
		drawText({
			text: line,
			x: width * 0.08,
			y: startY + index * textSize * 1.18,
			maxWidth: width * 0.5,
			size: textSize,
		});
	}
	ctx.fillStyle = frame.palette.secondary;
	ctx.fillRect(
		dividerX,
		height * 0.25,
		Math.max(1, width * 0.0015),
		height * 0.5,
	);

	const countSize = Math.max(30, height * 0.24);
	ctx.fillStyle = frame.palette.accent;
	setFontSize(countSize);
	drawText({
		text: String(count).padStart(2, "0"),
		x: dividerX + width * 0.04,
		y: height * 0.46,
		maxWidth: width * 0.24,
		size: countSize,
	});
	ctx.fillStyle = frame.palette.secondary;
	setFontSize(Math.max(12, height * 0.045));
	drawText({
		text: "CHARACTERS",
		x: dividerX + width * 0.04,
		y: height * 0.64,
		maxWidth: width * 0.25,
		size: Math.max(12, height * 0.045),
	});
}

function drawLineFocus({
	ctx,
	drawText,
	frame,
	height,
	setFontSize,
	width,
}: TypographyLayoutOptions): void {
	const text = frame.cut?.text ?? "";
	const characters = Array.from(text.trim());
	if (characters.length === 0) return;
	const focus = focusRange(text);
	const size = Math.max(
		18,
		Math.min(
			height * 0.12,
			(width * 0.8) / Math.max(1, characters.length * 0.7),
		),
	);
	const step = Math.min(
		size * 0.72,
		(width * 0.78) / Math.max(1, characters.length),
	);
	const startX = width / 2 - ((characters.length - 1) * step) / 2;
	const baseAlpha = ctx.globalAlpha;
	let focusStart = Number.POSITIVE_INFINITY;
	let focusEnd = Number.NEGATIVE_INFINITY;

	ctx.textAlign = "center";
	setFontSize(size);
	for (const [index, character] of characters.entries()) {
		const x = startX + index * step;
		const focused = index >= focus.start && index < focus.end;
		ctx.globalAlpha = focused ? baseAlpha : baseAlpha * 0.36;
		ctx.fillStyle = focused
			? frame.palette.foreground
			: frame.palette.secondary;
		drawText({
			text: character,
			x,
			y: height / 2,
			maxWidth: step * 1.15,
			size,
		});
		if (focused) {
			focusStart = Math.min(focusStart, x - step * 0.45);
			focusEnd = Math.max(focusEnd, x + step * 0.45);
		}
	}
	ctx.globalAlpha = baseAlpha;
	if (Number.isFinite(focusStart) && Number.isFinite(focusEnd)) {
		ctx.fillStyle = frame.palette.accent;
		ctx.fillRect(
			focusStart,
			height / 2 + size * 0.62,
			focusEnd - focusStart,
			Math.max(3, size * 0.07),
		);
	}
}

function drawVerticalGlyphs({
	ctx,
	direction,
	drawText,
	setFontSize,
	size,
	text,
	x,
	y,
}: {
	readonly ctx: TypographyLayoutOptions["ctx"];
	readonly direction: -1 | 1;
	readonly drawText: TypographyLayoutOptions["drawText"];
	readonly setFontSize: TypographyLayoutOptions["setFontSize"];
	readonly size: number;
	readonly text: string;
	readonly x: number;
	readonly y: number;
}): void {
	const characters = glyphs(text);
	ctx.textAlign = "center";
	setFontSize(size);
	for (const [index, character] of characters.entries()) {
		drawText({
			text: character,
			x,
			y: y + direction * index * size * 0.92,
			maxWidth: size * 1.1,
			size,
		});
	}
}

function splitAtKey(text: string): {
	readonly before: string;
	readonly key: string;
	readonly after: string;
} {
	const normalized = text.trim().replace(/\s+/gu, " ");
	const words = normalized.split(" ");
	if (words.length > 1) {
		let keyIndex = 0;
		for (let index = 1; index < words.length; index += 1) {
			if (glyphs(words[index]).length > glyphs(words[keyIndex]).length) {
				keyIndex = index;
			}
		}
		return {
			before: words.slice(0, keyIndex).join(" "),
			key: words[keyIndex] || "?",
			after: words.slice(keyIndex + 1).join(" "),
		};
	}
	const characters = glyphs(normalized);
	const hanIndex = characters.findIndex((character) =>
		/\p{Script=Han}/u.test(character),
	);
	const keyIndex =
		hanIndex >= 0 ? hanIndex : Math.floor((characters.length - 1) / 2);
	return {
		before: characters.slice(0, keyIndex).join(""),
		key: characters[keyIndex] ?? "?",
		after: characters.slice(keyIndex + 1).join(""),
	};
}

function focusRange(text: string): {
	readonly start: number;
	readonly end: number;
} {
	const normalized = text.trim();
	const words = [...normalized.matchAll(/\S+/gu)];
	if (words.length > 1) {
		let focus = words[0];
		for (const word of words.slice(1)) {
			if (glyphs(word[0]).length > glyphs(focus[0]).length) focus = word;
		}
		const start = Array.from(normalized.slice(0, focus.index)).length;
		return { start, end: start + Array.from(focus[0]).length };
	}
	const characters = Array.from(normalized);
	const start = Math.max(0, Math.floor((characters.length - 1) / 2));
	return { start, end: start + 1 };
}

function scaleUnits(text: string): string[] {
	const normalized = text.trim().replace(/\s+/gu, " ");
	const words = normalized.split(" ").filter(Boolean);
	if (words.length >= 2 && words.length <= 7) return words;
	const characters = glyphs(normalized);
	if (characters.length <= 7) return characters;
	const unitLength = Math.ceil(characters.length / 5);
	const units: string[] = [];
	for (let index = 0; index < characters.length; index += unitLength) {
		units.push(characters.slice(index, index + unitLength).join(""));
	}
	return units;
}

function wrapText({
	lineCount,
	text,
}: {
	readonly lineCount: number;
	readonly text: string;
}): string[] {
	const normalized = text.trim().replace(/\s+/gu, " ");
	if (lineCount <= 1 || normalized.length === 0) return [normalized];
	const words = normalized.split(" ");
	if (words.length > 1) {
		const lines: string[] = [];
		let index = 0;
		for (let line = 0; line < lineCount && index < words.length; line += 1) {
			const take = Math.max(
				1,
				Math.ceil((words.length - index) / (lineCount - line)),
			);
			lines.push(words.slice(index, index + take).join(" "));
			index += take;
		}
		return lines;
	}
	const characters = Array.from(normalized);
	const length = Math.ceil(characters.length / lineCount);
	const lines: string[] = [];
	for (let index = 0; index < characters.length; index += length) {
		lines.push(characters.slice(index, index + length).join(""));
	}
	return lines;
}

function estimateTextWidth({
	size,
	text,
}: {
	readonly size: number;
	readonly text: string;
}): number {
	return Array.from(text).reduce(
		(width, character) => width + size * (/\s/u.test(character) ? 0.34 : 0.62),
		0,
	);
}

function glyphs(text: string): string[] {
	return Array.from(text).filter((character) => !/\s/u.test(character));
}
