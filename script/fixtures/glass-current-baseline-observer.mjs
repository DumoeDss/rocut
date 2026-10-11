import assert from "node:assert/strict";

/** Runs before application scripts in each observed page/frame. It records only
 * successful real WASM instantiation, never a package path or guessed URL. */
export function installGlassWasmObserver() {
	const modules = new WeakMap();
	const copy = (value) => {
		if (value instanceof ArrayBuffer) return new Uint8Array(value).slice();
		if (ArrayBuffer.isView(value))
			return new Uint8Array(
				value.buffer,
				value.byteOffset,
				value.byteLength,
			).slice();
	};
	const identify = async (bytes) => ({
		bytes: bytes.byteLength,
		sha256: Array.from(
			new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
			(byte) => byte.toString(16).padStart(2, "0"),
		).join(""),
	});
	const emit = (entry) => globalThis.__rocutGlassWasmPin(entry);
	const compile = WebAssembly.compile;
	WebAssembly.compile = async function (...args) {
		const bytes = copy(args[0]);
		const module = await Reflect.apply(compile, this, args);
		if (bytes) modules.set(module, await identify(bytes));
		return module;
	};
	const instantiate = WebAssembly.instantiate;
	WebAssembly.instantiate = async function (...args) {
		const bytes = copy(args[0]);
		const result = await Reflect.apply(instantiate, this, args);
		const identity = bytes ? await identify(bytes) : modules.get(args[0]);
		if (bytes && result.module) modules.set(result.module, identity);
		await emit({
			operation: "instantiate",
			success: true,
			...(identity ?? { unknownModuleBytes: true }),
		});
		return result;
	};
	for (const name of ["compileStreaming", "instantiateStreaming"]) {
		const original = WebAssembly[name];
		if (!original) continue;
		WebAssembly[name] = async function (...args) {
			const response = await args[0];
			const bytesPromise = response.clone().arrayBuffer();
			const result = await Reflect.apply(original, this, [
				response,
				...args.slice(1),
			]);
			const identity = await identify(new Uint8Array(await bytesPromise));
			modules.set(
				name === "compileStreaming" ? result : result.module,
				identity,
			);
			if (name === "instantiateStreaming")
				await emit({ operation: name, success: true, ...identity });
			return result;
		};
	}
}

/** Other libraries may instantiate their own WASM. The authority must occur in
 * both served response bodies and successful loaded bytes; emptiness never passes. */
export function assertGlassBrowserIdentity(
	{ served, loaded, errors },
	expectedSha256,
) {
	assert.deepEqual(errors, [], "Browser identity observer failed");
	assert(
		served.some(
			(entry) =>
				entry.sha256 === expectedSha256 &&
				entry.status === 200 &&
				entry.bytes > 8,
		),
		"Expected authority WASM was not observed in a served response body",
	);
	assert(
		loaded.some(
			(entry) =>
				entry.sha256 === expectedSha256 &&
				entry.success === true &&
				entry.bytes > 8,
		),
		"Expected authority WASM was not successfully instantiated from observed bytes",
	);
	return { expectedSha256, servedAuthority: true, loadedAuthority: true };
}
