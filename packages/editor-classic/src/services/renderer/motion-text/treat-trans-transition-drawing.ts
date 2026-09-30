import { signedRandom, unitRandom } from "./deterministic-random";
import { clamp01, inOutCubic, outCubic } from "./treat-trans-drawing";
import type { MotionTextCanvasContext, MotionTextRenderFrame } from "./types";

export interface TreatTransTransitionDraw {
	readonly ctx: MotionTextCanvasContext;
	readonly drawCurrent: () => void;
	readonly drawPrevious: () => void;
	readonly frame: MotionTextRenderFrame;
	readonly height: number;
	readonly width: number;
}

export function transitionBoundary(options: TreatTransTransitionDraw): boolean {
	if (options.frame.enterProgress <= 0) {
		options.drawPrevious();
		return true;
	}
	if (options.frame.enterProgress >= 0.999) {
		options.drawCurrent();
		return true;
	}
	return false;
}

export function transitionProgress(options: TreatTransTransitionDraw): number {
	return clamp01(options.frame.enterProgress);
}

export function transitionSeed(options: TreatTransTransitionDraw): number {
	return options.frame.cut?.seed ?? 0;
}

// eslint-disable-next-line opencut/prefer-object-params -- Variable salts form the deterministic hash input.
export function transitionRandom(
	options: TreatTransTransitionDraw,
	...salts: number[]
): number {
	return unitRandom({ seed: transitionSeed(options), salt: saltOf(salts) });
}

// eslint-disable-next-line opencut/prefer-object-params -- Variable salts form the deterministic hash input.
export function transitionRandomSigned(
	options: TreatTransTransitionDraw,
	...salts: number[]
): number {
	return signedRandom({ seed: transitionSeed(options), salt: saltOf(salts) });
}

export function bell(progress: number): number {
	return Math.sin(Math.PI * clamp01(progress));
}

export function eased(options: TreatTransTransitionDraw): number {
	return inOutCubic(transitionProgress(options));
}

export function easedOut(options: TreatTransTransitionDraw): number {
	return outCubic(transitionProgress(options));
}

// eslint-disable-next-line opencut/prefer-object-params -- The transition draw object and clip rectangle are distinct Canvas operands.
export function withTransitionClip(
	options: TreatTransTransitionDraw,
	rect: readonly [number, number, number, number],
	draw: () => void,
): void {
	if (rect[2] <= 0.05 || rect[3] <= 0.05) return;
	options.ctx.save();
	options.ctx.beginPath();
	options.ctx.rect(...rect);
	options.ctx.clip();
	draw();
	options.ctx.restore();
}

// eslint-disable-next-line opencut/prefer-object-params -- The transition draw object and clip geometry are distinct Canvas operands.
export function withCircleClip(
	options: TreatTransTransitionDraw,
	input: { readonly radius: number; readonly x: number; readonly y: number },
	draw: () => void,
): void {
	if (input.radius <= 0.05) return;
	if (!options.ctx.arc) {
		withTransitionClip(
			options,
			[
				input.x - input.radius,
				input.y - input.radius,
				input.radius * 2,
				input.radius * 2,
			],
			draw,
		);
		return;
	}
	options.ctx.save();
	options.ctx.beginPath();
	options.ctx.arc(input.x, input.y, input.radius, 0, Math.PI * 2);
	options.ctx.clip();
	draw();
	options.ctx.restore();
}

// eslint-disable-next-line opencut/prefer-object-params -- The transition draw object and line geometry are distinct Canvas operands.
export function drawTransitionLine(
	options: TreatTransTransitionDraw,
	input: {
		readonly alpha?: number;
		readonly color?: string;
		readonly from: readonly [number, number];
		readonly to: readonly [number, number];
		readonly width: number;
	},
): void {
	const dx = input.to[0] - input.from[0];
	const dy = input.to[1] - input.from[1];
	const length = Math.hypot(dx, dy);
	if (length <= 0.05 || input.width <= 0.05) return;
	options.ctx.save();
	options.ctx.translate(input.from[0], input.from[1]);
	options.ctx.rotate(Math.atan2(dy, dx));
	options.ctx.globalAlpha *= input.alpha ?? 1;
	options.ctx.fillStyle = input.color ?? options.frame.palette.accent;
	options.ctx.fillRect(0, -input.width / 2, length, input.width);
	options.ctx.restore();
}

// eslint-disable-next-line opencut/prefer-object-params -- The transition draw object and transform geometry are distinct Canvas operands.
export function drawScaled(
	options: TreatTransTransitionDraw,
	input: {
		readonly alpha?: number;
		readonly draw: () => void;
		readonly rotation?: number;
		readonly scaleX: number;
		readonly scaleY?: number;
		readonly translateX?: number;
		readonly translateY?: number;
	},
): void {
	options.ctx.save();
	options.ctx.translate(
		options.width / 2 + (input.translateX ?? 0),
		options.height / 2 + (input.translateY ?? 0),
	);
	if (input.rotation) options.ctx.rotate(input.rotation);
	options.ctx.scale(input.scaleX, input.scaleY ?? input.scaleX);
	options.ctx.translate(-options.width / 2, -options.height / 2);
	options.ctx.globalAlpha *= input.alpha ?? 1;
	input.draw();
	options.ctx.restore();
}

// eslint-disable-next-line opencut/prefer-object-params -- Row count is the sole grid scalar.
export function transitionGrid(
	options: TreatTransTransitionDraw,
	rows: number,
): {
	readonly cell: number;
	readonly columns: number;
	readonly rows: number;
} {
	const cell = options.height / rows;
	return { cell, columns: Math.ceil(options.width / cell), rows };
}

function saltOf(salts: readonly number[]): number {
	let salt = 2166136261;
	for (const value of salts) {
		salt = Math.imul(salt ^ (value | 0), 16777619);
	}
	return salt | 0;
}
