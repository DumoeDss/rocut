import {
	disposeGpu,
	initializeGpu,
	WasmRuntimeGraphicsQuery,
} from "opencut-wasm";
import {
	blazeCases,
	blazeModes,
	blazeParameters,
	blazeRate,
	blazeSeekTicks,
	blazeSource,
	type BlazeParams,
	type BlazeRate,
	type BlazeSourceKind,
} from "./blaze-cases";
import { blazeExpected } from "./blaze-oracle";
import { checkBlazeAdmission, blazeVariants } from "./blaze-browser-checks";
import {
	blazeActivePixels,
	blazeEqual,
	blazeRawThresholds,
	compareBlazeRaw,
} from "./blaze-browser-metrics";
import { blazeNegativeControls } from "./blaze-browser-negatives";
import {
	encodeBlaze,
	readBlaze,
	renderBlaze,
	resolveBlaze,
} from "./blaze-browser-support";

export async function runBlazeProbe() {
	const graphics = new WasmRuntimeGraphicsQuery();
	const results: Record<string, unknown>[] = [],
		errors: string[] = [];
	const raw = {
		version: 1,
		reference:
			"Independent blazeExpected on canonical input RGBA; never production-rendered expected pixels",
		thresholds: blazeRawThresholds,
		sources: [] as Record<string, unknown>[],
		frames: [] as Record<string, unknown>[],
		negatives: [] as Record<string, unknown>[],
	};
	const report = {
		ok: false,
		backend: "",
		thresholds: blazeRawThresholds,
		results,
		errors,
		failure: "",
		currentCase: "",
		gpuDisposed: false,
		queryFreed: false,
		scope:
			"Native Blaze resolver and full-frame RAW raster only; disabled is fixture stack-bypass control, not production timeline. No codec, UI, animation, installed host, or performance acceptance.",
	};
	const check = (condition: unknown, message: string) => {
		if (!condition) errors.push(message);
	};
	Reflect.set(globalThis, "__blazeProgress", report);
	Reflect.set(globalThis, "__blazeFrames", raw);
	try {
		await initializeGpu();
		report.backend = graphics.selectedBackend() ?? "";
		if (
			report.backend !==
			(new URL(location.href).searchParams.get("backend") ?? "webgl")
		)
			throw Error("Requested Blaze backend was not selected");
		checkBlazeAdmission(resolveBlaze, check, results);
		for (const [width, height] of [
			[192, 128],
			[256, 96],
			[96, 256],
		]) {
			for (const kind of [
				"opaque",
				"holes",
				"transparent",
			] as BlazeSourceKind[]) {
				const canvas = new OffscreenCanvas(width, height),
					context = canvas.getContext("2d", { willReadFrequently: true })!;
				context.putImageData(
					new ImageData(blazeSource({ width, height, kind }), width, height),
					0,
					0,
				);
				// Canonical input is read BEFORE any production effect and becomes oracle input.
				const source = readBlaze(canvas),
					sourceId = `${width}x${height}-${kind}`;
				raw.sources.push({
					id: sourceId,
					width,
					height,
					kind,
					pattern: "gradient",
					rgba: encodeBlaze(source),
				});
				const record = (
					name: string,
					params: BlazeParams,
					ticks: number,
					rate: BlazeRate = blazeRate,
					enabled = true,
					capture = true,
				) => {
					const label = `${sourceId} ${name}`;
					report.currentCase = label;
					const expected = blazeExpected({
						source,
						width,
						height,
						params,
						ticks,
						rate,
						enabled,
					});
					const actual = renderBlaze(canvas, params, ticks, rate, enabled);
					const metric = compareBlazeRaw(actual, expected.pixels),
						activePixels = blazeActivePixels(expected.pixels, source);
					results.push({
						name: label,
						params,
						ticks,
						rate,
						enabled,
						activePixels,
						fieldActivePixels: expected.activePixels,
						exteriorPixels: expected.exteriorPixels,
						...metric,
					});
					check(metric.pass, `${label}: ${JSON.stringify(metric)}`);
					if (
						!enabled ||
						params.amount === 0 ||
						[
							params.flameOpacity,
							params.sparkOpacity,
							params.smokeOpacity,
							params.refraction,
						].every((value) => value === 0)
					)
						check(
							blazeEqual(actual, source),
							`${label}: explicit bypass changed source bytes`,
						);
					if (
						kind === "transparent" &&
						params.flameOpacity === 0 &&
						params.sparkOpacity === 0 &&
						params.smokeOpacity === 0
					)
						check(
							actual.every((value) => value === 0),
							`${label}: pure heat manufactured alpha/color`,
						);
					if (capture)
						raw.frames.push({
							id: label,
							sourceId,
							params,
							ticks,
							rate,
							enabled,
							rgba: encodeBlaze(actual),
							expectedRgba: encodeBlaze(expected.pixels),
							metric,
							activePixels,
						});
					return { actual, expected, activePixels };
				};
				for (const sample of blazeCases()) {
					const frame = record(
						sample.id,
						sample.params,
						sample.ticks,
						sample.rate,
						sample.enabled,
						true,
					);
					if (
						["flame", "sparks", "smoke", "heat", "combined"].includes(
							sample.id,
						) &&
						!(kind === "transparent" && sample.id === "heat")
					) {
						const minimum =
							sample.id === "sparks"
								? blazeRawThresholds.minimumSparkActivePixels
								: blazeRawThresholds.minimumBroadActivePixels;
						check(
							frame.activePixels >= minimum,
							`${sourceId} ${sample.id}: inactive oracle fixture (${frame.activePixels}/${minimum})`,
						);
					}
				}
				const reference = record(
					"parameter-reference",
					blazeParameters,
					48000,
				).actual;
				for (const [key, value] of Object.entries(blazeVariants)) {
					const changed = record(
						`parameter-${key}`,
						{ ...blazeParameters, [key]: value },
						48000,
					).actual;
					if (!(kind === "transparent" && key === "refraction"))
						check(
							!blazeEqual(changed, reference),
							`${sourceId}: ignored ${key}`,
						);
				}
				const saved = new Map<number, Uint8ClampedArray>();
				for (const [index, ticks] of blazeSeekTicks.entries()) {
					const frame = record(
						`seek ${index} ticks ${ticks}`,
						blazeParameters,
						ticks,
					).actual;
					if (saved.has(ticks))
						check(
							blazeEqual(frame, saved.get(ticks)!),
							`${sourceId}: reverse/repeat seek changed ${ticks}`,
						);
					saved.set(ticks, frame);
				}
				check(
					blazeEqual(
						saved.get(0)!,
						record("exact binary speed period", blazeParameters, 240000).actual,
					),
					`${sourceId}: two-second binary-speed period changed`,
				);
				check(
					blazeEqual(
						record("negative floor", blazeParameters, -1).actual,
						record("negative floor frame", blazeParameters, -4000).actual,
					),
					`${sourceId}: negative frame floor differs`,
				);
				const frozen = { ...blazeParameters, speed: 0 },
					still = record("speed zero", frozen, -4000).actual;
				check(
					blazeEqual(
						still,
						record("speed zero late", frozen, Number.MAX_SAFE_INTEGER).actual,
					),
					`${sourceId}: speed zero moved`,
				);
				check(
					!blazeEqual(
						still,
						record("speed zero authored wind", { ...frozen, wind: -0.5 }, 0)
							.actual,
					),
					`${sourceId}: speed zero wrongly froze authored wind`,
				);
				if (kind === "holes" && width === 192) {
					for (const ticks of [56000, 60000, 64000, 236000, 240000, 244000])
						record(
							`phase-boundary ${ticks}`,
							blazeParameters,
							ticks,
							blazeRate,
							true,
							true,
						);
					for (const seed of [0, 1, 65535])
						record(
							`seed-boundary ${seed}`,
							{ ...blazeParameters, seed },
							48000,
							blazeRate,
							true,
							true,
						);
					for (const ticks of [
						-4005,
						-1,
						4003,
						4004,
						Number.MAX_SAFE_INTEGER,
						-Number.MAX_SAFE_INTEGER,
					])
						record(`rational-time ${ticks}`, blazeParameters, ticks, {
							numerator: 30000,
							denominator: 1001,
						});
					for (const ticks of [0, 48000, 300000])
						record(
							`default-speed-f64 ${ticks}`,
							{ ...blazeParameters, speed: 0.4 },
							ticks,
						);
					for (const wind of [-1, 0, 1])
						record(
							`small-scale extreme-wind ${wind}`,
							{
								...blazeParameters,
								scale: 0.025,
								wind,
								height: 1.5,
								refraction: 0.08,
							},
							48000,
						);
				}
				await new Promise((resolve) => setTimeout(resolve, 0));
			}
		}
		const stressCanvas = new OffscreenCanvas(192, 128),
			stressContext = stressCanvas.getContext("2d", {
				willReadFrequently: true,
			})!;
		stressContext.putImageData(
			new ImageData(blazeSource({ pattern: "stress" }), 192, 128),
			0,
			0,
		);
		const stress = readBlaze(stressCanvas),
			negativeControls = blazeNegativeControls(
				{ source: stress, width: 192, height: 128 },
				(name, mutant, reference, params) => {
					raw.negatives.push({
						name,
						sourceId: "192x128-holes-stress",
						params,
						ticks: 48000,
						rate: blazeRate,
						enabled: true,
						mutantRgba: encodeBlaze(mutant),
						referenceRgba: encodeBlaze(reference),
					});
				},
			);
		results.push({
			name: "independent pre-registered negative controls on canonical stress input",
			negativeControls,
		});
		for (const negative of negativeControls)
			check(
				negative.rejected,
				`Insensitive negative control: ${JSON.stringify(negative)}`,
			);
		raw.sources.push({
			id: "192x128-holes-stress",
			width: 192,
			height: 128,
			kind: "holes",
			pattern: "stress",
			rgba: encodeBlaze(stress),
		});
		for (const mode of ["heat", "combined"]) {
			const params = { ...blazeParameters, ...blazeModes[mode], amount: 1 },
				ticks = 48000;
			const expected = blazeExpected({
				source: stress,
				width: 192,
				height: 128,
				params,
				ticks,
				rate: blazeRate,
			});
			const actual = renderBlaze(stressCanvas, params, ticks),
				metric = compareBlazeRaw(actual, expected.pixels);
			check(metric.pass, `Stress ${mode}: ${JSON.stringify(metric)}`);
			results.push({
				name: `stress ${mode}`,
				...metric,
				exteriorPixels: expected.exteriorPixels,
			});
			raw.frames.push({
				id: `stress ${mode}`,
				sourceId: "192x128-holes-stress",
				params,
				ticks,
				rate: blazeRate,
				enabled: true,
				rgba: encodeBlaze(actual),
				expectedRgba: encodeBlaze(expected.pixels),
				metric,
			});
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
