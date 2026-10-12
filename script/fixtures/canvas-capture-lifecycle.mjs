import * as wasm from "/wasm-glue.mjs";
import { observeCaptureWait } from "/canvas-capture-wait-observer.mjs";
import {
	report,
	handles,
	check,
	near,
	width,
	height,
	source,
	read,
	neutral,
	grayPass,
	passes,
	layer,
	frame,
	complete,
} from "/canvas-capture-support.mjs";

report.scope =
	"Actual current WASM Canvas capture and MapWait under a declared test-only WebGL fence delay. Six request/resource invalidations, stale-commit refusal and recovery. Not natural WebGPU wait, material oracle, Host or encoded output.";
report.lifecycle = [];

function upload(handle, canvas) {
	wasm.uploadTextureForHandle(handle, {
		id: "source",
		source: canvas,
		width,
		height,
	});
}
function errorRecord(error) {
	return {
		name: error?.name,
		code: error?.code,
		message: error?.message ?? String(error),
	};
}
async function run() {
	let graphics, observer;
	try {
		const bytes = await (await fetch("/wasm.wasm")).arrayBuffer();
		const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
		report.loadedWasm = {
			bytes: bytes.byteLength,
			sha256: [...digest].map((b) => b.toString(16).padStart(2, "0")).join(""),
		};
		const module = await WebAssembly.compile(bytes);
		const imports = Object.fromEntries(
			WebAssembly.Module.imports(module).map(({ module }) => [module, wasm]),
		);
		const instance = await WebAssembly.instantiate(module, imports);
		wasm.__wbg_set_wasm(instance.exports);
		instance.exports.__wbindgen_start();
		await wasm.initializeGpu();
		graphics = new wasm.WasmRuntimeGraphicsQuery();
		report.backend = graphics.selectedBackend();
		check("real-webgl-backend", report.backend === "webgl", report.backend);
		if (report.backend !== "webgl")
			throw Error("Fence-delay fixture requires WebGL");
		let handle = wasm.createCompositor(width, height);
		handles.add(handle);
		const raw = source(false),
			gray = source(true),
			rawBytes = read(raw),
			grayBytes = read(gray);
		for (const kind of [
			"cancel",
			"withdraw",
			"replace-source",
			"resize",
			"dispose-owner",
			"replace-request",
		]) {
			report.currentCase = kind;
			upload(handle, raw);
			const baselineRequest = wasm.beginRenderFrameForHandle(
				handle,
				frame([layer("source", [passes(neutral)])]),
			);
			const baseline = await complete(handle, baselineRequest);
			near(kind + "-baseline", baseline.bytes, rawBytes, 2);
			check(
				kind + "-stale-publication-negative-sensitive",
				baseline.bytes.some(
					(byte, index) => Math.abs(byte - grayBytes[index]) > 16,
				),
				{ requiredDelta: 16 },
			);
			const oldHandle = handle;
			const oldRequest = wasm.beginRenderFrameForHandle(
				handle,
				frame([layer("source", [[grayPass, ...passes(neutral)]])]),
			);
			let replacement;
			observer = observeCaptureWait({
				mutate() {
					if (kind === "cancel")
						wasm.cancelRenderFrameForHandle(oldHandle, oldRequest);
					if (kind === "withdraw")
						wasm.releaseTextureForHandle(oldHandle, "source");
					if (kind === "replace-source") upload(oldHandle, gray);
					if (kind === "resize")
						wasm.resizeCompositorForHandle(oldHandle, width + 1, height + 1);
					if (kind === "dispose-owner") {
						wasm.disposeCompositor(oldHandle);
						handles.delete(oldHandle);
						handle = wasm.createCompositor(width, height);
						handles.add(handle);
					}
					if (kind === "replace-request")
						replacement = wasm.beginRenderFrameForHandle(
							oldHandle,
							frame([layer("source", [passes(neutral)])]),
						);
				},
			});
			let outcome;
			try {
				const result = await wasm.advanceRenderFrameForHandle(
					oldHandle,
					oldRequest,
					64,
				);
				outcome = { resolved: result };
			} catch (error) {
				outcome = errorRecord(error);
			}
			observer.release();
			const observed = observer.observation;
			check(
				kind + "-actual-staging-and-pending-mapwait",
				observed.pendingObserved &&
					observed.copiedToStaging &&
					observed.fencePolls.length > 0 &&
					observed.matchedContextAndFence &&
					observed.wasmTimerCall &&
					observed.mutationMappedDataReads === 0 &&
					observed.pendingTimerFiredBeforeMutation === false,
				observed,
			);
			check(
				kind + "-mutation-executed",
				observed.mutationExecuted && !observed.mutationError,
				observed.mutationError,
			);
			if (
				!observed.pendingObserved ||
				!observed.mutationExecuted ||
				observed.mutationError
			)
				throw Error("No valid pending MapWait boundary observed for " + kind);
			check(
				kind + "-typed-cancellation",
				outcome.name === "AbortError" && outcome.code === "RENDER_CANCELLED",
				outcome,
			);
			check(
				kind + "-timer-terminal-after-cancellation",
				observed.pendingTimer !== null &&
					observed.clearedTimers.includes(observed.pendingTimer) &&
					(observed.pendingTimerLifecycle?.cleared ||
						observed.pendingTimerLifecycle?.fired),
				observed,
			);
			let staleCommit;
			try {
				wasm.commitRenderFrameForHandle(oldHandle, oldRequest);
			} catch (error) {
				staleCommit = errorRecord(error);
			}
			check(
				kind + "-stale-commit-refused",
				staleCommit?.name === "AbortError" &&
					staleCommit?.code === "RENDER_CANCELLED",
				staleCommit,
			);
			observer.restore();
			observer = null;
			if (
				["cancel", "withdraw", "replace-source", "replace-request"].includes(
					kind,
				)
			)
				near(
					kind + "-no-old-publication",
					read(wasm.getCompositorCanvasForHandle(handle)),
					baseline.bytes,
					0,
				);
			if (kind === "resize")
				wasm.resizeCompositorForHandle(handle, width, height);
			const expected = kind === "replace-source" ? grayBytes : rawBytes;
			if (kind === "withdraw" || kind === "dispose-owner") upload(handle, raw);
			const recoveryRequest =
				replacement ??
				wasm.beginRenderFrameForHandle(
					handle,
					frame([layer("source", [passes(neutral)])]),
				);
			const recovered = await complete(handle, recoveryRequest);
			near(kind + "-recovery-and-guard-release", recovered.bytes, expected, 2);
			report.lifecycle.push({
				kind,
				oldHandle,
				handle,
				oldRequest,
				recoveryRequest,
				outcome,
				observation: observed,
			});
		}
	} catch (error) {
		report.failure = error.stack ?? String(error);
	} finally {
		const cleanupErrors = [];
		for (const cleanup of [
			() => observer?.restore(),
			...[...handles].map((handle) => () => wasm.disposeCompositor(handle)),
			() => graphics?.free(),
			() => wasm.disposeGpu(),
		]) {
			try {
				cleanup();
			} catch (error) {
				cleanupErrors.push(String(error));
			}
		}
		report.disposed = cleanupErrors.length === 0;
		if (cleanupErrors.length) report.cleanupFailure = cleanupErrors;
		report.ok =
			!report.failure &&
			!report.cleanupFailure &&
			report.lifecycle.length === 6 &&
			report.checks.every((entry) => entry.passed);
		Reflect.set(globalThis, "__canvasCaptureResult", report);
	}
}
run();
