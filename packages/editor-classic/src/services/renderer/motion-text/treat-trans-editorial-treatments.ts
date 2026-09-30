import {
	clamp01,
	drawCircle,
	drawTreatGlyph,
	drawTreatText,
	paletteMix,
	treatBounds,
	treatRandom,
	treatRandomSigned,
	treatTransGlyphs,
	type TreatTransTreatmentDraw,
	withRectClip,
} from "./treat-trans-drawing";

const EDITORIAL_TREATMENTS = new Set([
	"kerningWide",
	"monoGrid",
	"outlineOffset",
	"toneShadow",
	"fadeChars",
	"cutShift",
	"focusPull",
	"spotChar",
	"ransom",
]);

export function drawTreatTransEditorialTreatment(
	options: TreatTransTreatmentDraw,
): boolean {
	const treat = options.frame.cut?.preset.treat;
	if (!treat || !EDITORIAL_TREATMENTS.has(treat)) return false;
	switch (treat) {
		case "kerningWide":
			drawKerningWide(options);
			break;
		case "monoGrid":
			drawMonoGrid(options);
			break;
		case "outlineOffset":
			drawOutlineOffset(options);
			break;
		case "toneShadow":
			drawToneShadow(options);
			break;
		case "fadeChars":
			drawFadeChars(options);
			break;
		case "cutShift":
			drawCutShift(options);
			break;
		case "focusPull":
			drawFocusPull(options);
			break;
		case "spotChar":
			drawSpotChar(options);
			break;
		case "ransom":
			drawRansom(options);
			break;
	}
	return true;
}

function drawKerningWide(options: TreatTransTreatmentDraw): void {
	for (const glyph of treatTransGlyphs(options, 0.42)) {
		drawTreatGlyph({
			...options,
			character: glyph.character,
			color: options.frame.palette.foreground,
			scaleX: 0.86,
			scaleY: 0.86,
			x: glyph.x,
			y: glyph.y,
		});
	}
}

function drawMonoGrid(options: TreatTransTreatmentDraw): void {
	const glyphs = treatTransGlyphs(options, 0.23);
	const cell = options.size * 0.84;
	const line = Math.max(1, options.size * 0.018);
	for (const glyph of glyphs) {
		options.ctx.globalAlpha *= 0.13;
		options.ctx.fillStyle = options.frame.palette.accent;
		options.ctx.fillRect(glyph.x - cell / 2, glyph.y - cell * 0.68, cell, cell);
		options.ctx.globalAlpha /= 0.13;
		options.ctx.fillStyle = paletteMix(
			options,
			options.frame.palette.secondary,
			options.frame.palette.foreground,
			0.35,
		);
		options.ctx.fillRect(glyph.x - cell / 2, glyph.y - cell * 0.68, cell, line);
		options.ctx.fillRect(glyph.x - cell / 2, glyph.y + cell * 0.32, cell, line);
		options.ctx.fillRect(glyph.x - cell / 2, glyph.y - cell * 0.68, line, cell);
		options.ctx.fillRect(
			glyph.x + cell / 2 - line,
			glyph.y - cell * 0.68,
			line,
			cell,
		);
		drawTreatGlyph({
			...options,
			character: glyph.character,
			color: options.frame.palette.foreground,
			scaleX: 0.8,
			scaleY: 0.8,
			x: glyph.x,
			y: glyph.y,
		});
	}
}

function drawOutlineOffset(options: TreatTransTreatmentDraw): void {
	const distance = options.size * 0.07;
	drawTreatText(options, {
		color: options.frame.palette.accent,
		offsetX: distance,
		offsetY: distance * 0.72,
	});
	drawTreatText(options, {
		color: options.frame.palette.background,
		strokeColor: options.frame.palette.foreground,
		strokeWidth: Math.max(1.4, options.size * 0.026),
	});
}

function drawToneShadow(options: TreatTransTreatmentDraw): void {
	const glyphs = treatTransGlyphs(options);
	const dot = Math.max(1.2, options.size * 0.025);
	const offset = options.size * 0.105;
	options.ctx.fillStyle = options.frame.palette.accent;
	for (const glyph of glyphs) {
		for (let row = 0; row < 4; row += 1) {
			for (let column = 0; column < 4; column += 1) {
				if ((row + column + glyph.order) % 2 !== 0) continue;
				options.ctx.fillRect(
					glyph.x - glyph.width * 0.38 + column * glyph.width * 0.23 + offset,
					glyph.y - options.size * 0.46 + row * options.size * 0.23 + offset,
					dot,
					dot,
				);
			}
		}
	}
	drawTreatText(options, { color: options.frame.palette.foreground });
}

function drawFadeChars(options: TreatTransTreatmentDraw): void {
	const glyphs = treatTransGlyphs(options);
	const denominator = Math.max(1, glyphs.length - 1);
	for (const glyph of glyphs) {
		const along = glyph.order / denominator;
		const alpha = 1 - 0.68 * along ** 2;
		drawTreatGlyph({
			...options,
			alpha,
			character: glyph.character,
			color:
				along > 0.68
					? options.frame.palette.secondary
					: options.frame.palette.foreground,
			x: glyph.x,
			y: glyph.y,
		});
	}
}

function drawCutShift(options: TreatTransTreatmentDraw): void {
	const rect = treatBounds(options);
	const cutY = options.y - options.size * 0.04;
	const phase = clamp01((options.frame.progress - 0.08) / 0.38);
	const direction = treatRandom(options, 0, 961) >= 0.5 ? 1 : -1;
	const shift = direction * options.size * 0.145 * phase;
	withRectClip(
		options.ctx,
		[
			rect.left - options.size,
			rect.top,
			rect.width + options.size * 2,
			cutY - rect.top,
		],
		() => drawTreatText(options, { color: options.frame.palette.foreground }),
	);
	withRectClip(
		options.ctx,
		[
			rect.left - options.size,
			cutY,
			rect.width + options.size * 2,
			rect.bottom - cutY,
		],
		() =>
			drawTreatText(options, {
				color: options.frame.palette.foreground,
				offsetX: shift,
			}),
	);
	options.ctx.fillStyle = options.frame.palette.accent;
	options.ctx.globalAlpha *= 0.78 * phase;
	options.ctx.fillRect(
		rect.left - options.size * 0.12,
		cutY,
		rect.width + options.size * 0.24 + shift,
		Math.max(1.2, options.size * 0.018),
	);
}

function drawFocusPull(options: TreatTransTreatmentDraw): void {
	const glyphs = treatTransGlyphs(options);
	const position = -0.15 + 1.3 * options.frame.progress;
	const denominator = Math.max(1, glyphs.length - 1);
	for (const glyph of glyphs) {
		const distance = clamp01(
			Math.abs(glyph.order / denominator - position) * 2.5 - 0.12,
		);
		const softness = options.size * 0.035 * distance;
		if (distance > 0.08) {
			drawTreatGlyph({
				...options,
				alpha: distance * 0.16,
				character: glyph.character,
				color: options.frame.palette.secondary,
				x: glyph.x - softness,
				y: glyph.y + softness * 0.35,
			});
			drawTreatGlyph({
				...options,
				alpha: distance * 0.12,
				character: glyph.character,
				color: options.frame.palette.accent,
				x: glyph.x + softness,
				y: glyph.y - softness * 0.35,
			});
		}
		drawTreatGlyph({
			...options,
			alpha: 1 - distance * 0.42,
			character: glyph.character,
			color:
				distance < 0.2
					? options.frame.palette.accent
					: options.frame.palette.foreground,
			x: glyph.x,
			y: glyph.y,
		});
	}
}

function drawSpotChar(options: TreatTransTreatmentDraw): void {
	const glyphs = treatTransGlyphs(options);
	if (glyphs.length === 0) return;
	const target = Math.floor(treatRandom(options, 0, 971) * glyphs.length);
	for (const glyph of glyphs) {
		const selected = glyph.order === target;
		if (selected) {
			drawCircle(options.ctx, {
				color: options.frame.palette.accent,
				radius: options.size * 0.52,
				x: glyph.x,
				y: glyph.y - options.size * 0.06,
			});
		}
		drawTreatGlyph({
			...options,
			character: glyph.character,
			color: selected
				? options.frame.palette.background
				: options.frame.palette.foreground,
			scaleX: selected ? 1.08 : 1,
			scaleY: selected ? 1.08 : 1,
			x: glyph.x,
			y: glyph.y,
		});
	}
}

function drawRansom(options: TreatTransTreatmentDraw): void {
	const glyphs = treatTransGlyphs(options, 0.2);
	for (const glyph of glyphs) {
		const rotation = treatRandomSigned(options, glyph.order, 981) * 0.14;
		const scale = 0.84 + treatRandom(options, glyph.order, 982) * 0.18;
		const width = Math.max(glyph.width * 1.08, options.size * 0.54);
		const height =
			options.size * (0.82 + treatRandom(options, glyph.order, 983) * 0.16);
		const plate =
			glyph.order % 3 === 0
				? options.frame.palette.accent
				: glyph.order % 3 === 1
					? options.frame.palette.foreground
					: options.frame.palette.secondary;
		options.ctx.save();
		options.ctx.translate(glyph.x, glyph.y - options.size * 0.08);
		options.ctx.rotate(rotation);
		options.ctx.fillStyle = plate;
		options.ctx.fillRect(-width / 2, -height * 0.62, width, height);
		options.ctx.restore();
		drawTreatGlyph({
			...options,
			character: glyph.character,
			color: bestRansomInk(options, plate),
			rotation,
			scaleX: scale,
			scaleY: scale,
			x: glyph.x,
			y: glyph.y,
		});
	}
}

// eslint-disable-next-line opencut/prefer-object-params -- Plate color is the value being evaluated against the treatment palette.
function bestRansomInk(
	options: TreatTransTreatmentDraw,
	plate: string,
): string {
	return plate === options.frame.palette.foreground
		? options.frame.palette.background
		: paletteMix(options, options.frame.palette.background, "#000000", 0.34);
}
