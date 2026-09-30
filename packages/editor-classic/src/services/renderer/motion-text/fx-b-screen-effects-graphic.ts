import {
	fillFxBSource,
	fxBPhase,
	fxBPulse,
	fxBSigned,
	fxBStep,
	fxBUnit,
	type FxBPixelEffectDraw,
} from "./fx-b-screen-effect-types";

const GRAPHIC_EFFECTS = new Set([
	"halftone",
	"duotone",
	"bandInvert",
	"lightRays",
	"anamorphic",
	"dustScratches",
	"focusLines",
	"speedLines",
	"starGlint",
	"colorBars",
	"negativeRing",
]);

export function drawFxBGraphicEffect(options: FxBPixelEffectDraw): boolean {
	if (!GRAPHIC_EFFECTS.has(options.effect)) return false;
	switch (options.effect) {
		case "halftone":
			drawHalftone(options);
			break;
		case "duotone":
			drawDuotone(options);
			break;
		case "bandInvert":
			drawBandInvert(options);
			break;
		case "lightRays":
			drawLightRays(options);
			break;
		case "anamorphic":
			drawAnamorphic(options);
			break;
		case "dustScratches":
			drawDustScratches(options);
			break;
		case "focusLines":
			drawFocusLines(options);
			break;
		case "speedLines":
			drawSpeedLines(options);
			break;
		case "starGlint":
			drawStarGlint(options);
			break;
		case "colorBars":
			drawColorBars(options);
			break;
		case "negativeRing":
			drawNegativeRing(options);
			break;
	}
	return true;
}

function drawHalftone(options: FxBPixelEffectDraw): void {
	const phase = fxBPhase(options);
	const cell = Math.max(
		6,
		Math.round(Math.min(options.width, options.height) / 44),
	);
	const dot = cell * (0.28 + Math.sin(Math.PI * phase) * 0.38);
	options.ctx.globalCompositeOperation = "source-atop";
	options.ctx.globalAlpha = 0.5 + phase * 0.32;
	options.ctx.fillStyle = options.frame.palette.foreground;
	for (let y = 0, row = 0; y < options.height + cell; y += cell, row += 1) {
		for (let x = -cell; x < options.width + cell; x += cell) {
			const shiftedX = x + (row % 2) * (cell / 2);
			options.ctx.fillRect(shiftedX, y, dot, dot);
		}
	}
}

function drawDuotone(options: FxBPixelEffectDraw): void {
	const phase = fxBPhase(options);
	fillFxBSource({
		alpha: 0.48 + phase * 0.18,
		color: options.frame.palette.accent,
		height: options.height,
		options,
		width: options.width,
		x: 0,
		y: 0,
	});
	fillFxBSource({
		alpha: 0.34 + (1 - phase) * 0.18,
		color: options.frame.palette.secondary,
		height: options.height * 0.52,
		options,
		width: options.width,
		x: 0,
		y: options.height * (0.24 + phase * 0.18),
	});
}

function drawBandInvert(options: FxBPixelEffectDraw): void {
	const phase = fxBPhase(options);
	const step = fxBStep(options, 18);
	const vertical = fxBUnit(options, 45_001) < 0.22;
	const count = 3 + (step % 4);
	fillFxBSource({
		alpha: 0.08 + phase * 0.18,
		color: options.frame.palette.accent,
		height: options.height,
		options,
		width: options.width,
		x: 0,
		y: 0,
	});
	for (let band = 0; band < count; band += 1) {
		const salt = step * 71 + band * 11 + 45_100;
		const thickness =
			(vertical ? options.width : options.height) *
			(0.018 + fxBUnit(options, salt) * 0.09);
		const position =
			(vertical ? options.width : options.height) *
			(0.08 + fxBUnit(options, salt + 1) * 0.84);
		fillFxBSource({
			alpha: 0.45 + phase * 0.42,
			color:
				band % 2 === 0
					? options.frame.palette.accent
					: options.frame.palette.secondary,
			height: vertical ? options.height : thickness,
			options,
			width: vertical ? thickness : options.width,
			x: vertical ? position - thickness / 2 : 0,
			y: vertical ? 0 : position - thickness / 2,
		});
	}
}

function drawLightRays(options: FxBPixelEffectDraw): void {
	const phase = fxBPhase(options);
	const pulse = fxBPulse(options);
	const cx = options.width * (0.5 + fxBSigned(options, 45_201) * 0.1);
	const cy = options.height * (0.45 + fxBSigned(options, 45_202) * 0.08);
	const radius =
		Math.hypot(options.width, options.height) * (0.35 + phase * 0.45);
	const rays = 14;
	options.ctx.globalAlpha = 0.08 + pulse * 0.18;
	options.ctx.fillStyle = options.frame.palette.foreground;
	options.ctx.beginPath();
	for (let ray = 0; ray < rays; ray += 1) {
		const angle = (ray / rays) * Math.PI * 2 + phase * 0.28;
		const width = 0.025 + fxBUnit(options, 45_300 + ray) * 0.055;
		options.ctx.moveTo?.(cx, cy);
		options.ctx.lineTo?.(
			cx + Math.cos(angle - width) * radius,
			cy + Math.sin(angle - width) * radius,
		);
		options.ctx.lineTo?.(
			cx + Math.cos(angle + width) * radius,
			cy + Math.sin(angle + width) * radius,
		);
		options.ctx.closePath?.();
	}
	options.ctx.fill?.();
}

function drawAnamorphic(options: FxBPixelEffectDraw): void {
	const phase = fxBPhase(options);
	const pulse = Math.sin(Math.PI * phase);
	const x = options.width * (0.35 + phase * 0.3);
	const y = options.height * (0.5 + fxBSigned(options, 45_401) * 0.09);
	const color = options.frame.palette.accent;
	for (let flare = 0; flare < 5; flare += 1) {
		const width = options.width * (0.24 + flare * 0.12);
		const height = Math.max(1, options.height * (0.004 + flare * 0.004));
		options.ctx.globalAlpha = pulse * (0.34 - flare * 0.045);
		options.ctx.fillStyle =
			flare === 0 ? options.frame.palette.foreground : color;
		options.ctx.fillRect(x - width / 2, y - height / 2, width, height);
	}
	for (let ghost = 0; ghost < 3; ghost += 1) {
		const size =
			Math.min(options.width, options.height) * (0.018 + ghost * 0.013) * pulse;
		options.ctx.globalAlpha = 0.12 + ghost * 0.035;
		options.ctx.fillStyle = color;
		options.ctx.beginPath();
		options.ctx.arc?.(
			options.width / 2 + (options.width / 2 - x) * (0.55 + ghost * 0.55),
			options.height / 2 + (options.height / 2 - y) * (0.55 + ghost * 0.55),
			size,
			0,
			Math.PI * 2,
		);
		options.ctx.fill?.();
	}
}

function drawDustScratches(options: FxBPixelEffectDraw): void {
	const step = fxBStep(options, 18);
	const pulse = fxBPulse(options);
	options.ctx.strokeStyle = options.frame.palette.foreground;
	options.ctx.lineWidth = Math.max(
		1,
		Math.min(options.width, options.height) * 0.002,
	);
	options.ctx.globalAlpha = 0.22 + pulse * 0.35;
	options.ctx.beginPath();
	for (let scratch = 0; scratch < 4; scratch += 1) {
		const x =
			options.width *
			(0.08 + fxBUnit(options, step * 37 + scratch + 45_500) * 0.84);
		const drift =
			fxBSigned(options, step * 41 + scratch + 45_550) * options.width * 0.015;
		options.ctx.moveTo?.(x, -4);
		options.ctx.lineTo?.(x + drift, options.height + 4);
	}
	options.ctx.stroke?.();
	options.ctx.fillStyle = options.frame.palette.foreground;
	for (let dust = 0; dust < 18; dust += 1) {
		const salt = step * 53 + dust * 5 + 45_600;
		const size =
			Math.min(options.width, options.height) *
			(0.002 + fxBUnit(options, salt) * 0.007);
		options.ctx.globalAlpha = 0.18 + fxBUnit(options, salt + 1) * 0.5;
		options.ctx.fillRect(
			fxBUnit(options, salt + 2) * options.width,
			fxBUnit(options, salt + 3) * options.height,
			size,
			size * (0.4 + fxBUnit(options, salt + 4) * 0.8),
		);
	}
}

function drawFocusLines(options: FxBPixelEffectDraw): void {
	const phase = fxBPhase(options);
	const cx = options.width * (0.5 + fxBSigned(options, 45_701) * 0.03);
	const cy = options.height * (0.5 + fxBSigned(options, 45_702) * 0.03);
	const innerX = options.width * (0.28 + phase * 0.05);
	const innerY = options.height * (0.24 + phase * 0.05);
	const outer = Math.hypot(options.width, options.height);
	options.ctx.fillStyle = options.frame.palette.foreground;
	options.ctx.globalAlpha = 0.44 + fxBPulse(options) * 0.3;
	options.ctx.beginPath();
	for (let line = 0; line < 42; line += 1) {
		const angle =
			(line / 42) * Math.PI * 2 + fxBSigned(options, 45_800 + line) * 0.04;
		const width = 0.004 + fxBUnit(options, 45_900 + line) * 0.012;
		options.ctx.moveTo?.(
			cx + Math.cos(angle) * innerX,
			cy + Math.sin(angle) * innerY,
		);
		options.ctx.lineTo?.(
			cx + Math.cos(angle - width) * outer,
			cy + Math.sin(angle - width) * outer,
		);
		options.ctx.lineTo?.(
			cx + Math.cos(angle + width) * outer,
			cy + Math.sin(angle + width) * outer,
		);
		options.ctx.closePath?.();
	}
	options.ctx.fill?.();
}

function drawSpeedLines(options: FxBPixelEffectDraw): void {
	const phase = fxBPhase(options);
	const vertical =
		options.height > options.width && fxBUnit(options, 46_001) < 0.55;
	const direction = fxBUnit(options, 46_002) < 0.5 ? -1 : 1;
	const length = vertical ? options.height : options.width;
	const breadth = vertical ? options.width : options.height;
	for (let line = 0; line < 26; line += 1) {
		let cross = fxBUnit(options, 46_100 + line) * breadth;
		if (Math.abs(cross / breadth - 0.5) < 0.12) cross += breadth * 0.18;
		const lineLength = length * (0.12 + fxBUnit(options, 46_200 + line) * 0.38);
		const head =
			((phase * (1.1 + fxBUnit(options, 46_300 + line)) +
				fxBUnit(options, 46_400 + line)) %
				1) *
				(length + lineLength) -
			lineLength;
		const tail = head - lineLength * direction;
		const thickness = Math.max(
			1,
			breadth * (0.002 + fxBUnit(options, 46_500 + line) * 0.006),
		);
		options.ctx.globalAlpha = 0.24 + fxBUnit(options, 46_600 + line) * 0.55;
		options.ctx.fillStyle =
			line % 5 === 0
				? options.frame.palette.accent
				: options.frame.palette.foreground;
		options.ctx.beginPath();
		if (vertical) {
			options.ctx.moveTo?.(cross, tail);
			options.ctx.lineTo?.(cross - thickness, head);
			options.ctx.lineTo?.(cross + thickness, head);
		} else {
			options.ctx.moveTo?.(tail, cross);
			options.ctx.lineTo?.(head, cross - thickness);
			options.ctx.lineTo?.(head, cross + thickness);
		}
		options.ctx.closePath?.();
		options.ctx.fill?.();
	}
}

function drawStarGlint(options: FxBPixelEffectDraw): void {
	const phase = fxBPhase(options);
	const unit = Math.min(options.width, options.height);
	for (let star = 0; star < 3; star += 1) {
		const local = (phase - star * 0.17 + 1) % 1;
		const pulse = Math.sin(Math.PI * Math.min(1, local * 1.35));
		const radius =
			unit * (0.045 + fxBUnit(options, 46_701 + star) * 0.07) * pulse;
		const x = options.width * (0.18 + fxBUnit(options, 46_710 + star) * 0.64);
		const y = options.height * (0.3 + fxBUnit(options, 46_720 + star) * 0.4);
		options.ctx.globalAlpha = 0.5 + pulse * 0.42;
		options.ctx.fillStyle =
			star % 2 === 0
				? options.frame.palette.foreground
				: options.frame.palette.accent;
		options.ctx.beginPath();
		for (let point = 0; point < 16; point += 1) {
			const angle = (point / 16) * Math.PI * 2 + phase * 0.4;
			const length = point % 2 === 0 ? radius : radius * 0.12;
			if (point === 0)
				options.ctx.moveTo?.(
					x + Math.cos(angle) * length,
					y + Math.sin(angle) * length,
				);
			else
				options.ctx.lineTo?.(
					x + Math.cos(angle) * length,
					y + Math.sin(angle) * length,
				);
		}
		options.ctx.closePath?.();
		options.ctx.fill?.();
	}
}

function drawColorBars(options: FxBPixelEffectDraw): void {
	const phase = fxBPhase(options);
	const vertical = fxBUnit(options, 46_801) < 0.3;
	const colors = [
		options.frame.palette.accent,
		options.frame.palette.secondary,
		options.frame.palette.foreground,
	];
	for (let bar = 0; bar < 6; bar += 1) {
		const thickness =
			(vertical ? options.width : options.height) *
			(0.012 + fxBUnit(options, 46_900 + bar) * 0.04);
		const position =
			((phase * (0.8 + bar * 0.11) + fxBUnit(options, 47_000 + bar)) % 1) *
			(vertical ? options.width : options.height);
		options.ctx.globalAlpha = 0.72;
		options.ctx.fillStyle = colors[bar % colors.length]!;
		options.ctx.fillRect(
			vertical
				? position - thickness / 2
				: options.width * fxBUnit(options, 47_100 + bar) * 0.4,
			vertical
				? options.height * fxBUnit(options, 47_200 + bar) * 0.4
				: position - thickness / 2,
			vertical
				? thickness
				: options.width * (0.55 + fxBUnit(options, 47_300 + bar) * 0.45),
			vertical
				? options.height * (0.55 + fxBUnit(options, 47_400 + bar) * 0.45)
				: thickness,
		);
	}
}

function drawNegativeRing(options: FxBPixelEffectDraw): void {
	const phase = fxBPhase(options);
	const unit = Math.min(options.width, options.height);
	const cx = options.width * (0.5 + fxBSigned(options, 47_501) * 0.05);
	const cy = options.height * (0.5 + fxBSigned(options, 47_502) * 0.05);
	const diamond = fxBUnit(options, 47_503) < 0.35;
	for (let ring = 0; ring < 2; ring += 1) {
		const progress = (phase - ring * 0.2 + 1) % 1;
		const radius = unit * (0.08 + progress * 0.72);
		const thickness = unit * (ring === 0 ? 0.11 : 0.04) * (1 - progress * 0.55);
		options.ctx.globalAlpha = 0.45 + (1 - progress) * 0.45;
		options.ctx.strokeStyle = "#ffffff";
		options.ctx.lineWidth = Math.max(2, thickness);
		options.ctx.beginPath();
		if (diamond) {
			options.ctx.moveTo?.(cx, cy - radius);
			options.ctx.lineTo?.(cx + radius, cy);
			options.ctx.lineTo?.(cx, cy + radius);
			options.ctx.lineTo?.(cx - radius, cy);
			options.ctx.closePath?.();
		} else {
			options.ctx.arc?.(cx, cy, radius, 0, Math.PI * 2);
		}
		options.ctx.stroke?.();
	}
}
