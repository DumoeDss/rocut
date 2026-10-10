export function bubbleEncode(pixels) {
	let binary = "";
	for (let offset = 0; offset < pixels.length; offset += 8192)
		binary += String.fromCharCode(...pixels.subarray(offset, offset + 8192));
	return btoa(binary);
}

export function bubbleReadCanvas(canvas) {
	// The production result may already own a GPU context. Read a 2D copy,
	// never mislabel this presentation-stage readback as native texture bytes.
	const copy = new OffscreenCanvas(canvas.width, canvas.height);
	const context = copy.getContext("2d", { willReadFrequently: true });
	if (!context) throw Error("Missing 2D readback context");
	context.drawImage(canvas, 0, 0);
	return new Uint8Array(context.getImageData(0, 0, canvas.width, canvas.height).data);
}

export function bubbleSourceKey(sample) {
	const sorted = (value) => {
		if (Array.isArray(value)) return value.map(sorted);
		if (value && typeof value === "object")
			return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sorted(value[key])]));
		return value;
	};
	return `${sample.width}x${sample.height}:${JSON.stringify(sorted(sample.sourceSpec))}`;
}

export function bubbleSameBytes(left, right) {
	return left.length === right.length && left.every((value, index) => value === right[index]);
}

export async function bubbleRejectAndRecover({ attempt, expectedError, recover }) {
	const message = (error) => error instanceof Error ? error.message : String(error);
	let rejected = false, error = "", recovery = null, recoveryError = "";
	try { await attempt(); }
	catch (failure) { rejected = true; error = message(failure); }
	const semanticMatch = rejected && (error === expectedError || error.startsWith(`${expectedError}: `));
	// Recovery is attempted even for unexpected exceptions, so a poisoned runtime
	// remains visible instead of being mislabeled as a successful admission test.
	try { recovery = await recover(); }
	catch (failure) { recoveryError = message(failure); }
	return { rejected, error, expectedError, semanticMatch, recovery, recoveryError };
}

export function createBubbleBridge(wasm, readCanvas = bubbleReadCanvas) {
	function resolve(params, ticks, rate) {
		return JSON.parse(wasm.resolveStylizedEffectJson(JSON.stringify({
			effectType: "bubble", params, localTime: ticks, frameRate: rate,
		})));
	}
	async function render({ source, params, ticks, rate, enabled, diagnostic, backend }) {
		// This switch models the fixture's owning stack only. It is not evidence
		// that editor/timeline disabled-entry validation was exercised.
		if (!enabled) return {
			path: "fixture-disabled-bypass", resolved: null,
			native: null, canvas: readCanvas(source), format: null,
		};
		const resolved = resolve(params, ticks, rate);
		if (resolved.error || !Array.isArray(resolved.passes))
			throw Error(resolved.error ?? "Bubble resolver returned no passes array");
		if (!resolved.passes.length) return {
			path: "resolver-empty-pass", resolved,
			native: null, canvas: readCanvas(source), format: null,
		};
		const options = {
			source, width: source.width, height: source.height,
			passes: resolved.passes.map((pass) => ({
				shader: pass.shader,
				uniforms: Object.entries(pass.uniforms).map(([name, value]) => ({
					name, value: Array.isArray(value) ? value : [value],
				})),
			})),
		};
		if (!diagnostic) return {
			path: "applyEffectPasses", resolved, native: null, format: null,
			canvas: readCanvas(wasm.applyEffectPasses(options)),
		};
		const readback = Reflect.get(wasm, "applyEffectPassesReadback");
		if (typeof readback !== "function") throw Error("Missing diagnostic applyEffectPassesReadback export");
		const output = await readback(options);
		if (!(output.rgba instanceof Uint8Array) ||
			output.width !== source.width || output.height !== source.height ||
			output.rgba.length !== source.width * source.height * 4 ||
			output.canvas?.width !== source.width || output.canvas?.height !== source.height ||
			!["rgba8unorm", "bgra8unorm"].includes(output.format) || output.backend !== backend)
			throw Error("Diagnostic Bubble readback shape/format/backend mismatch");
		return {
			path: "applyEffectPassesReadback", resolved, format: output.format,
			// The Rust readback normalizes BGRA storage to returned RGBA bytes.
			byteOrder: "RGBA", backend: output.backend,
			native: new Uint8Array(output.rgba), canvas: readCanvas(output.canvas),
		};
	}
	return { resolve, render };
}
