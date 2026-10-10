import {
	blazeParamKeys,
	blazeRanges,
	type BlazeParams,
	type BlazeRate,
} from "./blaze-cases";
import {
	blazeLattice,
	blazeNoise,
	blazeSmoothstep,
} from "./blaze-oracle-noise";
import { blazePhase, blazeSparks } from "./blaze-oracle-time";

export function blazeContext({
	params,
	ticks,
	rate,
	width,
	height,
}: {
	params: BlazeParams;
	ticks: number;
	rate: BlazeRate;
	width: number;
	height: number;
}) {
	if (Object.keys(params).some((key) => !Object.hasOwn(blazeRanges, key)))
		throw Error("Unknown Blaze parameter");
	for (const key of blazeParamKeys) {
		const [low, high] = blazeRanges[key];
		if (
			!Number.isFinite(params[key]) ||
			params[key] < low ||
			params[key] > high
		)
			throw Error(`Invalid Blaze ${key}`);
	}
	if (!Number.isInteger(params.seed)) throw Error("Invalid Blaze seed");
	const phase = blazePhase({ ticks, speed: params.speed, rate });
	const authored = { ...params };
	for (const key of blazeParamKeys) authored[key] = Math.fround(params[key]);
	return {
		width,
		height,
		params: authored,
		phase,
		lattice: blazeLattice(params.seed),
		sparks: blazeSparks({ params, phase }),
	};
}

export function blazePixelField({
	context,
	x,
	y,
}: {
	context: ReturnType<typeof blazeContext>;
	x: number;
	y: number;
}) {
	const { params, width, height, phase, lattice, sparks } = context;
	const shortSide = Math.min(width, height);
	const flameHeight = params.height * shortSide;
	const px = x + 0.5,
		py = y + 0.5;
	const rise = height - py;
	const u = rise / flameHeight;
	const qx = (px / shortSide - params.wind * u) / params.scale;
	const qy = rise / (shortSide * params.scale) - 8 * phase;
	const noise = blazeNoise({ lattice, x: qx, y: qy, phase });
	const smooth = (low: number, high: number, value: number) =>
		blazeSmoothstep({ low, high, value });
	const flame =
		(1 - smooth(0.65, 1, u)) *
		smooth(0.25 + 0.5 * u, 0.45 + 0.5 * u, noise.value);
	const core =
		Math.min(1, Math.max(0, (noise.value - 0.35) / 0.5)) * Math.max(1 - u, 0);
	const smokeNoise = blazeNoise({
		lattice,
		x: qx + 2.375,
		y: qy + 4.625,
		phase,
	});
	const smoke =
		smooth(0.1, 0.45, u) *
		(1 - smooth(1.2, 2, u)) *
		smooth(0.3, 0.7, smokeNoise.value);
	let spark = 0;
	for (const particle of sparks) {
		const cx =
			particle.x * width +
			params.wind * shortSide * particle.age +
			particle.drift * shortSide * 0.03 * particle.age * (1 - particle.age);
		const cy = height - particle.age * 1.8 * flameHeight;
		const ex = (px - cx) / (particle.radius * shortSide);
		const ey = (py - cy) / (particle.radius * shortSide * 2.5);
		const coverage =
			Math.max(1 - ex * ex - ey * ey, 0) ** 2 *
			4 *
			particle.age *
			(1 - particle.age);
		spark = Math.max(spark, coverage);
	}
	const normalization = Math.max(1, Math.hypot(noise.dx, noise.dy));
	const envelope = smooth(0, 0.15, u) * (1 - smooth(0.8, 1.5, u));
	const displacement = params.refraction * shortSide * envelope;
	return {
		flameAlpha: params.amount * params.flameOpacity * flame,
		flameColor: [1, 0.12 + 0.78 * core, 0.015 + 0.235 * core] as const,
		smokeAlpha: params.amount * params.smokeOpacity * smoke,
		sparkAlpha: params.amount * params.sparkOpacity * spark,
		dx: (displacement * noise.dx) / normalization,
		dy: (-displacement * noise.dy) / normalization,
	};
}
