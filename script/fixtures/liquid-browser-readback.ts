import {
	liquidParameters,
	liquidRate,
	liquidSource,
	liquidThresholds,
	type LiquidParams,
} from "./liquid-browser-cases";
import { liquidDifference, liquidExpected } from "./liquid-browser-oracle";
import { createLiquidReadbackCapture } from "./liquid-browser-readback-capture";

/** Feature-only diagnostic. Expected raw pixels never come from the GPU. */
export async function checkLiquidReadback(expectedBackend: string) {
	const { capture, recordRaw, report } =
		createLiquidReadbackCapture(expectedBackend);
	const controls: unknown[] = [],
		errors = report.errors;
	for (const [width, height] of [
		[93, 62],
		[62, 93],
	]) {
		const canvas = new OffscreenCanvas(width, height),
			context = canvas.getContext("2d")!,
			params = liquidParameters();
		context.putImageData(
			new ImageData(liquidSource(width, height), width, height),
			0,
			0,
		);
		const source = context.getImageData(0, 0, width, height).data;
		await capture(
			`${width} amount-zero identity`,
			canvas,
			source,
			{ ...params, amount: 0 },
			19000,
			liquidRate,
			true,
		);
		await capture(
			`${width} zero-state GPU identity`,
			canvas,
			source,
			params,
			0,
			liquidRate,
			true,
		);
		const frozen: { local: number; pixels: Uint8ClampedArray }[] = [];
		for (const fps of [
			liquidRate,
			{ numerator: 240, denominator: 1 },
			{ numerator: 30, denominator: 1 },
			{ numerator: 30000, denominator: 1001 },
		]) {
			for (const local of [
				0, 2000, 2500, 3000, 3500, 10000, 10500, 11000, 11500, 26500, 27000,
				28000, 60000,
			]) {
				const pixels = await capture(
					`${width}x${height} ${fps.numerator}/${fps.denominator} t${local}`,
					canvas,
					source,
					params,
					local,
					fps,
				);
				if (fps.numerator === 120) frozen.push({ local, pixels });
			}
		}
		for (const saved of frozen.reverse()) {
			const pixels = await capture(
				`${width} reverse t${saved.local}`,
				canvas,
				source,
				params,
				saved.local,
			);
			recordRaw(
				`${width} reverse exact t${saved.local}`,
				pixels,
				saved.pixels,
				0,
				0,
			);
		}
		const variants: Record<string, LiquidParams> = {
			half: { amount: 0.5 },
			noRefraction: { refraction: 0 },
			noDye: { dyeOpacity: 0 },
			redDye: { colorR: 1, colorG: 0, colorB: 0 },
			noViscosity: { viscosity: 0 },
			damping: { velocityDamping: 8 },
			decay: { dyeDissipation: 8 },
			projection: { pressureIterations: 4 },
			diffusion: { diffusionIterations: 2 },
			noVorticity: { vorticity: 0 },
			grid: { columns: 8, rows: 12 },
		};
		for (const [name, changes] of Object.entries(variants))
			await capture(
				`${width} parameter ${name}`,
				canvas,
				source,
				{ ...params, ...changes },
				26000,
			);
		const active = await capture(
			`${width} controls baseline`,
			canvas,
			source,
			params,
			26000,
		);
		for (const control of [
			"noProjection",
			"ignoreEvents",
			"uvRadius",
		] as const) {
			const incorrect = liquidExpected(
				source,
				width,
				height,
				params,
				26000,
				liquidRate,
				control,
			);
			const difference = liquidDifference(active, incorrect.pixels);
			controls.push({ name: `${width} rejects ${control}`, ...difference });
			if (!difference.failures)
				errors.push(`${width} did not reject ${control}`);
		}
		const final = liquidExpected(
			source,
			width,
			height,
			params,
			60000,
			liquidRate,
		);
		if (final.eventsApplied !== 2 || final.steps !== 24)
			errors.push(`${width} invalid final schedule`);
		context.putImageData(
			new ImageData(liquidSource(width, height, true), width, height),
			0,
			0,
		);
		const alphaSource = context.getImageData(0, 0, width, height).data;
		await capture(
			`${width} transparent zero-state`,
			canvas,
			alphaSource,
			params,
			0,
			liquidRate,
			true,
		);
		for (const amount of [0, 0.5, 1])
			await capture(
				`${width} transparent amount ${amount}`,
				canvas,
				alphaSource,
				{ ...params, amount },
				26000,
			);
	}
	return {
		ok: errors.length === 0,
		mode: "browser-readback-tests",
		thresholds: liquidThresholds,
		rawOracle: "independent MAC + optical CPU; every RGBA byte; no alpha mask",
		surfaceOracle:
			"same raw texture through independent RGBA8 premultiplication quantizer",
		...report,
		controls,
	};
}
