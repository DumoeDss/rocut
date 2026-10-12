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
	const errorRecord = async (operation, error) => {
		await emit({
			kind: "error",
			operation,
			message: String(error).replace(/https?:\/\/[^\s"'<>]+/g, "[private URL]"),
		});
	};
	const identifyObserved = async (bytes, operation) => {
		try {
			return await identify(bytes);
		} catch (error) {
			await errorRecord(operation, error);
		}
	};
	const wasmAsset = (response) => {
		try {
			const path = new URL(response.url).pathname;
			if (/\.wasm$/.test(path)) return path.split("/").at(-1);
		} catch {
			/* An unlocated native Response is not a .wasm URL witness. */
		}
	};
	const observeResponse = async (response, source) => {
		try {
			const identity = await identify(
				new Uint8Array(await response.clone().arrayBuffer()),
			);
			await emit({
				kind: "served",
				operation: "Response.clone.arrayBuffer",
				source,
				transport: "actual-response-clone",
				asset: wasmAsset(response),
				status: response.status,
				...identity,
			});
			return identity;
		} catch (error) {
			// Fail the independent receipt, but leave native fetch/init behavior
			// untouched. Native rejections below are never turned into success.
			await errorRecord("Response.clone.arrayBuffer", error);
		}
	};
	const fetch = globalThis.fetch;
	globalThis.fetch = async function (...args) {
		let wasmRequest = false;
		try {
			const input = args[0]?.url ?? args[0];
			wasmRequest = /\.wasm$/.test(
				new URL(input, globalThis.location?.href).pathname,
			);
		} catch {
			/* Other fetch input validation remains native. */
		}
		let response;
		try {
			response = await Reflect.apply(fetch, this, args);
		} catch (error) {
			if (wasmRequest) await errorRecord("fetch.wasm", error);
			throw error;
		}
		if (wasmRequest && wasmAsset(response))
			await observeResponse(response, "fetch-response-clone");
		return response;
	};
	const compile = WebAssembly.compile;
	WebAssembly.compile = async function (...args) {
		const bytes = copy(args[0]);
		const module = await Reflect.apply(compile, this, args);
		if (bytes) {
			const identity = await identifyObserved(
				bytes,
				"compile.BufferSource.sha256",
			);
			if (identity) modules.set(module, identity);
		}
		return module;
	};
	const instantiate = WebAssembly.instantiate;
	WebAssembly.instantiate = async function (...args) {
		const bytes = copy(args[0]);
		const result = await Reflect.apply(instantiate, this, args);
		const identity = bytes
			? await identifyObserved(bytes, "instantiate.BufferSource.sha256")
			: modules.get(args[0]);
		if (bytes && result.module) modules.set(result.module, identity);
		await emit({
			kind: "loaded",
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
			// Persist served bytes before attempting compilation/instantiation: a
			// failed native initializer must not erase the independent response pin.
			const identity = wasmAsset(response)
				? await observeResponse(response, `${name}-response-clone`)
				: undefined;
			const result = await Reflect.apply(original, this, [
				response,
				...args.slice(1),
			]);
			if (identity)
				modules.set(
					name === "compileStreaming" ? result : result.module,
					identity,
				);
			if (name === "instantiateStreaming")
				await emit({
					kind: "loaded",
					operation: name,
					success: true,
					...(identity ?? { unknownModuleBytes: true }),
				});
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
	const linked = loaded.filter(
		(entry) =>
			entry.sha256 === expectedSha256 &&
			entry.success === true &&
			entry.bytes > 8 &&
			served.some(
				(response) =>
					response.status === 200 &&
					response.sha256 === entry.sha256 &&
					response.bytes === entry.bytes,
			),
	);
	assert(
		linked.length > 0,
		"Expected authority WASM was not successfully instantiated from observed bytes",
	);
	return {
		expectedSha256,
		servedAuthority: true,
		loadedAuthority: true,
		linkedLoadedCount: linked.length,
		linkage:
			"Exact SHA256 and byteLength between actual response clone and successful instantiate bytes",
	};
}
