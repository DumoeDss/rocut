import { applyEffectPasses, resolveStylizedEffectJson } from "opencut-wasm";
import {
	liquidParameters,
	liquidRate,
	liquidSource,
	liquidThresholds,
	type LiquidParams,
	type LiquidRate,
} from "./liquid-browser-cases";
import {
	liquidDifference,
	liquidExpected,
	liquidOver,
	liquidSample,
} from "./liquid-browser-oracle";

export function liquidRead(
	canvas: CanvasImageSource,
	width: number,
	height: number,
	background?: string,
) {
	const context = new OffscreenCanvas(width, height).getContext("2d")!;
	if (background) {
		context.fillStyle = background;
		context.fillRect(0, 0, width, height);
	}
	context.drawImage(canvas, 0, 0);
	return context.getImageData(0, 0, width, height).data;
}
function passes(params: LiquidParams, local: number, fps: LiquidRate) {
	const result = JSON.parse(
		resolveStylizedEffectJson(
			JSON.stringify({
				effectType: "liquid",
				params,
				localTime: local,
				frameRate: fps,
			}),
		),
	);
	if (result.error) throw Error(result.error);
	return result.passes.map(
		(pass: {
			shader: string;
			uniforms: Record<string, number | number[]>;
		}) => ({
			shader: pass.shader,
			uniforms: Object.entries(pass.uniforms).map(([name, value]) => ({
				name,
				value: Array.isArray(value) ? value : [value],
			})),
		}),
	);
}
export async function checkLiquidRaster() {
	const results: unknown[] = [],
		errors: string[] = [];
	const record = (
		name: string,
		actual: Uint8ClampedArray,
		expected: Uint8ClampedArray,
		rgb = 2,
		alpha = 1,
	) => {
		const difference = liquidDifference(actual, expected, rgb, alpha);
		results.push({ name, ...difference });
		if (difference.failures)
			errors.push(
				`${name}: ${difference.first}; ${difference.failures} failed bytes`,
			);
	};
	const render = (
		canvas: OffscreenCanvas,
		params: LiquidParams,
		local: number,
		fps = liquidRate,
	) => {
		const resolved = passes(params, local, fps);
		// The high-level renderer bypasses a validated identity; low-level apply
		// deliberately requires a nonempty list. Test both contracts separately.
		if (resolved.length === 0) return canvas;
		return applyEffectPasses({
			source: canvas,
			width: canvas.width,
			height: canvas.height,
			passes: resolved,
		});
	};
	for (const [width, height] of [
		[93, 62],
		[62, 93],
	]) {
		const canvas = new OffscreenCanvas(width, height),
			ctx = canvas.getContext("2d")!;
		ctx.putImageData(
			new ImageData(liquidSource(width, height), width, height),
			0,
			0,
		);
		const source = ctx.getImageData(0, 0, width, height).data,
			params = liquidParameters();
		const baseline = liquidRead(
			render(canvas, { ...params, amount: 0 }, 19000),
			width,
			height,
		);
		record(`${width} identity-source`, baseline, source, 0, 0);
		record(
			`${width} zero-state GPU identity`,
			liquidRead(render(canvas, params, 0), width, height),
			source,
			0,
			0,
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
				const label = `${width}x${height} ${fps.numerator}/${fps.denominator} t${local}`;
				const expected = liquidExpected(
					source,
					width,
					height,
					params,
					local,
					fps,
				);
				const actual = liquidRead(
					render(canvas, params, local, fps),
					width,
					height,
				);
				record(label, actual, expected.pixels);
				results.push({
					name: `${label} schedule`,
					steps: expected.steps,
					eventsApplied: expected.eventsApplied,
					completedTicks: expected.completedTicks,
				});
				if (fps.numerator === 120) frozen.push({ local, pixels: actual });
			}
		}
		for (const saved of frozen.reverse())
			record(
				`${width} reverse t${saved.local}`,
				liquidRead(render(canvas, params, saved.local), width, height),
				saved.pixels,
				0,
				0,
			);
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
		for (const [name, changes] of Object.entries(variants)) {
			const changed = { ...params, ...changes },
				expected = liquidExpected(
					source,
					width,
					height,
					changed,
					26000,
					liquidRate,
				);
			record(
				`${width} parameter ${name}`,
				liquidRead(render(canvas, changed, 26000), width, height),
				expected.pixels,
			);
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
			errors.push("Final partial step consumed an event");
		const active = liquidRead(render(canvas, params, 26000), width, height);
		for (const control of [
			"noProjection",
			"ignoreEvents",
			"uvRadius",
		] as const) {
			const bad = liquidExpected(
				source,
				width,
				height,
				params,
				26000,
				liquidRate,
				control,
			);
			const difference = liquidDifference(active, bad.pixels);
			results.push({ name: `${width} rejects ${control}`, ...difference });
			if (!difference.failures)
				errors.push(`${width} oracle did not reject ${control}`);
		}
		ctx.putImageData(
			new ImageData(liquidSource(width, height, true), width, height),
			0,
			0,
		);
		const alphaSource = ctx.getImageData(0, 0, width, height).data;
		const transparentIdentity = render(canvas, params, 0);
		record(
			`${width} zero-state transparent GPU over-black`,
			liquidRead(transparentIdentity, width, height, "#000000"),
			liquidOver(alphaSource, [0, 0, 0]),
			liquidThresholds.compositeRgb,
			0,
		);
		for (const amount of [0, 0.5, 1]) {
			const changed = { ...params, amount },
				reference = liquidExpected(
					alphaSource,
					width,
					height,
					changed,
					26000,
					liquidRate,
				).pixels;
			const canvasResult = render(canvas, changed, 26000);
			const black = liquidRead(canvasResult, width, height, "#000000"),
				white = liquidRead(canvasResult, width, height, "#ffffff");
			record(
				`${width} alpha ${amount} over-black`,
				black,
				liquidOver(reference, [0, 0, 0]),
				liquidThresholds.compositeRgb,
				0,
			);
			record(
				`${width} alpha ${amount} over-white`,
				white,
				liquidOver(reference, [255, 255, 255]),
				liquidThresholds.compositeRgb,
				0,
			);
			let maxAlphaError = 0;
			for (let i = 0; i < black.length; i += 4)
				for (let c = 0; c < 3; c++)
					maxAlphaError = Math.max(
						maxAlphaError,
						Math.abs(
							1 - (white[i + c] - black[i + c]) / 255 - reference[i + 3] / 255,
						),
					);
			results.push({
				name: `${width} alpha ${amount} inferred`,
				maxAlphaError,
			});
			if (maxAlphaError > liquidThresholds.alphaFromBackgrounds + 1e-12)
				errors.push(`${width} inferred alpha ${maxAlphaError}`);
		}
	}
	for (const alpha of [0, 1, 2, 96, 255]) {
		const pixels = new Uint8ClampedArray([
			40,
			80,
			120,
			alpha,
			40,
			80,
			120,
			alpha,
			40,
			80,
			120,
			alpha,
			40,
			80,
			120,
			alpha,
		]);
		if (
			liquidSample(pixels, 2, 2, 0.532706215866636, 1.06065448633136)[3] !==
			alpha / 255
		)
			errors.push("CPU oracle constant alpha regression");
	}
	return {
		ok: errors.length === 0,
		thresholds: liquidThresholds,
		results,
		errors,
	};
}
