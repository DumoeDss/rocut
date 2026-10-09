import {
	applyEffectPasses,
	disposeGpu,
	initializeGpu,
	resolveStylizedEffectJson,
	WasmRuntimeGraphicsQuery,
} from "opencut-wasm";
import {
	dropletsCodecCase,
	dropletsParameters,
	dropletsRate,
	dropletsSource,
	dropletsThresholds,
	dropletsVariants,
	type DropletsParams,
	type DropletsRate,
	type DropletsSourceKind,
} from "./droplets-cases";
import {
	dropletsDifference,
	dropletsExpected,
	dropletsGeometry,
} from "./droplets-oracle";
import {
	checkDropletsAdmission,
	type DropletsResolution,
} from "./droplets-browser-checks";

function resolve(
	params: DropletsParams,
	localTime: number,
	frameRate = dropletsRate,
): DropletsResolution {
	return JSON.parse(
		resolveStylizedEffectJson(
			JSON.stringify({
				effectType: "droplets",
				params,
				localTime,
				frameRate,
			}),
		),
	);
}
function read(canvas: OffscreenCanvas) {
	const context = new OffscreenCanvas(canvas.width, canvas.height).getContext(
		"2d",
	)!;
	context.drawImage(canvas, 0, 0);
	return context.getImageData(0, 0, canvas.width, canvas.height).data;
}
function render(
	source: OffscreenCanvas,
	params: DropletsParams,
	time: number,
	rate = dropletsRate,
) {
	const resolution = resolve(params, time, rate);
	if (resolution.error || !resolution.passes)
		throw Error(resolution.error ?? "Missing passes");
	if (!resolution.passes.length) return read(source);
	return read(
		applyEffectPasses({
			source,
			width: source.width,
			height: source.height,
			passes: resolution.passes.map((pass) => ({
				shader: pass.shader,
				uniforms: Object.entries(pass.uniforms).map(([name, value]) => ({
					name,
					value: Array.isArray(value) ? value : [value],
				})),
			})),
		}),
	);
}
function equal(a: Uint8ClampedArray, b: Uint8ClampedArray) {
	return a.length === b.length && a.every((value, index) => value === b[index]);
}
function encode(pixels: Uint8ClampedArray) {
	let text = "";
	for (let offset = 0; offset < pixels.length; offset += 8192)
		text += String.fromCharCode(...pixels.subarray(offset, offset + 8192));
	return btoa(text);
}

export async function runDropletsProbe() {
	const graphics = new WasmRuntimeGraphicsQuery();
	const requestedBackend =
		new URL(location.href).searchParams.get("backend") ?? "webgl";
	const results: Record<string, unknown>[] = [],
		errors: string[] = [];
	const check = (condition: unknown, message: string) => {
		if (!condition) errors.push(message);
	};
	try {
		await initializeGpu();
		if (graphics.selectedBackend() !== requestedBackend)
			throw Error("Requested GPU backend was not selected");
		checkDropletsAdmission(resolve, check, results);
		const rational = { numerator: 30000, denominator: 1001 };
		for (const [width, height] of [
			[192, 128],
			[128, 192],
		]) {
			const canvas = new OffscreenCanvas(width, height),
				context = canvas.getContext("2d")!;
			for (const kind of [
				"opaque",
				"holes",
				"transparent",
			] as DropletsSourceKind[]) {
				context.putImageData(
					new ImageData(dropletsSource(width, height, kind), width, height),
					0,
					0,
				);
				const source = read(canvas);
				const record = (
					name: string,
					params: DropletsParams,
					time: number,
					rate: DropletsRate = dropletsRate,
				) => {
					const expected = dropletsExpected(
						source,
						width,
						height,
						params,
						time,
						rate,
					);
					const actual = render(canvas, params, time, rate);
					const difference = dropletsDifference(actual, expected, source);
					const label = `${width}x${height} ${kind} ${name}`;
					results.push({
						name: label,
						time,
						...difference,
						activePixels: expected.activePixels,
						overlapPixels: expected.overlapPixels,
						exteriorTaps: expected.exteriorTaps,
					});
					check(
						!difference.failed && !difference.outsideFailed,
						`${label}: ${JSON.stringify(difference)}`,
					);
					if (kind === "transparent")
						check(
							actual.every((value) => value === 0),
							`${label}: transparent input gained color/coverage`,
						);
					return actual;
				};
				for (const [name, changes] of Object.entries({
					amountZero: { amount: 0 },
					countZero: { count: 0 },
					opticalZero: { refraction: 0, highlight: 0 },
				}))
					check(
						equal(
							record(name, { ...dropletsParameters, ...changes }, 48000),
							source,
						),
						`${kind} ${name} identity`,
					);
				const reference = record("reference", dropletsParameters, 48000);
				if (kind !== "transparent")
					check(!equal(reference, source), `${kind}: effect is a no-op`);
				for (const [name, changes] of Object.entries(dropletsVariants())) {
					const changed = record(
						name,
						{ ...dropletsParameters, ...changes },
						48000,
					);
					if (kind !== "transparent")
						check(!equal(changed, reference), `${kind}: ignored ${name}`);
				}
				const saved = new Map<number, Uint8ClampedArray>();
				for (const time of [
					-244000, -4000, -1, 0, 4000, 236000, 240000, 244000,
				])
					saved.set(time, record(`time ${time}`, dropletsParameters, time));
				for (const time of [244000, -4000, 0, 240000, -1, 244000])
					check(
						equal(render(canvas, dropletsParameters, time), saved.get(time)!),
						`Repeat/reverse changed ${kind} t${time}`,
					);
				check(
					equal(saved.get(0)!, saved.get(240000)!),
					`${kind}: exact two-second period mismatch`,
				);
				check(
					equal(saved.get(-1)!, saved.get(-4000)!),
					`${kind}: negative time did not floor to frame`,
				);
				const frozen = { ...dropletsParameters, speed: 0 };
				check(
					equal(
						record("speed zero", frozen, -4000),
						record("speed zero late", frozen, 244000),
					),
					`${kind}: speed zero moved`,
				);
				record("fractional rate", dropletsParameters, -4005, rational);
				const single = { ...dropletsParameters, count: 1 };
				const initial = dropletsGeometry(single, 0, dropletsRate)[0].phase;
				const wrapTicks = Math.ceil((1 - initial) * 240000);
				for (const time of [wrapTicks - 1, wrapTicks])
					check(
						equal(
							record("fully offscreen wrap", single, time, {
								numerator: 120000,
								denominator: 1,
							}),
							source,
						),
						`${kind}: wrap teleported a visible drop`,
					);
				if (kind === "opaque" && width === dropletsCodecCase.width) {
					const frames = dropletsCodecCase.ticks.map((time) => ({
						ticks: time,
						rgba: encode(record(`codec ${time}`, dropletsParameters, time)),
					}));
					Reflect.set(globalThis, "__dropletsFrames", {
						...dropletsCodecCase,
						source: encode(source),
						frames,
					});
				}
			}
		}
		return {
			ok: errors.length === 0,
			backend: graphics.selectedBackend(),
			thresholds: dropletsThresholds,
			results,
			errors,
			scope:
				"Native effect raster and resolver only; codec, production timeline, UI and installed host not evaluated here",
		};
	} catch (error) {
		return {
			ok: false,
			results,
			errors,
			failure: error instanceof Error ? error.stack : String(error),
		};
	} finally {
		disposeGpu();
		graphics.free();
	}
}
