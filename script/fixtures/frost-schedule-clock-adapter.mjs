/** Test-only isolated-realm serialization seam. No prototype, WASM-memory write,
 * return-pass replacement, global frame change or encoder timestamp change. */
export function installFrostScheduleClockAdapter(contract) {
	if (contract?.version !== "frost-schedule-opaque-clock-v1" ||
		!["advance", "freeze"].includes(contract.mode) || contract.frozenTicks !== 0)
		throw Error("Unknown Frost schedule test contract");
	const originalDescriptor = Object.getOwnPropertyDescriptor(JSON, "stringify");
	const stringify = originalDescriptor.value;
	const parse = JSON.parse;
	const expectedParams = { amount: 0.8, coverage: 0.9, scale: 7, blur: 0.025,
		refraction: 0.035, tintR: 0.7, tintG: 0.82, tintB: 1, tintStrength: 0.35,
		seed: 17, holdTicks: 8000, recoveryTicks: 16000, strokeCount: 1,
		stroke0TimeTicks: 12001, stroke0FromX: 0.2, stroke0FromY: 0.5,
		stroke0ToX: 0.8, stroke0ToY: 0.5, stroke0Radius: 0.2, stroke0Strength: 1 };
	const sameKeys = (value, keys) => value && typeof value === "object" && !Array.isArray(value) &&
		Reflect.ownKeys(value).length === keys.length && keys.every(key =>
			Object.hasOwn(value, key) && "value" in Object.getOwnPropertyDescriptor(value, key));
	const paramKeys = Object.keys(contract.params);
	if (!sameKeys(contract.params, Object.keys(expectedParams)) ||
		!Object.keys(expectedParams).every(key => Object.is(contract.params[key], expectedParams[key])))
		throw Error("Frost schedule adapter requires exact fixed fixture parameters");
	const snapshot = value => parse(Reflect.apply(stringify, JSON, [value]));
	const matches = value => sameKeys(value, ["effectType", "params", "localTime", "frameRate"]) &&
		value.effectType === "frost" && sameKeys(value.params, paramKeys) &&
		paramKeys.every(key => Object.is(value.params[key], contract.params[key])) &&
		sameKeys(value.frameRate, ["numerator", "denominator"]) &&
		value.frameRate.numerator === 30 && value.frameRate.denominator === 1 &&
		Number.isSafeInteger(value.localTime) && value.localTime >= 0 && value.localTime <= 48000;
	const state = { version: contract.version, mode: contract.mode, serializations: [],
		wasmCalls: [], encoderConfigurations: [], encodeOptions: [], errors: [], restored: false };
	function adapted(...args) {
		const input = args[0];
		if (args[1] !== undefined || !matches(input)) return Reflect.apply(stringify, this, args);
		if (state.serializations.length >= 10000) throw Error("Frost test observation budget exceeded");
		const before = snapshot(input), originalTime = input.localTime;
		const descriptor = Object.getOwnPropertyDescriptor(input, "localTime");
		if (!descriptor.writable) throw Error("Frost test DTO localTime must be writable");
		const record = { before, originalTicks: originalTime, serializedTicks: originalTime,
			mutatedOnlyLocalTime: false, dtoRestored: false };
		state.serializations.push(record);
		if (contract.mode === "advance") {
			record.after = snapshot(input);
			record.restoredSnapshot = snapshot(input);
			record.mutatedOnlyLocalTime = true;
			record.dtoRestored = true;
			return Reflect.apply(stringify, this, args);
		}
		try {
			input.localTime = contract.frozenTicks;
			record.serializedTicks = input.localTime;
			record.after = snapshot(input);
			record.mutatedOnlyLocalTime = Reflect.apply(stringify, JSON, [{ ...before, localTime: input.localTime }]) ===
				Reflect.apply(stringify, JSON, [record.after]);
			return Reflect.apply(stringify, this, args);
		} finally {
			input.localTime = originalTime;
			record.restoredSnapshot = snapshot(input);
			record.dtoRestored = input.localTime === originalTime;
		}
	}
	Object.defineProperty(JSON, "stringify", { ...originalDescriptor, value: adapted });
	const wasmDescriptors = new Map(), encoderDescriptors = new Map();
	const facades = new WeakMap();
	function facade(instance) {
		if (!instance?.exports || typeof instance.exports.resolveStylizedEffectJson !== "function") return instance;
		if (facades.has(instance)) return facades.get(instance);
		const raw = instance.exports, exports = Object.create(null);
		for (const key of Reflect.ownKeys(raw)) {
			const descriptor = Object.getOwnPropertyDescriptor(raw, key);
			let value = descriptor.value;
			if (key === "resolveStylizedEffectJson") {
				const original = value;
				value = function (...args) {
					let request;
					try { request = parse(new TextDecoder().decode(new Uint8Array(raw.memory.buffer, args[0], args[1]))); }
					catch (error) { state.errors.push(String(error)); }
					const result = Reflect.apply(original, raw, args);
					if (matches(request)) {
						try {
							const response = parse(new TextDecoder().decode(new Uint8Array(raw.memory.buffer, result[0], result[1])));
							state.wasmCalls.push({ request, response,
								boundary: "Read-only actual exports.resolveStylizedEffectJson input/returned String before JS caller free" });
						} catch (error) { state.errors.push(String(error)); }
					}
					return result;
				};
			}
			Object.defineProperty(exports, key, { ...descriptor, value });
		}
		const proxy = new Proxy(instance, { get(target, key) {
			return key === "exports" ? exports : Reflect.get(target, key, target);
		} });
		facades.set(instance, proxy);
		return proxy;
	}
	for (const name of ["instantiate", "instantiateStreaming"]) {
		const descriptor = Object.getOwnPropertyDescriptor(WebAssembly, name);
		if (!descriptor) continue;
		wasmDescriptors.set(name, descriptor);
		Object.defineProperty(WebAssembly, name, { ...descriptor, value: async function (...args) {
			const result = await Reflect.apply(descriptor.value, this, args);
			return result.instance ? { ...result, instance: facade(result.instance) } : facade(result);
		} });
	}
	// Observe individual native encoder instances, never modify their prototype.
	const encoderDescriptor = Object.getOwnPropertyDescriptor(globalThis, "VideoEncoder");
	if (encoderDescriptor?.value) {
		const OriginalEncoder = encoderDescriptor.value;
		const Encoder = new Proxy(OriginalEncoder, { construct(target, args) {
			const encoder = Reflect.construct(target, args, target);
			for (const name of ["configure", "encode"]) {
				const original = encoder[name];
				Object.defineProperty(encoder, name, { configurable: true, value: function (...callArgs) {
					const result = Reflect.apply(original, encoder, callArgs);
					if (name === "configure") state.encoderConfigurations.push({ ...callArgs[0] });
					else state.encodeOptions.push({ timestamp: callArgs[0].timestamp, duration: callArgs[0].duration,
						options: { ...callArgs[1] } });
					return result;
				} });
			}
			return encoder;
		} });
		encoderDescriptors.set("VideoEncoder", encoderDescriptor);
		Object.defineProperty(globalThis, "VideoEncoder", { ...encoderDescriptor, value: Encoder });
	}
	function restore() {
		if (JSON.stringify !== adapted) throw Error("Frost test serialization seam replaced by another owner");
		Object.defineProperty(JSON, "stringify", originalDescriptor);
		for (const [name, descriptor] of wasmDescriptors) Object.defineProperty(WebAssembly, name, descriptor);
		for (const [name, descriptor] of encoderDescriptors) Object.defineProperty(globalThis, name, descriptor);
		state.restored = true;
	}
	Object.defineProperty(globalThis, "__frostScheduleClockAudit", { configurable: true, value: state });
	Object.defineProperty(globalThis, "__restoreFrostScheduleClockAdapter", { configurable: true, value: restore });
	return { state, restore };
}
