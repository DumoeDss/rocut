// Test-only WebGL fence delay: the actual WASM MapWait, buffer and timers remain live.
// No production glue, shader, pixels, request result or callback is substituted.
export function observeCaptureWait({ mutate }) {
	const prototype = WebGL2RenderingContext.prototype;
	const originals = {
		getSyncParameter: prototype.getSyncParameter,
		getBufferSubData: prototype.getBufferSubData,
		readPixels: prototype.readPixels,
		fenceSync: prototype.fenceSync,
		setTimeout: globalThis.setTimeout,
		clearTimeout: globalThis.clearTimeout,
	};
	const observation = {
		injectedFenceDelay: true,
		fencePolls: [],
		copiedToStaging: false,
		mappedDataReads: 0,
		pendingTimer: null,
		pendingObserved: false,
		mutationExecuted: false,
		mutationError: null,
		mutationMappedDataReads: null,
		pendingTimerFiredBeforeMutation: null,
		pendingTimerClearedWhileUnfired: false,
		pendingTimerLifecycle: null,
		matchedContextAndFence: false,
		wasmTimerCall: false,
		clearedTimers: [],
	};
	let holding = true;
	let captureContext, stagingBuffer, captureFence;
	const timers = new Map();
	prototype.readPixels = function (...args) {
		const result = originals.readPixels.apply(this, args);
		if (
			typeof args[6] === "number" &&
			this.getParameter(this.PIXEL_PACK_BUFFER_BINDING)
		) {
			captureContext = this;
			stagingBuffer = this.getParameter(this.PIXEL_PACK_BUFFER_BINDING);
			observation.copiedToStaging = true;
		}
		return result;
	};
	prototype.fenceSync = function (...args) {
		const sync = originals.fenceSync.apply(this, args);
		if (holding && this === captureContext && stagingBuffer)
			captureFence = sync;
		return sync;
	};
	prototype.getBufferSubData = function (...args) {
		if (this === captureContext) observation.mappedDataReads++;
		return originals.getBufferSubData.apply(this, args);
	};
	prototype.getSyncParameter = function (sync, parameter) {
		const result = originals.getSyncParameter.call(this, sync, parameter);
		if (
			!holding ||
			this !== captureContext ||
			sync !== captureFence ||
			parameter !== this.SYNC_STATUS
		)
			return result;
		if (!this.isSync(sync))
			throw Error("Fence-delay fixture did not observe a real GL sync");
		observation.fencePolls.push({
			actual: result,
			returned: this.UNSIGNALED,
		});
		observation.matchedContextAndFence = true;
		return this.UNSIGNALED;
	};
	globalThis.setTimeout = function (callback, delay, ...args) {
		const timer = { fired: false, cleared: false };
		const wrapped =
			typeof callback === "function"
				? function (...values) {
						timer.fired = true;
						return callback.apply(this, values);
					}
				: callback;
		const id = originals.setTimeout.call(this, wrapped, delay, ...args);
		timers.set(id, timer);
		const wasmCall = /wasm-function|\.wasm/.test(new Error().stack ?? "");
		if (
			holding &&
			delay === 4 &&
			!observation.pendingObserved &&
			observation.copiedToStaging &&
			observation.matchedContextAndFence &&
			observation.fencePolls.length > 0 &&
			observation.mappedDataReads === 0 &&
			wasmCall
		) {
			observation.pendingTimer = id;
			observation.pendingTimerLifecycle = timer;
			observation.pendingObserved = true;
			observation.wasmTimerCall = wasmCall;
			// This runs after the real Rust future returned Pending, outside GL/runtime borrows.
			queueMicrotask(() => {
				try {
					observation.mutationMappedDataReads = observation.mappedDataReads;
					observation.pendingTimerFiredBeforeMutation = timer.fired;
					if (timer.fired || timer.cleared || observation.mappedDataReads !== 0)
						throw Error(
							"Fixture lost the pending mapped-buffer boundary before mutation",
						);
					mutate();
					observation.mutationExecuted = true;
				} catch (error) {
					observation.mutationError = String(error);
				}
			});
		}
		return id;
	};
	globalThis.clearTimeout = function (id) {
		const timer = timers.get(id);
		if (timer) {
			if (id === observation.pendingTimer && !timer.fired)
				observation.pendingTimerClearedWhileUnfired = true;
			timer.cleared = true;
		}
		observation.clearedTimers.push(id);
		return originals.clearTimeout.call(this, id);
	};
	return {
		observation,
		release() {
			holding = false;
		},
		restore() {
			holding = false;
			Object.assign(prototype, {
				getSyncParameter: originals.getSyncParameter,
				getBufferSubData: originals.getBufferSubData,
				readPixels: originals.readPixels,
				fenceSync: originals.fenceSync,
			});
			globalThis.setTimeout = originals.setTimeout;
			globalThis.clearTimeout = originals.clearTimeout;
		},
	};
}
