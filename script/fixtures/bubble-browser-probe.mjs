import * as wasm from "opencut-wasm";
import { bubbleCases, bubbleAdmissionCases, bubbleSupplementalAdmissionCases, makeBubbleSource, flattenBubbleParams } from "./bubble-cases.mjs";
import { renderBubbleOracle } from "./bubble-oracle.mjs";
import { BUBBLE_NATIVE_GATES, compareBubbleRgba, assessBubbleNative } from "./bubble-metrics.mjs";
import { BUBBLE_NEGATIVE_CONTROLS, bubbleNegativesForCase, bubbleInvariantNegatives } from "./bubble-negatives.mjs";
import { bubbleEncode, bubbleReadCanvas, bubbleSameBytes, bubbleRejectAndRecover, createBubbleBridge } from "./bubble-browser-support.mjs";

export async function runBubbleProbe() {
	const query = new URL(location.href).searchParams;
	const diagnostic = query.get("diagnostic") === "1", backend = query.get("backend") ?? "webgl";
	const bridge = createBubbleBridge(wasm), errors = [], results = [], admissions = [], equivalences = [];
	const raw = {
		version: 1, kind: "bubble-raster-native-and-presentation-separate", diagnostic,
		reference: "Independent frozen Bubble CPU oracle on retained canonical input; never production-rendered expected pixels",
		thresholds: BUBBLE_NATIVE_GATES, sources: [], frames: [], negatives: [], invariantNegatives: [], pendingFrame: null,
	};
	const report = {
		ok: false, diagnostic, backend: "", requestedBackend: backend, thresholds: BUBBLE_NATIVE_GATES,
		nativeAcceptance: diagnostic ? false : null, nativeFrames: 0, pipelineFrames: 0,
		errors, results, admissions, equivalences, recoveries: [], failure: "", currentCase: "",
		gpuDisposed: false, queryFreed: false, caught: false, completed: false,
		scope: "Bubble WASM resolver and effect raster only. Fixture disabled bypass is not production stack/editor validation. Clock offsets are fixture arithmetic, not Host/timeline integration. Canvas and same-call diagnostic native textures are separate; no codec, pooling or performance acceptance.",
	};
	Reflect.set(globalThis, "__bubbleRaw", raw);
	Reflect.set(globalThis, "__bubbleProgress", report);
	const check = (condition, message) => { if (!condition) errors.push(message); };
	const sources = new Map(), saved = new Map(), baselines = new Map();
	const requiredBaselines = new Set(bubbleCases.map((sample) => sample.baselineId).filter(Boolean));
	let graphics, recoveryBaseline;
	async function recoverAfter(id) {
		if (!recoveryBaseline) throw Error("Missing completed small Bubble recovery baseline");
		const { sample, canvas, actual: baseline, expected } = recoveryBaseline;
		report.currentCase = `recovery:${id}`;
		const actual = await bridge.render({ source: canvas, params: flattenBubbleParams(sample), ticks: sample.ticks,
			rate: sample.frameRate, enabled: true, diagnostic, backend });
		const sameCanvas = bubbleSameBytes(actual.canvas, baseline.canvas);
		const sameNative = diagnostic ? Boolean(actual.native && baseline.native && bubbleSameBytes(actual.native, baseline.native)) : null;
		const nativeAssessment = actual.native ? assessBubbleNative(compareBubbleRgba(actual.native, expected.rgba)) : null;
		const canvasAssessment = assessBubbleNative(compareBubbleRgba(actual.canvas, expected.rgba));
		const entry = { after: id, referenceCase: sample.id, sourceId: sample.sourceId, renderPath: actual.path,
			width: sample.width, height: sample.height, sameCanvas, sameNative, nativeAssessment, canvasAssessment,
			passed: actual.path === (diagnostic ? "applyEffectPassesReadback" : "applyEffectPasses") && sameCanvas && canvasAssessment.ok &&
				(!diagnostic || sameNative && nativeAssessment?.ok === true),
			canvasRgba: bubbleEncode(actual.canvas), nativeRgba: actual.native ? bubbleEncode(actual.native) : null,
			expectedRgba: bubbleEncode(expected.rgba),
			scope: "Small real render after rejected request; retained recovery bytes compare to prior same-package frame and frozen independent oracle. No allocation/pooling claim." };
		report.recoveries.push(entry);
		return { index: report.recoveries.length - 1, referenceCase: sample.id, passed: entry.passed };
	}
	try {
		await wasm.initializeGpu();
		graphics = new wasm.WasmRuntimeGraphicsQuery();
		report.backend = graphics.selectedBackend() ?? "";
		if (report.backend !== backend) throw Error(`Requested ${backend}, selected ${report.backend}`);
		if (diagnostic && typeof Reflect.get(wasm, "applyEffectPassesReadback") !== "function")
			throw Error("Diagnostic package lacks native readback API");
		if (!diagnostic && typeof Reflect.get(wasm, "applyEffectPassesReadback") === "function")
			throw Error("Default package unexpectedly contains diagnostic readback export");
		for (const sample of bubbleCases) {
			report.currentCase = sample.id;
			if (!sources.has(sample.sourceId)) {
				const authored = makeBubbleSource(sample.sourceSpec, sample.width, sample.height);
				const canvas = new OffscreenCanvas(sample.width, sample.height);
				const context = canvas.getContext("2d", { willReadFrequently: true });
				if (!context) throw Error("Missing source Canvas context");
				context.putImageData(new ImageData(new Uint8ClampedArray(authored), sample.width, sample.height), 0, 0);
				const canonical = bubbleReadCanvas(canvas);
				sources.set(sample.sourceId, { canvas, canonical, sample });
				raw.sources.push({ id: sample.sourceId, width: sample.width, height: sample.height, sourceSpec: sample.sourceSpec,
					authoredRgba: bubbleEncode(authored), rgba: bubbleEncode(canonical),
					canonicalization: compareBubbleRgba(canonical, authored),
				});
			}
			const { canvas, canonical } = sources.get(sample.sourceId);
			check(sample.timelineTicks - sample.timeOffsetTicks === sample.ticks, `${sample.id}: fixture clock offset mismatch`);
			const ticks = sample.timelineTicks - sample.timeOffsetTicks;
			const params = flattenBubbleParams(sample);
			const expected = renderBubbleOracle(sample, canonical);
			raw.pendingFrame = { id: sample.id, sourceId: sample.sourceId, sample, productionParams: params,
				expectedRgba: bubbleEncode(expected.rgba), scope: "Expected bytes retained before attempting native rendering; no completed actual frame yet" };
			const actual = await bridge.render({ source: canvas, params, ticks, rate: sample.frameRate, enabled: sample.enabled, diagnostic, backend });
			const nativeMetrics = actual.native ? compareBubbleRgba(actual.native, expected.rgba) : null;
			const nativeAssessment = nativeMetrics ? assessBubbleNative(nativeMetrics) : null;
			const nativePass = nativeAssessment?.ok ?? null;
			const canvasMetrics = compareBubbleRgba(actual.canvas, expected.rgba);
			const canvasVersusNative = actual.native ? compareBubbleRgba(actual.canvas, actual.native) : null;
			const pipeline = actual.path.startsWith("applyEffectPasses");
			if (pipeline) report.pipelineFrames++;
			if (pipeline && !recoveryBaseline && sample.width <= 256 && sample.height <= 256)
				recoveryBaseline = { sample, canvas, actual, expected };
			if (actual.native) {
				report.nativeFrames++;
				check(nativePass === true, `${sample.id}: native gate failed ${JSON.stringify(nativeMetrics)}`);
			}
			if (!pipeline) check(bubbleSameBytes(actual.canvas, canonical), `${sample.id}: bypass changed canonical bytes`);
			if (sample.expectedBypass === "disabled-fixture-stack") check(actual.path === "fixture-disabled-bypass", `${sample.id}: disabled bypass path changed`);
			if (sample.expectedBypass === "empty-resolved-pass") check(actual.path === "resolver-empty-pass", `${sample.id}: empty resolver path changed`);
			const entry = {
				id: sample.id, sourceId: sample.sourceId, sample, productionParams: params, renderPath: actual.path,
				resolved: actual.resolved, nativeCaptured: Boolean(actual.native), format: actual.format, byteOrder: actual.byteOrder ?? null,
				oracle: { sampledTicks: expected.sampledTicks, elapsedTicks: expected.elapsedTicks, centers: expected.centers, work: expected.work, bypass: expected.bypass },
				nativeMetrics, nativeAssessment, nativePass, canvasMetrics, canvasVersusNative,
			};
			results.push(entry);
			raw.frames.push({ ...entry, nativeRgba: actual.native ? bubbleEncode(actual.native) : null,
				canvasRgba: bubbleEncode(actual.canvas), expectedRgba: bubbleEncode(expected.rgba) });
			raw.pendingFrame = null;
			if (requiredBaselines.has(sample.id)) baselines.set(sample.id, actual);
			if (sample.baselineId) {
				const baseline = baselines.get(sample.baselineId);
				if (!baseline) throw Error(`Missing earlier OAT baseline ${sample.baselineId}`);
				check(!bubbleSameBytes(actual.canvas, baseline.canvas), `${sample.id}: optical edit ignored by Canvas output`);
				if (actual.native && baseline.native)
					check(!bubbleSameBytes(actual.native, baseline.native), `${sample.id}: optical edit ignored by native output`);
			}
			if (sample.equivalenceKey) {
				const prior = saved.get(sample.equivalenceKey);
				if (prior) {
					const sameCanvas = bubbleSameBytes(actual.canvas, prior.canvas);
					const sameNative = actual.native && prior.native ? bubbleSameBytes(actual.native, prior.native) : null;
					equivalences.push({ key: sample.equivalenceKey, referenceId: prior.id, id: sample.id, sameCanvas, sameNative });
					check(sameCanvas && sameNative !== false, `${sample.id}: reverse/repeat/equivalent request changed bytes`);
				} else saved.set(sample.equivalenceKey, { id: sample.id, canvas: actual.canvas, native: actual.native });
			}
			for (const negative of bubbleNegativesForCase(sample, canonical, expected.rgba)) {
				const { mutantRgba, referenceRgba, ...metadata } = negative;
				raw.negatives.push({ ...metadata, sourceId: sample.sourceId, mutantRgba: bubbleEncode(mutantRgba), referenceRgba: bubbleEncode(referenceRgba) });
				check(negative.rejected, `Insensitive Bubble negative: ${negative.id}`);
			}
			await new Promise((resolve) => setTimeout(resolve, 0));
		}
		raw.invariantNegatives = bubbleInvariantNegatives();
		for (const negative of raw.invariantNegatives) check(negative.rejected, `Insensitive Bubble invariant negative: ${negative.id}`);
		const negativeIds = [...raw.negatives, ...raw.invariantNegatives].map((item) => item.id);
		report.negativeControls = { planned: BUBBLE_NEGATIVE_CONTROLS, observedIds: negativeIds };
		check(new Set(negativeIds).size === negativeIds.length &&
			JSON.stringify([...negativeIds].sort()) === JSON.stringify(BUBBLE_NEGATIVE_CONTROLS.map((item) => item.id).sort()),
			"Missing/duplicate/unplanned Bubble negative controls");
		for (const input of bubbleAdmissionCases) {
			report.currentCase = `admission:${input.id}`;
			if (input.cpuOnly) {
				admissions.push({ id: input.id, stage: input.stage, input, attempted: false, skipped: true,
					reason: "CPU-only work-budget fixture; intentionally no large GPU allocation" });
				continue;
			}
			if (input.stage === "work") {
				const resolved = bridge.resolve(input.params, input.ticks, input.frameRate);
				if (resolved.error || !Array.isArray(resolved.passes) || !resolved.passes.length)
					throw Error(`Work admission did not reach GPU boundary: ${input.id}: ${resolved.error ?? "empty passes"}`);
				const rejection = await bubbleRejectAndRecover({
					expectedError: input.expectedError,
					attempt: () => wasm.applyEffectPasses({ source: sources.values().next().value.canvas,
						width: input.width, height: input.height,
						passes: resolved.passes.map((pass) => ({ shader: pass.shader, uniforms: Object.entries(pass.uniforms).map(([name, value]) => ({ name, value: Array.isArray(value) ? value : [value] })) })) }),
					recover: () => recoverAfter(input.id),
				});
				admissions.push({ id: input.id, stage: input.stage, input, attempted: true, ...rejection,
					scope: "Real applyEffectPasses semantic work rejection followed by real small valid render; not proof of zero GPU allocation" });
				check(rejection.semanticMatch, `Unexpected work rejection: ${input.id}: ${rejection.error}`);
				check(rejection.recovery?.passed === true && !rejection.recoveryError, `Recovery failed after ${input.id}: ${rejection.recoveryError}`);
				continue;
			}
			let error = "", rejected = false, unexpectedException = false;
			try {
				const resolved = bridge.resolve(input.params, input.ticks, input.frameRate);
				if (typeof resolved.error === "string" && resolved.error.length > 0) { rejected = true; error = resolved.error; }
			} catch (failure) {
				unexpectedException = true;
				error = (failure instanceof Error ? failure.message : String(failure)) || "Unexpected empty resolver exception";
			}
			admissions.push({ id: input.id, stage: input.stage, input, attempted: true, rejected, error, unexpectedException,
				wireInput: JSON.stringify({ effectType: "bubble", params: input.params, localTime: input.ticks, frameRate: input.frameRate }),
				scope: "Real resolveStylizedEffectJson structured error rejection; thrown exceptions do not count as validation" });
			check(!unexpectedException, `Unexpected Bubble resolver exception: ${input.id}: ${error}`);
			check(rejected, `Accepted invalid Bubble input: ${input.id}`);
		}
		for (const input of bubbleSupplementalAdmissionCases) {
			report.currentCase = `supplemental-admission:${input.id}`;
			const resolved = bridge.resolve(input.params, input.ticks, input.frameRate);
			const passed = !resolved.error && Array.isArray(resolved.passes) && resolved.passes.length === 0 && resolved.frameIndex === input.expectedFrameIndex;
			admissions.push({ id: input.id, stage: "supplemental-resolver-success", input, resolved, passed,
				scope: "Safe authored negative time, inactive after BigInt frame floor. No GPU call and no full frozen pixel-oracle parity claim." });
			check(passed, `Supplemental inactive-boundary admission mismatch: ${input.id}`);
		}
		const emptyRejection = await bubbleRejectAndRecover({
			expectedError: "At least one effect pass is required",
			attempt: () => wasm.applyEffectPasses({ source: sources.values().next().value.canvas, width: 1, height: 1, passes: [] }),
			recover: () => recoverAfter("real-empty-pass-stack"),
		});
		admissions.push({ id: "real-empty-pass-stack", stage: "applyEffectPasses", ...emptyRejection });
		check(emptyRejection.semanticMatch && emptyRejection.error === "At least one effect pass is required", "Unexpected empty-stack rejection");
		check(emptyRejection.recovery?.passed === true && !emptyRejection.recoveryError, `Recovery failed after empty-stack: ${emptyRejection.recoveryError}`);
		report.nativeAcceptance = diagnostic ? report.nativeFrames > 0 && results.filter((result) => result.nativeCaptured).every((result) => result.nativePass === true) : null;
		report.completed = true;
	} catch (error) {
		report.caught = true;
		report.failure = (error instanceof Error ? error.stack ?? error.message : String(error)) || "Unexpected empty probe exception";
	}
	finally {
		try { wasm.disposeGpu(); report.gpuDisposed = true; } catch (error) { errors.push(`disposeGpu: ${String(error)}`); }
		try { graphics?.free(); report.queryFreed = true; } catch (error) { errors.push(`graphics free: ${String(error)}`); }
	}
	report.ok = report.completed && !report.caught && !report.failure && !errors.length && results.length === bubbleCases.length &&
		admissions.length === bubbleAdmissionCases.length + bubbleSupplementalAdmissionCases.length + 1 &&
		report.gpuDisposed && report.queryFreed && (!diagnostic || report.nativeAcceptance === true);
	return report;
}
