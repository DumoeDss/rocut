export function canvasImportError(error) {
	return { text: error instanceof Error ? error.message : String(error),
		name: error instanceof Error ? error.name : typeof error };
}
export function matchesCanvasImportRejection(input, error, state) {
	if (input.originalJsError) return error === state?.originalError && error?.name === "IndexSizeError" && state.calls === 1;
	const text = canvasImportError(error).text;
	if (input.caller === "effects" && (input.id.startsWith("zero-") || input.id.startsWith("device-"))) {
		const escapedDimensions = `${input.width}x${input.height}`;
		return new RegExp(`^Invalid output dimensions: ${escapedDimensions}; each dimension must be in 1\\.\\.=[0-9]+ \\(device max_texture_dimension_2d\\)$`).test(text);
	}
	return text === input.error;
}
export function cropCanvasImportRgba(pixels, sourceWidth, width, height) {
	if (!Number.isSafeInteger(sourceWidth) || !Number.isSafeInteger(width) || !Number.isSafeInteger(height) ||
		width <= 0 || height <= 0 || width > sourceWidth || pixels.length % (sourceWidth * 4) !== 0 || height > pixels.length / (sourceWidth * 4))
		throw RangeError("Invalid canonical source crop");
	const output = new Uint8Array(width * height * 4);
	for (let y = 0; y < height; y++) output.set(pixels.subarray(y * sourceWidth * 4, (y * sourceWidth + width) * 4), y * width * 4);
	return output;
}

// Invoke the original native browser method with an empty rectangle: the browser
// itself creates the IndexSizeError. Only the targeted source context is changed.
export function injectCanvasImportReadError(prototype, targetContext) {
	const descriptor = Object.getOwnPropertyDescriptor(prototype, "getImageData");
	if (!descriptor || typeof descriptor.value !== "function" || !descriptor.configurable)
		throw Error("getImageData prototype is not patchable");
	const state = { calls: 0, originalError: null, restored: false };
	const native = descriptor.value;
	Object.defineProperty(prototype, "getImageData", { ...descriptor, value: function (...args) {
		if (this !== targetContext) return Reflect.apply(native, this, args);
		state.calls++;
		try { return Reflect.apply(native, this, [0, 0, 0, 0]); }
		catch (error) { state.originalError = error; throw error; }
	} });
	return { state, restore() {
		Object.defineProperty(prototype, "getImageData", descriptor);
		const current = Object.getOwnPropertyDescriptor(prototype, "getImageData");
		state.restored = Reflect.ownKeys(descriptor).every((key) => current[key] === descriptor[key]);
		if (!state.restored) throw Error("getImageData original descriptor restoration failed");
	} };
}

export async function canvasImportRejectAndRecover({ attempt, prepare = () => null, match, recover, restart }) {
	let injection, thrown, rejected = false;
	const result = { ok: false, rejected: false, error: null, matched: false,
		prototypeRestored: true, recovery: null, restart: null };
	try {
		injection = prepare();
		try { await attempt(); } catch (error) { thrown = error; rejected = true; }
	} finally {
		if (injection) {
			injection.restore(); result.prototypeRestored = injection.state.restored;
			result.injectionCalls = injection.state.calls;
			result.originalJsErrorIdentity = rejected && thrown === injection.state.originalError;
			result.nativeErrorName = injection.state.originalError?.name ?? null;
		}
	}
	result.rejected = rejected; result.error = rejected ? canvasImportError(thrown) : null;
	result.matched = rejected && match(thrown, injection?.state);
	// Both stages are attempted even after a bad rejection so runtime poisoning is visible.
	try { result.recovery = await recover(); } catch (error) { result.recoveryError = canvasImportError(error); }
	try { result.restart = await restart(); } catch (error) { result.restartError = canvasImportError(error); }
	result.ok = result.rejected && result.matched && result.prototypeRestored && result.recovery?.ok === true && result.restart?.ok === true;
	return result;
}
