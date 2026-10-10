import {
	report,
	handles,
	check,
	near,
	distinct,
} from "/canvas-capture-support.mjs";
import * as wasm from "/wasm-glue.mjs";
import {
	width,
	height,
	neutral,
	painted,
	grayPass,
	encode,
	read,
	source,
	passes,
	layer,
	group,
	frame,
	complete,
} from "/canvas-capture-support.mjs";

async function render(handle, id, items) {
	report.currentCase = id;
	const descriptor = frame(items),
		request = wasm.beginRenderFrameForHandle(handle, descriptor);
	const result = await complete(handle, request);
	report.frames.push({
		id,
		request,
		advanceCalls: result.calls,
		descriptor,
		presentationRgba: encode(result.bytes),
	});
	return result.bytes;
}
async function run() {
	let graphics;
	try {
		const wasmBytes = await (await fetch("/wasm.wasm")).arrayBuffer();
		const digest = new Uint8Array(
			await crypto.subtle.digest("SHA-256", wasmBytes),
		);
		report.loadedWasm = {
			bytes: wasmBytes.byteLength,
			sha256: [...digest]
				.map((byte) => byte.toString(16).padStart(2, "0"))
				.join(""),
		};
		const compiled = await WebAssembly.compile(wasmBytes);
		const imports = Object.fromEntries(
			WebAssembly.Module.imports(compiled).map(({ module }) => [module, wasm]),
		);
		const instance = await WebAssembly.instantiate(compiled, imports);
		wasm.__wbg_set_wasm(instance.exports);
		instance.exports.__wbindgen_start();
		report.currentCase = "initializeGpu";
		await wasm.initializeGpu();
		graphics = new wasm.WasmRuntimeGraphicsQuery();
		report.backend = graphics.selectedBackend();
		check(
			"selected-backend",
			report.backend === new URL(location.href).searchParams.get("backend"),
			report.backend,
		);
		const handle = wasm.createCompositor(width, height);
		handles.add(handle);
		const raw = source(false),
			gray = source(true),
			rawBytes = read(raw),
			grayBytes = read(gray);
		wasm.uploadTextureForHandle(handle, {
			id: "source",
			source: raw,
			width,
			height,
		});
		wasm.uploadTextureForHandle(handle, {
			id: "gray",
			source: gray,
			width,
			height,
		});
		report.sources = {
			rawRgba: encode(rawBytes),
			grayRgba: encode(grayBytes),
			width,
			height,
		};
		const baseline = await render(handle, "baseline", [layer()]);
		near("source-upload-and-presentation", baseline, rawBytes, 1);
		const plain = await render(handle, "neutral-layer", [
			layer("source", [passes(neutral)]),
		]);
		near("full-resolution-neutral-not-grid-upscale", plain, rawBytes);
		const paint = await render(handle, "painted", [
			layer("source", [passes(painted)]),
		]);
		distinct("material-and-stroke-visible", paint, plain);
		await render(handle, "seek-late", [
			layer("source", [passes(painted, 100000)]),
		]);
		const repeat = await render(handle, "seek-back-repeat", [
			layer("source", [passes(painted)]),
		]);
		near("reverse-seek-bit-exact", repeat, paint, 0);
		const ordered = await render(handle, "ordered-scene-prefix", [
			layer(),
			{
				type: "sceneEffect",
				effectPassGroups: [[grayPass, ...passes(neutral)]],
			},
		]);
		near("capture-reads-prefix-independent-gray", ordered, grayBytes);
		distinct("wrong-original-input-negative-sensitive", ordered, rawBytes, 15);
		const paintGray = await render(handle, "paint-pregrayed-source", [
			layer("gray", [passes(painted)]),
		]);
		const orderedPaint = await render(handle, "paint-ordered-layer", [
			layer("source", [[grayPass, ...passes(painted)]]),
		]);
		near(
			"paint-prefix-vs-pretransformed-metamorphic",
			orderedPaint,
			paintGray,
			3,
		);
		distinct("paint-prefix-not-original", orderedPaint, paint, 5);
		const nested = await render(handle, "nested-group", [
			{
				type: "group",
				...group(
					[
						{
							type: "group",
							...group([layer()], [[grayPass, ...passes(neutral)]]),
						},
					],
					[passes(neutral)],
				),
			},
		]);
		near("nested-capture-independent-gray", nested, grayBytes);
		const both = await render(handle, "dual-branch-transition", [
			{
				type: "sceneTransition",
				outgoing: group([layer()], [passes(neutral)]),
				incoming: group([layer("gray")], [passes(neutral)]),
				progress: 0.25,
			},
		]);
		const expectedBlend = Uint8Array.from(rawBytes, (value, index) =>
			Math.round(value * 0.75 + grayBytes[index] * 0.25),
		);
		near("both-branches-capture-independent-blend", both, expectedBlend, 3);
		distinct("incoming-branch-not-ignored", both, plain, 3);
		const prepainted = new OffscreenCanvas(width, height);
		prepainted
			.getContext("2d")
			.putImageData(
				new ImageData(new Uint8ClampedArray(paint), width, height),
				0,
				0,
			);
		wasm.uploadTextureForHandle(handle, {
			id: "prepainted",
			source: prepainted,
			width,
			height,
		});
		const secondPaint = {
			...painted,
			seed: 29,
			stroke0FromY: 0.75,
			stroke0ToY: 0.25,
		};
		const referenceSecond = await render(handle, "prepainted-second-pass", [
			layer("prepainted", [passes(secondPaint)]),
		]);
		const consecutive = await render(handle, "consecutive-canvas", [
			layer("source", [[...passes(painted), ...passes(secondPaint)]]),
		]);
		near(
			"consecutive-pass-input-position-metamorphic",
			consecutive,
			referenceSecond,
		);
		distinct("consecutive-second-pass-not-skipped", consecutive, paint, 3);
		let rejection = null;
		try {
			await render(handle, "missing-inactive-resource", [
				{
					type: "sceneTransition",
					outgoing: group([layer()], [passes(neutral)]),
					incoming: group([layer("missing")]),
					progress: 0,
				},
			]);
		} catch (error) {
			rejection = {
				name: error?.name,
				message: error?.message ?? String(error),
			};
		}
		check(
			"inactive-resource-rejected-before-capture",
			Boolean(rejection?.message.match(/texture|resource/i)),
			rejection,
		);
		const recovery = await render(handle, "resource-recovery", [
			layer("source", [passes(neutral)]),
		]);
		near("resource-rejection-recovery", recovery, plain, 0);
		const old = wasm.beginRenderFrameForHandle(
			handle,
			frame([layer("source", [passes(painted)])]),
		);
		const pending = wasm.advanceRenderFrameForHandle(handle, old, 64).then(
			(value) => ({ value }),
			(error) => ({
				name: error.name,
				code: error.code,
				message: error.message,
			}),
		);
		const replacement = wasm.beginRenderFrameForHandle(
			handle,
			frame([layer("gray", [passes(neutral)])]),
		);
		const cancelled = await pending;
		check(
			"replacement-rejects-old-pending-request",
			cancelled.name === "AbortError" && cancelled.code === "RENDER_CANCELLED",
			cancelled,
		);
		const replacementResult = await complete(handle, replacement);
		near(
			"replacement-owner-publishes-own-source",
			replacementResult.bytes,
			grayBytes,
		);
		let staleCommit = null;
		try {
			wasm.commitRenderFrameForHandle(handle, old);
		} catch (error) {
			staleCommit = error.name;
		}
		check(
			"old-request-cannot-commit",
			staleCommit === "AbortError",
			staleCommit,
		);
	} catch (error) {
		report.failure = error.stack ?? String(error);
	} finally {
		try {
			for (const handle of handles) wasm.disposeCompositor(handle);
			graphics?.free();
			wasm.disposeGpu();
			report.disposed = true;
		} catch (error) {
			report.cleanupFailure = String(error);
		}
		report.ok =
			!report.failure &&
			!report.cleanupFailure &&
			report.checks.every((entry) => entry.passed);
		Reflect.set(globalThis, "__canvasCaptureResult", report);
	}
}
run();
