import { describe, expect, test } from "bun:test";
import {
	cloudsInvalidParameters,
	cloudsParameters,
	cloudsRate,
	cloudsSource,
	cloudsVariants,
} from "./clouds-cases";
import {
	cloudsDifference,
	cloudsExpected,
	cloudsSample,
} from "./clouds-oracle";

describe("Independent Clouds premultiplied optical reference", () => {
	test("bilinear premultiplication ignores hidden color and does not clamp exterior", () => {
		const source = new Uint8ClampedArray([200, 0, 0, 255, 0, 255, 255, 0]);
		expect(cloudsSample(source, 2, 1, 0.5, 0)).toEqual([100 / 255, 0, 0, 0.5]);
		expect(cloudsSample(source, 2, 1, -0.5, 0)).toEqual([100 / 255, 0, 0, 0.5]);
		expect(cloudsSample(source, 2, 1, -1, 0)).toEqual([0, 0, 0, 0]);
	});
	test("neutral identities are exact only after full parameter/time/dimension admission", () => {
		const source = cloudsSource(32, 24, "holes");
		for (const neutral of [
			{ amount: 0 },
			{ density: 0 },
			{ refraction: 0, fogOpacity: 0 },
		]) {
			const params = { ...cloudsParameters, ...neutral };
			const frame = cloudsExpected(source, 32, 24, params, 48000, cloudsRate);
			expect(frame.pixels).toEqual(source);
			expect(frame.identity.every((value) => value === 1)).toBe(true);
			for (const patch of cloudsInvalidParameters())
				expect(() =>
					cloudsExpected(
						source,
						32,
						24,
						{ ...params, ...patch },
						48000,
						cloudsRate,
					),
				).toThrow();
			expect(() =>
				cloudsExpected(source, 32, 24, params, 0.5, cloudsRate),
			).toThrow();
		}
		for (const [width, height] of [
			[0, 1],
			[8193, 1],
			[8192, 2049],
			[1.5, 1],
			[32, 23],
		])
			expect(() =>
				cloudsExpected(
					source,
					width,
					height,
					{ ...cloudsParameters, amount: 0 },
					0,
					cloudsRate,
				),
			).toThrow();
	});
	test("nonneutral zero coverage canonicalizes hidden RGB; explicit neutral paths retain bytes", () => {
		const source = new Uint8ClampedArray([255, 0, 255, 0]);
		const params = {
			...cloudsParameters,
			density: 0.000001,
			windX: 0,
			windY: 0,
			seed: 1,
		};
		const frame = cloudsExpected(source, 1, 1, params, 0, cloudsRate);
		expect(frame.activePixels).toBe(0);
		expect(Array.from(frame.pixels)).toEqual([0, 0, 0, 0]);
		expect(frame.identity[0]).toBe(0);
		for (const neutral of [
			{ amount: 0 },
			{ density: 0 },
			{ refraction: 0, fogOpacity: 0 },
		]) {
			const identity = cloudsExpected(
				source,
				1,
				1,
				{ ...params, ...neutral },
				0,
				cloudsRate,
			);
			expect(identity.pixels).toEqual(source);
			expect(identity.identity[0]).toBe(1);
		}
	});
	test("fog fills transparent pixels but refraction alone cannot manufacture alpha", () => {
		const source = cloudsSource(96, 64, "transparent");
		const refracted = cloudsExpected(
			source,
			96,
			64,
			{ ...cloudsParameters, fogOpacity: 0 },
			48000,
			cloudsRate,
		);
		expect(refracted.alphaFilledPixels).toBe(0);
		expect(
			refracted.pixels.every((value, index) => index % 4 !== 3 || value === 0),
		).toBe(true);
		const fog = cloudsExpected(
			source,
			96,
			64,
			{ ...cloudsParameters, refraction: 0 },
			48000,
			cloudsRate,
		);
		expect(fog.alphaFilledPixels).toBeGreaterThan(100);
		const visible = Array.from(
			{ length: fog.pixels.length / 4 },
			(_, index) => index * 4,
		).filter((offset) => fog.pixels[offset + 3] > 0);
		expect(
			visible.every(
				(offset) =>
					fog.pixels[offset] === 77 &&
					fog.pixels[offset + 1] === 191 &&
					fog.pixels[offset + 2] === 255,
			),
		).toBe(true);
	});
	test("fog-only has no source blur and follows premultiplied over on partial alpha", () => {
		const source = new Uint8ClampedArray([200, 100, 50, 128]);
		const params = {
			...cloudsParameters,
			amount: 0.5,
			density: 1,
			windX: 0,
			windY: 0,
			seed: 1,
			refraction: 0,
			fogOpacity: 0.5,
			colorR: 1,
			colorG: 0,
			colorB: 0,
		};
		const frame = cloudsExpected(source, 1, 1, params, 0, cloudsRate);
		expect(Array.from(frame.pixels)).toEqual([222, 60, 30, 160]);
		expect(frame.exteriorSamples).toBe(0);
	});
	test("zero-speed freezes deformation, not independently authored wind", () => {
		const source = cloudsSource(96, 64, "opaque"),
			params = { ...cloudsParameters, speed: 0 };
		const first = cloudsExpected(source, 96, 64, params, -120000, cloudsRate);
		const later = cloudsExpected(
			source,
			96,
			64,
			params,
			Number.MAX_SAFE_INTEGER,
			cloudsRate,
		);
		expect(first.pixels).toEqual(later.pixels);
		for (const wind of [{ windX: -0.4 }, { windY: 0.4 }]) {
			const changed = cloudsExpected(
				source,
				96,
				64,
				{ ...params, ...wind },
				0,
				cloudsRate,
			);
			expect(cloudsDifference(changed.pixels, first).failed).toBeGreaterThan(
				100,
			);
		}
	});
	for (const [width, height] of [
		[96, 64],
		[64, 96],
	]) {
		test(`${width}x${height}: all 12 controls are visible and common false implementations fail`, () => {
			const source = cloudsSource(width, height, "holes");
			const expected = cloudsExpected(
				source,
				width,
				height,
				cloudsParameters,
				48000,
				cloudsRate,
			);
			expect(expected.activePixels).toBeGreaterThan(500);
			expect(expected.exteriorSamples).toBeGreaterThan(10);
			expect(cloudsDifference(expected.pixels, expected, source)).toMatchObject(
				{ failed: 0, identityFailed: 0, excluded: 0 },
			);
			for (const [name, patch] of Object.entries(cloudsVariants())) {
				const changed = cloudsExpected(
					source,
					width,
					height,
					{ ...cloudsParameters, ...patch },
					48000,
					cloudsRate,
				);
				expect(
					cloudsDifference(changed.pixels, expected).failed,
					name,
				).toBeGreaterThan(20);
			}
			const controls = {
				noOp: source,
				fogOnly: cloudsExpected(
					source,
					width,
					height,
					{ ...cloudsParameters, refraction: 0 },
					48000,
					cloudsRate,
				).pixels,
				refractionOnly: cloudsExpected(
					source,
					width,
					height,
					{ ...cloudsParameters, fogOpacity: 0 },
					48000,
					cloudsRate,
				).pixels,
				ignoredSeed: cloudsExpected(
					source,
					width,
					height,
					{ ...cloudsParameters, seed: 1 },
					48000,
					cloudsRate,
				).pixels,
				ignoredWind: cloudsExpected(
					source,
					width,
					height,
					{ ...cloudsParameters, windX: 0, windY: 0 },
					48000,
					cloudsRate,
				).pixels,
				ignoredTime: cloudsExpected(
					source,
					width,
					height,
					cloudsParameters,
					0,
					cloudsRate,
				).pixels,
			};
			for (const [name, pixels] of Object.entries(controls))
				expect(cloudsDifference(pixels, expected).failed, name).toBeGreaterThan(
					100,
				);
		});
	}
});
