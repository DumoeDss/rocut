import type { TypographyLayoutOptions } from "./typography-layout-types";

export function drawGraphicTypographyLayout(
	options: TypographyLayoutOptions,
): boolean {
	switch (options.frame.cut?.preset.layout) {
		case "tyBandHide":
			drawBandHide(options);
			return true;
		case "tyRuby":
			drawRuby(options);
			return true;
		case "tySplitType":
			drawSplitType(options);
			return true;
		case "tyErode":
			drawErode(options);
			return true;
		case "tyVRuler":
			drawVerticalRuler(options);
			return true;
		case "tyRotBlock":
			drawRotatedBlock(options);
			return true;
		default:
			return false;
	}
}

function drawBandHide({
	ctx,
	drawText,
	frame,
	height,
	setFontSize,
	width,
}: TypographyLayoutOptions): void {
	const cut = frame.cut;
	if (!cut) return;
	const lines = wrapText({
		text: cut.text,
		lineCount: glyphs(cut.text).length > 8 ? 2 : 1,
	});
	const longest = Math.max(...lines.map((line) => glyphs(line).length));
	const size = Math.max(
		20,
		Math.min(
			height * 0.26,
			(width * 0.78) / Math.max(1, longest * 0.64),
			height / Math.max(2.8, lines.length * 1.4),
		),
	);
	const lineGap = size * 1.32;
	const firstY = height / 2 - ((lines.length - 1) * lineGap) / 2;
	const reveal = Math.min(1, 0.28 + frame.progress * 2.4);
	const bandHeight = size * 0.38;

	ctx.textAlign = "center";
	ctx.fillStyle = frame.palette.foreground;
	setFontSize(size);
	for (const [index, line] of lines.entries()) {
		const y = firstY + index * lineGap;
		drawText({ text: line, x: width / 2, y, maxWidth: width * 0.8, size });

		const direction = index % 2 === 0 ? 1 : -1;
		const bandWidth = width * reveal;
		const x = direction > 0 ? 0 : width - bandWidth;
		const bandY = y + size * 0.1;
		ctx.fillStyle = frame.palette.accent;
		ctx.fillRect(x, bandY, bandWidth, bandHeight);

		ctx.save();
		ctx.beginPath();
		ctx.rect(x, bandY, bandWidth, bandHeight);
		ctx.clip();
		const caption = `${cut.text.trim()} / `;
		const captionSize = Math.max(11, bandHeight * 0.44);
		const captionWidth = Math.max(
			captionSize * 3,
			estimateTextWidth({ text: caption, size: captionSize }),
		);
		const offset =
			(frame.progress * captionWidth * 3 * direction) % captionWidth;
		ctx.textAlign = "left";
		ctx.fillStyle = frame.palette.background;
		setFontSize(captionSize);
		drawText({
			text: caption.repeat(Math.ceil(width / captionWidth) + 3),
			x: -captionWidth + offset,
			y: bandY + bandHeight / 2,
			maxWidth: width * 2,
			size: captionSize,
		});
		ctx.restore();
	}
}

function drawRuby({
	ctx,
	drawText,
	frame,
	height,
	setFontSize,
	width,
}: TypographyLayoutOptions): void {
	const characters = glyphs(frame.cut?.text ?? "").slice(0, 14);
	if (characters.length === 0) return;
	const size = Math.max(
		20,
		Math.min(
			height * 0.19,
			(width * 0.82) / Math.max(1, characters.length * 0.82),
		),
	);
	const step = Math.min(size * 1.05, (width * 0.82) / characters.length);
	const startX = width / 2 - ((characters.length - 1) * step) / 2;
	const rubySize = Math.max(10, size * 0.27);
	const rule = Math.max(1, Math.min(width, height) * 0.0015);

	ctx.textAlign = "center";
	for (const [index, character] of characters.entries()) {
		const x = startX + index * step;
		ctx.fillStyle = frame.palette.foreground;
		setFontSize(size);
		drawText({ text: character, x, y: height / 2, maxWidth: step, size });

		const reading = romanizeKana(character);
		if (reading) {
			ctx.fillStyle = frame.palette.secondary;
			setFontSize(rubySize);
			drawText({
				text: reading,
				x,
				y: height / 2 - size * 0.78,
				maxWidth: step * 1.05,
				size: rubySize,
			});
		} else if (/\p{Script=Han}/u.test(character)) {
			ctx.fillStyle = frame.palette.accent;
			ctx.fillRect(
				x - step * 0.28,
				height / 2 - size * 0.82,
				step * 0.56,
				rule * 2,
			);
		}

		ctx.fillStyle = frame.palette.secondary;
		setFontSize(rubySize * 0.82);
		drawText({
			text: String(index + 1).padStart(2, "0"),
			x,
			y: height / 2 + size * 0.78,
			maxWidth: step,
			size: rubySize * 0.82,
		});
		ctx.fillRect(x - rule / 2, height / 2 + size * 0.56, rule, size * 0.16);
	}
}

function drawSplitType({
	ctx,
	drawText,
	frame,
	height,
	setFontSize,
	width,
}: TypographyLayoutOptions): void {
	const text = frame.cut?.text.trim() ?? "";
	const lines = wrapText({
		text,
		lineCount: glyphs(text).length > 10 ? 2 : 1,
	});
	const longest = Math.max(...lines.map((line) => glyphs(line).length));
	const size = Math.max(
		22,
		Math.min(
			height * 0.28,
			(width * 0.76) / Math.max(1, longest * 0.64),
			height / Math.max(2.6, lines.length * 1.2),
		),
	);
	const offset = size * (0.08 + (Math.abs(frame.cut?.seed ?? 0) % 5) * 0.012);
	const splitY = height / 2 + size * 0.04;

	ctx.textAlign = "center";
	ctx.fillStyle = frame.palette.foreground;
	setFontSize(size);
	ctx.save();
	ctx.beginPath();
	ctx.rect(0, 0, width, splitY);
	ctx.clip();
	drawMultiline({
		drawText,
		lines,
		maxWidth: width * 0.78,
		size,
		x: width / 2 + offset,
		y: height / 2 - size * 0.03,
	});
	ctx.restore();

	ctx.save();
	ctx.beginPath();
	ctx.rect(0, splitY, width, height - splitY);
	ctx.clip();
	drawMultiline({
		drawText,
		lines,
		maxWidth: width * 0.78,
		size,
		x: width / 2 - offset,
		y: height / 2 + size * 0.03,
	});
	ctx.restore();

	ctx.fillStyle = frame.palette.accent;
	ctx.fillRect(
		width * 0.04,
		splitY - 1,
		width * 0.92,
		Math.max(2, size * 0.025),
	);
}

function drawErode({
	ctx,
	drawText,
	frame,
	height,
	setFontSize,
	width,
}: TypographyLayoutOptions): void {
	const characters = glyphs(frame.cut?.text ?? "");
	if (characters.length === 0) return;
	const rowCount = Math.min(5, Math.max(2, characters.length));
	const rowTexts: string[] = [];
	for (let row = 0; row < rowCount; row += 1) {
		const length = Math.max(
			1,
			Math.round((characters.length * (row + 1)) / rowCount),
		);
		const value = characters.slice(0, length).join("");
		if (!rowTexts.includes(value)) rowTexts.push(value);
	}
	const size = Math.max(
		18,
		Math.min(
			height / Math.max(3, rowTexts.length * 1.36),
			(width * 0.7) / Math.max(1, characters.length * 0.64),
		),
	);
	const fullWidth = estimateTextWidth({ text: characters.join(""), size });
	const left = width / 2 - fullWidth / 2;
	const firstY = height / 2 - ((rowTexts.length - 1) * size * 1.34) / 2;
	const baseAlpha = ctx.globalAlpha;

	ctx.textAlign = "left";
	setFontSize(size);
	for (const [index, rowText] of rowTexts.entries()) {
		const main = index === rowTexts.length - 1;
		ctx.globalAlpha = main
			? baseAlpha
			: baseAlpha * (0.28 + (index / Math.max(1, rowTexts.length - 1)) * 0.38);
		ctx.fillStyle = main ? frame.palette.foreground : frame.palette.secondary;
		const y = firstY + index * size * 1.34;
		drawText({ text: rowText, x: left, y, maxWidth: width * 0.72, size });
		ctx.globalAlpha = baseAlpha;
		ctx.fillStyle = main ? frame.palette.accent : frame.palette.secondary;
		setFontSize(Math.max(11, size * 0.32));
		drawText({
			text: String(glyphs(rowText).length).padStart(2, "0"),
			x: left + fullWidth + size * 0.4,
			y,
			maxWidth: size,
			size: Math.max(11, size * 0.32),
		});
		setFontSize(size);
	}
	ctx.globalAlpha = baseAlpha;
}

function drawVerticalRuler({
	ctx,
	drawText,
	frame,
	height,
	setFontSize,
	width,
}: TypographyLayoutOptions): void {
	const characters = glyphs(frame.cut?.text ?? "").slice(0, 12);
	if (characters.length === 0) return;
	const size = Math.max(
		18,
		Math.min(width * 0.16, (height * 0.72) / Math.max(1, characters.length)),
	);
	const step = Math.min(size * 1.18, (height * 0.72) / characters.length);
	const side = Math.abs(frame.cut?.seed ?? 0) % 2 === 0 ? 1 : -1;
	const textX = width / 2 - side * size * 0.8;
	const rulerX = textX + side * size * 0.88;
	const firstY = height / 2 - ((characters.length - 1) * step) / 2;
	const lastY = firstY + (characters.length - 1) * step;
	const rule = Math.max(1, Math.min(width, height) * 0.0015);

	ctx.fillStyle = frame.palette.secondary;
	ctx.fillRect(
		rulerX - rule / 2,
		firstY - size * 0.58,
		rule,
		lastY - firstY + size * 1.16,
	);
	ctx.textAlign = "center";
	for (const [index, character] of characters.entries()) {
		const y = firstY + index * step;
		ctx.fillStyle = frame.palette.foreground;
		setFontSize(size);
		drawText({ text: character, x: textX, y, maxWidth: size, size });
		ctx.fillStyle = frame.palette.secondary;
		const tickWidth = size * (index % 2 === 0 ? 0.32 : 0.16);
		ctx.fillRect(
			side > 0 ? rulerX : rulerX - tickWidth,
			y - rule / 2,
			tickWidth,
			rule,
		);
		ctx.textAlign = side > 0 ? "left" : "right";
		setFontSize(Math.max(10, size * 0.22));
		drawText({
			text: String(index + 1).padStart(2, "0"),
			x: rulerX + side * size * 0.42,
			y,
			maxWidth: size,
			size: Math.max(10, size * 0.22),
		});
		ctx.textAlign = "center";
	}
	const playheadY = firstY + (lastY - firstY) * frame.progress;
	ctx.fillStyle = frame.palette.accent;
	ctx.fillRect(
		side > 0 ? rulerX - size * 0.18 : rulerX,
		playheadY - size * 0.08,
		size * 0.18,
		size * 0.16,
	);
}

function drawRotatedBlock({
	ctx,
	drawText,
	frame,
	height,
	setFontSize,
	width,
}: TypographyLayoutOptions): void {
	const text = frame.cut?.text.trim() ?? "";
	const split = splitRotatedText(text);
	const rotatedSize = Math.max(
		14,
		Math.min(
			height * 0.1,
			(height * 0.48) / Math.max(1, glyphs(split.rotated).length * 0.62),
		),
	);
	const mainLines = wrapText({
		text: split.main,
		lineCount: glyphs(split.main).length > 10 ? 2 : 1,
	});
	const longestMain = Math.max(...mainLines.map((line) => glyphs(line).length));
	const mainSize = Math.max(
		20,
		Math.min(height * 0.24, (width * 0.58) / Math.max(1, longestMain * 0.64)),
	);
	const dividerX = width * 0.28;
	const rotation =
		Math.abs(frame.cut?.seed ?? 0) % 2 === 0 ? Math.PI / 2 : -Math.PI / 2;

	ctx.save();
	ctx.translate(width * 0.18, height / 2);
	ctx.rotate(rotation);
	ctx.textAlign = "center";
	ctx.fillStyle = frame.palette.accent;
	setFontSize(rotatedSize);
	drawText({
		text: split.rotated,
		x: 0,
		y: 0,
		maxWidth: height * 0.52,
		size: rotatedSize,
	});
	ctx.restore();

	ctx.fillStyle = frame.palette.secondary;
	ctx.fillRect(
		dividerX,
		height * 0.2,
		Math.max(1, width * 0.0015),
		height * 0.6,
	);
	ctx.textAlign = "left";
	ctx.fillStyle = frame.palette.foreground;
	setFontSize(mainSize);
	drawMultiline({
		drawText,
		lines: mainLines,
		maxWidth: width * 0.6,
		size: mainSize,
		x: dividerX + width * 0.05,
		y: height / 2,
	});
}

function drawMultiline({
	drawText,
	lines,
	maxWidth,
	size,
	x,
	y,
}: {
	readonly drawText: TypographyLayoutOptions["drawText"];
	readonly lines: readonly string[];
	readonly maxWidth: number;
	readonly size: number;
	readonly x: number;
	readonly y: number;
}): void {
	const firstY = y - ((lines.length - 1) * size * 1.18) / 2;
	for (const [index, line] of lines.entries()) {
		drawText({
			text: line,
			x,
			y: firstY + index * size * 1.18,
			maxWidth,
			size,
		});
	}
}

function splitRotatedText(text: string): {
	readonly main: string;
	readonly rotated: string;
} {
	const normalized = text.trim().replace(/\s+/gu, " ");
	const words = normalized.split(" ");
	if (words.length > 1) {
		return {
			rotated: words[0],
			main: words.slice(1).join(" "),
		};
	}
	const characters = glyphs(normalized);
	const split = Math.max(1, Math.round(characters.length * 0.36));
	return {
		rotated: characters.slice(0, split).join(""),
		main: characters.slice(split).join("") || characters.join(""),
	};
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

function romanizeKana(character: string): string | null {
	return KANA_ROMAJI[character] ?? null;
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

const KANA_ROMAJI: Readonly<Record<string, string>> = Object.freeze({
	あ: "A",
	い: "I",
	う: "U",
	え: "E",
	お: "O",
	か: "KA",
	き: "KI",
	く: "KU",
	け: "KE",
	こ: "KO",
	さ: "SA",
	し: "SHI",
	す: "SU",
	せ: "SE",
	そ: "SO",
	た: "TA",
	ち: "CHI",
	つ: "TSU",
	て: "TE",
	と: "TO",
	な: "NA",
	に: "NI",
	ぬ: "NU",
	ね: "NE",
	の: "NO",
	は: "HA",
	ひ: "HI",
	ふ: "FU",
	へ: "HE",
	ほ: "HO",
	ま: "MA",
	み: "MI",
	む: "MU",
	め: "ME",
	も: "MO",
	や: "YA",
	ゆ: "YU",
	よ: "YO",
	ら: "RA",
	り: "RI",
	る: "RU",
	れ: "RE",
	ろ: "RO",
	わ: "WA",
	を: "WO",
	ん: "N",
	ア: "A",
	イ: "I",
	ウ: "U",
	エ: "E",
	オ: "O",
	カ: "KA",
	キ: "KI",
	ク: "KU",
	ケ: "KE",
	コ: "KO",
	サ: "SA",
	シ: "SHI",
	ス: "SU",
	セ: "SE",
	ソ: "SO",
	タ: "TA",
	チ: "CHI",
	ツ: "TSU",
	テ: "TE",
	ト: "TO",
	ナ: "NA",
	ニ: "NI",
	ヌ: "NU",
	ネ: "NE",
	ノ: "NO",
	ハ: "HA",
	ヒ: "HI",
	フ: "FU",
	ヘ: "HE",
	ホ: "HO",
	マ: "MA",
	ミ: "MI",
	ム: "MU",
	メ: "ME",
	モ: "MO",
	ヤ: "YA",
	ユ: "YU",
	ヨ: "YO",
	ラ: "RA",
	リ: "RI",
	ル: "RU",
	レ: "RE",
	ロ: "RO",
	ワ: "WA",
	ヲ: "WO",
	ン: "N",
});
