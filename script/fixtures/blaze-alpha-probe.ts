import * as wasm from "opencut-wasm";
import {
	applyEffectPasses,
	disposeGpu,
	initializeGpu,
	WasmRuntimeGraphicsQuery,
} from "opencut-wasm";
import {
	alphaAdjustment,
	alphaAnalytic,
	alphaContrasts,
	alphaIdentityPass,
	alphaSource,
	type AlphaImage,
} from "./blaze-alpha-cases";
import { alphaMetrics, alphaPredictions } from "./blaze-alpha-model";
import { alphaEmptyStackRejection } from "./blaze-alpha-admission";

type Stage = {
	id: string;
	width: number;
	height: number;
	rgba: string;
	role: string;
	referenceId?: string;
};
function encode(pixels: Uint8ClampedArray) {
	let binary = "";
	for (let offset = 0; offset < pixels.length; offset += 8192)
		binary += String.fromCharCode(...pixels.subarray(offset, offset + 8192));
	return btoa(binary);
}
function canvasFor(image: AlphaImage) {
	const canvas = new OffscreenCanvas(image.width, image.height);
	canvas
		.getContext("2d", { willReadFrequently: true })!
		.putImageData(
			new ImageData(
				new Uint8ClampedArray(image.pixels),
				image.width,
				image.height,
			),
			0,
			0,
		);
	return canvas;
}
function direct(canvas: OffscreenCanvas): AlphaImage {
	return {
		width: canvas.width,
		height: canvas.height,
		pixels: canvas
			.getContext("2d", { willReadFrequently: true })!
			.getImageData(0, 0, canvas.width, canvas.height).data,
	};
}
function copy(canvas: OffscreenCanvas) {
	const result = new OffscreenCanvas(canvas.width, canvas.height);
	result
		.getContext("2d", { willReadFrequently: true })!
		.drawImage(canvas, 0, 0);
	return result;
}

export async function runAlphaCalibration() {
	const nativeReadback =
		new URL(location.href).searchParams.get("nativeReadback") === "1";
	const stages: Stage[] = [],
		measurements: Record<string, unknown>[] = [],
		errors: string[] = [];
	const raw = {
		version: 2,
		kind: "independent-alpha-calibration-not-Blaze-acceptance",
		nativeReadback,
		emptyStackRejection: {
			attempted: false,
			rejected: false,
			matched: false,
			error: "",
		},
		stages,
	};
	const report = {
		ok: false,
		backend: "",
		nativeReadback,
		emptyStackRejection: raw.emptyStackRejection,
		errors,
		measurements,
		failure: "",
		currentStage: "",
		gpuDisposed: false,
		queryFreed: false,
		scope:
			"Independent synthetic Canvas/zero-amount-VHS-identity/color-adjustment calibration. Empty stacks are explicitly checked for rejection, not rendered. No Blaze oracle or shader; no changed Blaze gate; no codec, host or performance claim. Native texture capture only when nativeReadback=true.",
	};
	Reflect.set(globalThis, "__alphaRaw", raw);
	Reflect.set(globalThis, "__alphaProgress", report);
	const images = new Map<string, AlphaImage>();
	const check = (condition: boolean, message: string) => {
		if (!condition) errors.push(message);
	};
	function retain(
		id: string,
		image: AlphaImage,
		role: string,
		referenceId?: string,
	) {
		report.currentStage = id;
		images.set(id, image);
		stages.push({
			id,
			width: image.width,
			height: image.height,
			role,
			referenceId,
			rgba: encode(image.pixels),
		});
		if (!referenceId) return;
		const reference = images.get(referenceId)!;
		const metrics = alphaMetrics(image.pixels, reference.pixels);
		const predictions = Object.entries(alphaPredictions(reference)).map(
			([name, pixels]) => ({ name, ...alphaMetrics(image.pixels, pixels) }),
		);
		measurements.push({ id, referenceId, metrics, predictions });
		check(metrics.alphaDifferences === 0, `${id}: alpha changed`);
	}
	async function render(
		options: Parameters<typeof applyEffectPasses>[0],
		id: string,
		referenceId: string,
	) {
		if (!nativeReadback) return applyEffectPasses(options);
		const readback: unknown = Reflect.get(wasm, "applyEffectPassesReadback");
		if (typeof readback !== "function")
			throw Error(
				"Selected diagnostic package has no applyEffectPassesReadback export",
			);
		const result = (await readback(options)) as {
			rgba: Uint8Array;
			width: number;
			height: number;
			canvas: OffscreenCanvas;
			format: string;
			backend: string;
		};
		if (
			!(result.rgba instanceof Uint8Array) ||
			result.rgba.length !== result.width * result.height * 4 ||
			!["rgba8unorm", "bgra8unorm"].includes(result.format) ||
			result.backend !== "webgl"
		)
			throw Error("Invalid native calibration readback");
		retain(
			id,
			{
				width: result.width,
				height: result.height,
				pixels: new Uint8ClampedArray(result.rgba),
			},
			"pre-presentation straight RGBA8 from same invocation as returned canvas",
			referenceId,
		);
		check(
			alphaMetrics(images.get(id)!.pixels, images.get(referenceId)!.pixels)
				.differentBytes === 0,
			`${id}: independent analytic native bytes differ`,
		);
		measurements.push({
			id,
			readbackFormat: result.format,
			backend: result.backend,
			returnedByteOrder: "RGBA",
		});
		return result.canvas;
	}
	let graphics: WasmRuntimeGraphicsQuery | undefined;
	try {
		const sweep = alphaSource(),
			sweepCanvas = canvasFor(sweep);
		retain("A0-authored", sweep, "authored independent bytes");
		retain(
			"A1-put-get",
			direct(sweepCanvas),
			"pure Canvas put/get",
			"A0-authored",
		);
		const firstCopy = copy(sweepCanvas),
			secondCopy = copy(firstCopy);
		retain(
			"A2-copy-get",
			direct(firstCopy),
			"pure Canvas draw/get",
			"A1-put-get",
		);
		retain(
			"A3-copy-again-get",
			direct(secondCopy),
			"pure Canvas second draw/get",
			"A2-copy-get",
		);
		check(
			alphaMetrics(
				images.get("A2-copy-get")!.pixels,
				images.get("A3-copy-again-get")!.pixels,
			).differentBytes === 0,
			"Pure Canvas copy is not idempotent",
		);
		const black = alphaSource(true),
			blackCanvas = canvasFor(black);
		retain("C0-black-authored", black, "authored black alpha ladder");
		retain(
			"C1-black-put-get",
			direct(blackCanvas),
			"canonical black input",
			"C0-black-authored",
		);
		check(
			alphaMetrics(black.pixels, images.get("C1-black-put-get")!.pixels)
				.differentBytes === 0,
			"Black alpha input is not byte stable",
		);
		await initializeGpu();
		graphics = new WasmRuntimeGraphicsQuery();
		report.backend = graphics.selectedBackend() ?? "";
		check(
			report.backend === "webgl",
			"Calibration requires the same WebGL backend as the failed first run",
		);
		report.currentStage = "B-empty-stack-rejection";
		Object.assign(
			raw.emptyStackRejection,
			await alphaEmptyStackRejection(() =>
				applyEffectPasses({
					source: sweepCanvas,
					width: sweep.width,
					height: sweep.height,
					passes: [],
				}),
			),
		);
		measurements.push({
			id: "B-empty-stack-rejection",
			api: "applyEffectPasses",
			...raw.emptyStackRejection,
		});
		check(
			raw.emptyStackRejection.matched,
			`Empty stack rejection mismatch: ${JSON.stringify(raw.emptyStackRejection)}`,
		);
		const identity = await render(
			{
				source: sweepCanvas,
				width: sweep.width,
				height: sweep.height,
				passes: [alphaIdentityPass()],
			},
			"B0-identity-native-texture",
			"A1-put-get",
		);
		retain(
			"B0-identity-returned",
			direct(identity),
			"native VHS amount=0 identity pass returned canvas",
			nativeReadback ? "B0-identity-native-texture" : "A1-put-get",
		);
		retain(
			"B1-identity-copy",
			direct(copy(identity)),
			"native VHS amount=0 identity pass copied canvas",
			"B0-identity-returned",
		);
		for (const contrast of alphaContrasts) {
			const referenceId = `C-${contrast}-analytic`,
				actualId = `C-${contrast}-returned`;
			retain(
				referenceId,
				alphaAnalytic(contrast),
				"independent black contrast analytic texture bytes",
			);
			const actual = await render(
				{
					source: blackCanvas,
					width: black.width,
					height: black.height,
					passes: [alphaAdjustment(contrast)],
				},
				`C-${contrast}-native-texture`,
				referenceId,
			);
			retain(
				actualId,
				direct(actual),
				"non-Blaze color-adjustment returned canvas",
				nativeReadback ? `C-${contrast}-native-texture` : referenceId,
			);
			retain(
				`C-${contrast}-copy`,
				direct(copy(actual)),
				"non-Blaze color-adjustment copied canvas",
				actualId,
			);
		}
		for (const id of [
			"B1-identity-copy",
			...alphaContrasts.map((value) => `C-${value}-copy`),
		]) {
			const stage = stages.find((stage) => stage.id === id)!;
			check(
				alphaMetrics(
					images.get(id)!.pixels,
					images.get(stage.referenceId!)!.pixels,
				).differentBytes === 0,
				`${id}: additional Canvas copy changed bytes`,
			);
		}
	} catch (error) {
		report.failure =
			error instanceof Error ? (error.stack ?? error.message) : String(error);
	} finally {
		try {
			disposeGpu();
			report.gpuDisposed = true;
		} catch (error) {
			errors.push(`disposeGpu: ${String(error)}`);
		}
		try {
			graphics?.free();
			report.queryFreed = true;
		} catch (error) {
			errors.push(`query free: ${String(error)}`);
		}
	}
	report.ok =
		!report.failure &&
		!errors.length &&
		raw.emptyStackRejection.matched &&
		stages.length === (nativeReadback ? 21 : 17) &&
		report.gpuDisposed &&
		report.queryFreed;
	return report;
}
