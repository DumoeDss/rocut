import { makeBubbleSource, flattenBubbleParams } from "./bubble-cases.mjs";
import { renderBubbleOracle } from "./bubble-oracle.mjs";
import { compareBubbleRgba, assessBubbleNative } from "./bubble-metrics.mjs";
import { bubbleReadCanvas, bubbleEncode } from "./bubble-browser-support.mjs";
import { canvasImportBrowserContract as contract, canvasImportMatrix, canvasImportCallers,
	canvasImportRecoverySample as recoverySample, canvasImportNormalSamples } from "./canvas-import-browser-contract.mjs";
import { canvasImportError, matchesCanvasImportRejection, cropCanvasImportRgba, injectCanvasImportReadError, canvasImportRejectAndRecover } from "./canvas-import-browser-support.mjs";

export async function runCanvasImportBrowserProbe(wasm, { backend = "webgl", diagnostic = false } = {}) {
	if (!["webgl", "webgpu"].includes(backend)) throw Error("Explicit webgl/webgpu backend required");
	const report = { ok: false, skipped: false, backend, diagnostic, contract, selectedBackend: null,
		admissions: [], normals: [], subrectangles: [], recoveries: [], errors: [], gpuDisposed: false,
		externalCopyExceptionCovered: false, nativeReadbackAcceptance: diagnostic ? false : null };
	globalThis.__canvasImportProgress = report;
	let graphics, initialized = false;
	const ownedCompositors = new Set();
	const releaseCompositor = (handle) => {
		if (!ownedCompositors.has(handle)) throw Error("Attempt to release an unowned fixture compositor");
		wasm.disposeCompositor(handle);
		ownedCompositors.delete(handle);
		report.compositorDisposeCount = (report.compositorDisposeCount ?? 0) + 1;
	};
	const withOwnedCompositor = async (operation) => {
		const handle = wasm.createCompositor(96, 64);
		ownedCompositors.add(handle);
		report.compositorCreateCount = (report.compositorCreateCount ?? 0) + 1;
		try { return await operation(handle); }
		finally { releaseCompositor(handle); }
	};
	const initialize = async () => {
		await wasm.initializeGpu(); initialized = true;
		graphics = new wasm.WasmRuntimeGraphicsQuery();
		const selected = graphics.selectedBackend(); graphics.free(); graphics = null;
		if (selected !== backend) throw Error(`Requested ${backend}, selected ${selected}`);
		report.selectedBackend = selected;
	};
	const dispose = () => { wasm.disposeGpu(); initialized = false; report.disposeCount = (report.disposeCount ?? 0) + 1; };
	const makeSource = (sample) => {
		const source = new OffscreenCanvas(sample.width, sample.height), context = source.getContext("2d", { willReadFrequently: true });
		if (!context) throw Error("Source 2D context unavailable");
		const authored = makeBubbleSource(sample.sourceSpec, sample.width, sample.height);
		context.putImageData(new ImageData(new Uint8ClampedArray(authored), sample.width, sample.height), 0, 0);
		return { source, context, canonical: bubbleReadCanvas(source) };
	};
	const passes = (sample) => {
		const resolved = JSON.parse(wasm.resolveStylizedEffectJson(JSON.stringify({ effectType: "bubble", params: flattenBubbleParams(sample), localTime: sample.ticks, frameRate: sample.frameRate })));
		if (resolved.error || !resolved.passes?.length) throw Error(resolved.error ?? "No Bubble passes");
		return resolved.passes.map((pass) => ({ shader: pass.shader, uniforms: Object.entries(pass.uniforms).map(([name, value]) => ({ name, value: Array.isArray(value) ? value : [value] })) }));
	};
	const bubbleFrame = async (id, sample = recoverySample, retained = makeSource(sample), width = sample.width, height = sample.height) => {
		const canonical = cropCanvasImportRgba(retained.canonical, sample.width, width, height), oracleSample = { ...sample, width, height };
		const expected = renderBubbleOracle(oracleSample, canonical).rgba;
		const options = { source: retained.source, width, height, passes: passes(oracleSample) };
		let canvas, native = null, format = null;
		if (diagnostic) {
			const actual = await wasm.applyEffectPassesReadback(options);
			if (actual.backend !== backend || !["rgba8unorm", "bgra8unorm"].includes(actual.format) || actual.width !== width || actual.height !== height || !(actual.rgba instanceof Uint8Array) || actual.rgba.length !== width * height * 4)
				throw Error("Diagnostic native readback contract mismatch");
			canvas = actual.canvas; native = actual.rgba; format = actual.format;
		} else canvas = wasm.applyEffectPasses(options);
		if (canvas.width !== width || canvas.height !== height) throw Error("Bubble result dimensions changed");
		const actual = bubbleReadCanvas(canvas), canvasMetrics = compareBubbleRgba(actual, expected), canvasAssessment = assessBubbleNative(canvasMetrics);
		const nativeMetrics = native ? compareBubbleRgba(native, expected) : null, nativeAssessment = native ? assessBubbleNative(nativeMetrics) : null;
		return { id, ok: canvasAssessment.ok && (!diagnostic || nativeAssessment?.ok === true), width, height, format,
			byteOrder: native ? "RGBA normalized by same-call Rust readback" : null, canvasMetrics, canvasAssessment, nativeMetrics, nativeAssessment,
			sourceRgba: bubbleEncode(canonical), expectedRgba: bubbleEncode(expected), canvasRgba: bubbleEncode(actual), nativeRgba: native ? bubbleEncode(native) : null,
			expectedFrom: "Frozen independent Bubble oracle on canonical source; never production rendered expected" };
	};
	const recover = async (id) => { const frame = await bubbleFrame(id); report.recoveries.push(frame); return { ok: frame.ok, index: report.recoveries.length - 1 }; };
	const restart = async (id) => { dispose(); await initialize(); report.reinitializeCount = (report.reinitializeCount ?? 0) + 1; return recover(`reinitialize:${id}`); };
	try {
		if (backend === "webgpu") {
			const adapter = await navigator.gpu?.requestAdapter({ forceFallbackAdapter: false });
			if (!adapter) { report.skipped = true; report.skipReason = "No WebGPU adapter available; no hardware/WebGPU acceptance claimed"; return report; }
			report.adapterInfo = adapter.info ? { vendor: adapter.info.vendor, architecture: adapter.info.architecture, description: adapter.info.description } : null;
			report.hardwareVerified = false; // API adapter presence alone does not prove hardware.
		}
		if (diagnostic && typeof wasm.applyEffectPassesReadback !== "function") throw Error("Diagnostic package readback export required");
		if (!diagnostic && typeof wasm.applyEffectPassesReadback === "function") throw Error("Default package contains diagnostic export");
		await initialize();
		for (const sample of canvasImportNormalSamples) {
			const frame = await bubbleFrame(`normal:${sample.id}`, sample); report.normals.push(frame);
			if (!frame.ok) throw Error(`Independent oracle gate failed: ${sample.id}`);
		}
		for (const input of canvasImportMatrix) {
			if (input.fallbackOnly && backend !== "webgl") { report.admissions.push({ key: input.key, skipped: true, reason: "Fallback-only path; external-copy exceptions are not exercised" }); continue; }
			const retained = makeSource(recoverySample);
			if (input.id === "unavailable-2d") {
				retained.source = new OffscreenCanvas(96, 64);
				if (!retained.source.getContext("webgl2")) throw Error("Real WebGL2 source context unavailable");
				if (retained.source.getContext("2d") !== null) throw Error("WebGL source unexpectedly admits 2D context");
			}
			const attempt = () => {
				if (input.caller === "effects") return wasm.applyEffectPasses({ source: retained.source, width: input.width, height: input.height, passes: passes(recoverySample) });
				if (input.caller === "masks") return wasm.applyMaskFeather({ mask: retained.source, width: input.width, height: input.height, feather: 0 });
				return withOwnedCompositor((handle) => wasm.uploadTextureForHandle(handle, { id: `import-${input.key}`, source: retained.source, width: input.width, height: input.height }));
			};
			const observation = await canvasImportRejectAndRecover({ attempt,
				prepare: input.originalJsError ? () => injectCanvasImportReadError(OffscreenCanvasRenderingContext2D.prototype, retained.context) : undefined,
				match: (error, state) => matchesCanvasImportRejection(input, error, state),
				recover: () => recover(`after:${input.key}`), restart: () => restart(input.key) });
			report.admissions.push({ key: input.key, caller: input.caller, width: input.width, height: input.height,
				stage: input.caller === "effects" && (input.id.startsWith("zero-") || input.id.startsWith("device-")) ? "existing-effects-preflight" : "canvas-import-result", ...observation });
			if (!observation.ok) throw Error(`Rejection/recovery failed: ${input.key}: ${JSON.stringify(observation)}`);
		}
		for (const caller of canvasImportCallers) {
			const retained = makeSource(recoverySample), { width, height } = contract.subrectangle;
			let accepted;
			if (caller === "effects") accepted = await bubbleFrame("subrectangle:effects", recoverySample, retained, width, height);
			else if (caller === "masks") { const output = wasm.applyMaskFeather({ mask: retained.source, width, height, feather: 0 }); accepted = { ok: output.width === width && output.height === height }; }
			else accepted = await withOwnedCompositor((handle) => { wasm.uploadTextureForHandle(handle, { id: "subrectangle", source: retained.source, width, height }); return { ok: true }; });
			const recovery = await recover(`subrectangle:${caller}`), restarted = await restart(`subrectangle:${caller}`);
			report.subrectangles.push({ caller, accepted, recovery, restarted, ok: accepted.ok && recovery.ok && restarted.ok });
			if (!report.subrectangles.at(-1).ok) throw Error(`Subrectangle failed: ${caller}`);
		}
		report.nativeReadbackAcceptance = diagnostic ? report.normals.every((frame) => frame.nativeAssessment?.ok) && report.recoveries.every((frame) => frame.nativeAssessment?.ok) : null;
		report.observedNativeFormats = [...new Set([...report.normals, ...report.recoveries].map((frame) => frame.format).filter(Boolean))];
		report.missingNativeFormats = ["rgba8unorm", "bgra8unorm"].filter((format) => !report.observedNativeFormats.includes(format));
		report.bothStorageFormatsCovered = diagnostic && report.missingNativeFormats.length === 0;
		report.completed = true;
	} catch (error) { report.failure = canvasImportError(error); }
	finally {
		// Only handles created by this fixture are eligible for final cleanup.
		// Keep failed releases owned, so cleanup failure cannot silently leak green.
		for (const handle of ownedCompositors) {
			try { releaseCompositor(handle); }
			catch (error) { report.errors.push({ stage: "disposeCompositor", handle, ...canvasImportError(error) }); }
		}
		report.ownedCompositorsRemaining = ownedCompositors.size;
		try { if (initialized) dispose(); report.gpuDisposed = true; } catch (error) { report.errors.push({ stage: "disposeGpu", ...canvasImportError(error) }); }
		try { graphics?.free(); } catch (error) { report.errors.push({ stage: "graphics.free", ...canvasImportError(error) }); }
	}
	report.ok = Boolean(report.completed && !report.failure && !report.errors.length && report.gpuDisposed && report.ownedCompositorsRemaining === 0);
	return report;
}
