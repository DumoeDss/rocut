import { unitRandom } from "./deterministic-random";
import type { MotionTextCanvasContext, MotionTextRenderFrame } from "./types";

interface KineticTransitionDraw {
	readonly ctx: MotionTextCanvasContext;
	readonly drawCurrent: () => void;
	readonly drawPrevious: () => void;
	readonly frame: MotionTextRenderFrame;
	readonly height: number;
	readonly width: number;
}

export function drawKineticTransition(options: KineticTransitionDraw): boolean {
	if (!options.frame.previousCut) return false;
	switch (options.frame.cut?.preset.trans) {
		case "knCornerSwing":
			drawCornerSwing(options);
			return true;
		case "knStutterCut":
			drawStutterCut(options);
			return true;
		case "knStripSlam":
			drawStripSlam(options);
			return true;
		default:
			return false;
	}
}

function drawCornerSwing(options: KineticTransitionDraw): void {
	const progress = options.frame.enterProgress;
	if (drawBoundary({ options, progress })) return;
	const seed = options.frame.cut?.seed ?? 0;
	const corner = Math.floor(unitRandom({ seed, salt: 701 }) * 4);
	const pivotX = corner === 1 || corner === 2 ? options.width : 0;
	const pivotY = corner >= 2 ? 0 : options.height;
	const direction = corner === 0 || corner === 2 ? 1 : -1;
	const eased = inOutCubic(progress);
	drawRotated({
		...options,
		angle: (-Math.PI / 2) * direction * (1 - eased),
		draw: options.drawCurrent,
		pivotX,
		pivotY,
	});
	drawRotated({
		...options,
		angle: (Math.PI / 2) * direction * eased,
		draw: options.drawPrevious,
		pivotX,
		pivotY,
	});
	const alpha = Math.sin(Math.PI * clamp01(progress));
	if (alpha <= 0) return;
	options.ctx.save();
	options.ctx.translate(pivotX, pivotY);
	options.ctx.rotate((Math.PI / 2) * direction * eased);
	options.ctx.globalAlpha *= alpha;
	options.ctx.fillStyle = options.frame.palette.accent;
	const edge = Math.max(2, Math.min(options.width, options.height) * 0.006);
	options.ctx.fillRect(-edge / 2, -options.height, edge, options.height * 2);
	options.ctx.restore();
}

function drawStutterCut(options: KineticTransitionDraw): void {
	const progress = options.frame.enterProgress;
	if (drawBoundary({ options, progress })) return;
	const cuts = [0.18, 0.36, 0.52, 0.7] as const;
	let index = 0;
	while (index < cuts.length && progress >= cuts[index]) index += 1;
	const draw = [
		options.drawPrevious,
		options.drawCurrent,
		options.drawPrevious,
		options.drawCurrent,
		options.drawCurrent,
	][index];
	const seed = options.frame.cut?.seed ?? 0;
	const direction = unitRandom({ seed, salt: 711 }) >= 0.5 ? 1 : -1;
	const scale = [1, 1.08, 0.94, 1.11, 1][index];
	const offset =
		[0, 0.028, -0.017, -0.028, 0][index] * options.width * direction;
	options.ctx.save();
	options.ctx.translate(options.width / 2 + offset, options.height / 2);
	options.ctx.scale(scale, scale);
	options.ctx.translate(-options.width / 2, -options.height / 2);
	draw();
	options.ctx.restore();
	const since = index > 0 ? progress - cuts[index - 1] : 1;
	if (since >= 0.06) return;
	options.ctx.save();
	options.ctx.globalAlpha *= 0.9;
	options.ctx.fillStyle = options.frame.palette.accent;
	const height = Math.max(3, options.height * 0.012);
	options.ctx.fillRect(
		0,
		(index % 2 === 0 ? 0.68 : 0.3) * options.height,
		options.width,
		height,
	);
	options.ctx.restore();
}

function drawStripSlam(options: KineticTransitionDraw): void {
	const progress = options.frame.enterProgress;
	if (drawBoundary({ options, progress })) return;
	options.drawPrevious();
	const seed = options.frame.cut?.seed ?? 0;
	const count = 3 + Math.floor(unitRandom({ seed, salt: 721 }) * 3);
	const reverse = unitRandom({ seed, salt: 722 }) >= 0.5;
	const upward = unitRandom({ seed, salt: 723 }) >= 0.75;
	for (let index = 0; index < count; index += 1) {
		const order = reverse ? count - 1 - index : index;
		const delay = (order / count) * 0.45;
		const phase = clamp01((progress - delay) / 0.55);
		if (phase <= 0) continue;
		const offset = stripOffset({ height: options.height, phase, upward });
		const x0 = Math.round((index * options.width) / count);
		const x1 = Math.round(((index + 1) * options.width) / count);
		options.ctx.save();
		options.ctx.beginPath();
		options.ctx.rect(x0, 0, x1 - x0 + 1, options.height);
		options.ctx.clip();
		options.ctx.translate(0, offset);
		options.drawCurrent();
		options.ctx.restore();
		if (phase >= 1) continue;
		options.ctx.save();
		options.ctx.globalAlpha *= 0.8 * (1 - phase);
		options.ctx.fillStyle = options.frame.palette.accent;
		options.ctx.fillRect(
			x0,
			upward ? offset : offset + options.height - 3,
			x1 - x0,
			Math.max(3, options.height * 0.008),
		);
		options.ctx.restore();
	}
}

function drawRotated({
	angle,
	ctx,
	draw,
	pivotX,
	pivotY,
}: KineticTransitionDraw & {
	readonly angle: number;
	readonly draw: () => void;
	readonly pivotX: number;
	readonly pivotY: number;
}): void {
	ctx.save();
	ctx.translate(pivotX, pivotY);
	ctx.rotate(angle);
	ctx.translate(-pivotX, -pivotY);
	draw();
	ctx.restore();
}

function drawBoundary({
	options,
	progress,
}: {
	readonly options: KineticTransitionDraw;
	readonly progress: number;
}): boolean {
	if (progress <= 0) {
		options.drawPrevious();
		return true;
	}
	if (progress >= 0.999) {
		options.drawCurrent();
		return true;
	}
	return false;
}

function stripOffset({
	height,
	phase,
	upward,
}: {
	readonly height: number;
	readonly phase: number;
	readonly upward: boolean;
}): number {
	const landing = 0.62;
	let offset: number;
	if (phase < landing) {
		const fall = phase / landing;
		offset = -height * (1 - fall * fall);
	} else {
		const bounce = (phase - landing) / (1 - landing);
		offset =
			-height * 0.06 * Math.abs(Math.sin(bounce * Math.PI * 2)) * (1 - bounce);
	}
	return upward ? -offset : offset;
}

function inOutCubic(value: number): number {
	const progress = clamp01(value);
	return progress < 0.5 ? 4 * progress ** 3 : 1 - (-2 * progress + 2) ** 3 / 2;
}

function clamp01(value: number): number {
	return Math.min(1, Math.max(0, value));
}
