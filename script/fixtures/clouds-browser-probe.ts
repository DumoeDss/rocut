import {
	disposeGpu,
	initializeGpu,
	WasmRuntimeGraphicsQuery,
} from "opencut-wasm";
import {
	cloudsParameters,
	cloudsRate,
	cloudsSource,
	cloudsThresholds,
	cloudsVariants,
	type CloudsParams,
	type CloudsRate,
	type CloudsSourceKind,
} from "./clouds-cases";
import { cloudsDifference, cloudsExpected } from "./clouds-oracle";
import { checkCloudsAdmission } from "./clouds-browser-checks";
import {
	encodeClouds,
	equalClouds,
	readClouds,
	renderClouds,
	resolveClouds,
} from "./clouds-browser-support";

export async function runCloudsProbe() {
	const graphics = new WasmRuntimeGraphicsQuery();
	const results: Record<string, unknown>[] = [],
		errors: string[] = [];
	const report = {
		ok: false,
		backend: "",
		thresholds: cloudsThresholds,
		results,
		errors,
		failure: "",
		gpuDisposed: false,
		queryFreed: false,
		scope:
			"Native Clouds resolver and raster only; production timeline, codec, UI, and installed host are not evaluated",
	};
	const check = (condition: unknown, message: string) => {
		if (!condition) errors.push(message);
	};
	Reflect.set(globalThis, "__cloudsProgress", report);
	try {
		await initializeGpu();
		report.backend = graphics.selectedBackend() ?? "";
		if (
			report.backend !==
			(new URL(location.href).searchParams.get("backend") ?? "webgl")
		)
			throw Error("Requested Clouds backend not selected");
		checkCloudsAdmission(resolveClouds, check, results);
		for (const [width, height] of [
			[192, 128],
			[128, 192],
		]) {
			const canvas = new OffscreenCanvas(width, height),
				context = canvas.getContext("2d", { willReadFrequently: true })!;
			for (const kind of [
				"opaque",
				"holes",
				"transparent",
			] as CloudsSourceKind[]) {
				context.putImageData(
					new ImageData(cloudsSource(width, height, kind), width, height),
					0,
					0,
				);
				const source = readClouds(canvas);
				const record = (
					name: string,
					params: CloudsParams,
					time: number,
					rate: CloudsRate = cloudsRate,
				) => {
					const expected = cloudsExpected(
						source,
						width,
						height,
						params,
						time,
						rate,
					);
					const actual = renderClouds(canvas, params, time, rate);
					const difference = cloudsDifference(actual, expected, source);
					const label = `${width}x${height} ${kind} ${name}`;
					results.push({
						name: label,
						time,
						...difference,
						activePixels: expected.activePixels,
						exteriorSamples: expected.exteriorSamples,
						alphaFilledPixels: expected.alphaFilledPixels,
					});
					check(
						!difference.failed && !difference.identityFailed,
						`${label}: ${JSON.stringify(difference)}`,
					);
					if (kind === "transparent" && params.fogOpacity === 0)
						check(
							actual.every((value) => value === 0),
							`${label}: refraction manufactured alpha/color`,
						);
					return { actual, expected };
				};
				for (const [name, changes] of Object.entries({
					amountZero: { amount: 0 },
					densityZero: { density: 0 },
					opticsZero: { refraction: 0, fogOpacity: 0 },
				}))
					check(
						equalClouds(
							record(name, { ...cloudsParameters, ...changes }, 48000).actual,
							source,
						),
						`${kind} ${name} identity`,
					);
				const reference = record("reference", cloudsParameters, 48000).actual;
				if (kind === "transparent") {
					const zeroCoverage = record(
						"nonneutral zero coverage",
						{ ...cloudsParameters, density: 0.000001 },
						0,
					);
					check(
						zeroCoverage.expected.activePixels === 0,
						"Coverage-zero control unexpectedly contains clouds",
					);
					check(
						zeroCoverage.actual.every((value) => value === 0),
						"Nonneutral zero-alpha output retained raw RGB",
					);
					results.push({
						name: "transparent raw RGB scope",
						note: "Canvas canonicalizes hidden RGB on upload/readback; CPU raw-source regression separately distinguishes nonneutral zero coverage from explicit neutral byte identity",
					});
				}
				check(!equalClouds(reference, source), `${kind}: Clouds is a no-op`);
				for (const [name, changes] of Object.entries(cloudsVariants())) {
					const changed = record(
						name,
						{ ...cloudsParameters, ...changes },
						48000,
					).actual;
					if (kind !== "transparent" || name !== "refraction")
						check(!equalClouds(changed, reference), `${kind}: ignored ${name}`);
				}
				const saved = new Map<number, Uint8ClampedArray>();
				for (const time of [
					-244000, -4000, -1, 0, 4000, 56000, 60000, 64000, 236000, 240000,
					244000,
				])
					saved.set(
						time,
						record(`time ${time}`, cloudsParameters, time).actual,
					);
				for (const time of [244000, -4000, 0, 240000, -1, 244000])
					check(
						equalClouds(
							renderClouds(canvas, cloudsParameters, time),
							saved.get(time)!,
						),
						`Repeat/reverse changed ${kind} t${time}`,
					);
				check(
					equalClouds(saved.get(0)!, saved.get(240000)!),
					`${kind}: exact two-second loop differs`,
				);
				check(
					equalClouds(saved.get(-1)!, saved.get(-4000)!),
					`${kind}: negative frame flooring differs`,
				);
				const frozen = { ...cloudsParameters, speed: 0 };
				const zero = record("speed zero", frozen, -4000).actual;
				check(
					equalClouds(zero, record("speed zero late", frozen, 244000).actual),
					`${kind}: zero-speed moved`,
				);
				check(
					!equalClouds(
						zero,
						record("zero-speed authored wind", { ...frozen, windX: -0.4 }, 0)
							.actual,
					),
					`${kind}: zero-speed incorrectly froze wind`,
				);
				record("fractional negative", cloudsParameters, -4005, {
					numerator: 30000,
					denominator: 1001,
				});
				record("huge local", cloudsParameters, Number.MAX_SAFE_INTEGER);
				record(
					"negative huge local",
					cloudsParameters,
					-Number.MAX_SAFE_INTEGER,
				);
				record(
					"small scale extreme wind",
					{
						...cloudsParameters,
						scale: 0.05,
						windX: -16,
						windY: 16,
						seed: 65535,
					},
					48000,
				);
				if (kind === "opaque" && width === 192) {
					const frames = [48000, 52000, 56000, 60000, 64000, 68000].map(
						(time) => {
							const frame = record(
								`raw evidence ${time}`,
								cloudsParameters,
								time,
							);
							return {
								ticks: time,
								rgba: encodeClouds(frame.actual),
								expectedRgba: encodeClouds(frame.expected.pixels),
							};
						},
					);
					Reflect.set(globalThis, "__cloudsFrames", {
						width,
						height,
						rate: cloudsRate,
						params: cloudsParameters,
						source: encodeClouds(source),
						frames,
					});
				}
			}
		}
	} catch (error) {
		report.failure =
			error instanceof Error ? (error.stack ?? error.message) : String(error);
	} finally {
		try {
			disposeGpu();
			report.gpuDisposed = true;
		} catch (error) {
			errors.push(`GPU dispose: ${String(error)}`);
		}
		try {
			graphics.free();
			report.queryFreed = true;
		} catch (error) {
			errors.push(`Query free: ${String(error)}`);
		}
	}
	report.ok =
		!report.failure &&
		!errors.length &&
		report.gpuDisposed &&
		report.queryFreed;
	return report;
}
