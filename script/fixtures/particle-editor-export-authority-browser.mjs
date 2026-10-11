// This function has no module-local dependencies: page.addInitScript may pass
// its function value directly. It observes only; original values/promises/errors
// are returned unchanged. Module-only invocation without captured compile bytes
// is missing proof, never inferred from a served file or build receipt.
export function installParticleAuthorityBrowserObserver({
	expectedWasmSha256,
	realm = globalThis,
}) {
	if (!/^[a-f0-9]{64}$/.test(expectedWasmSha256))
		throw Error("Approved WASM digest required");
	if (Object.hasOwn(realm, "__particleAuthorityWasmObservation"))
		throw Error("Authority observer already installed");
	const wasm = realm.WebAssembly;
	if (!wasm || !realm.crypto?.subtle)
		throw Error("Actual WASM byte observation unavailable");
	const pending = new Set(),
		events = [],
		errors = [],
		modules = new WeakMap(),
		originals = new Map();
	const track = (promise) => {
		pending.add(promise);
		promise
			.catch((error) => {
				errors.push(String(error?.message ?? error));
			})
			.finally(() => pending.delete(promise));
	};
	const hash = async (bytes) => ({
		sha256: Array.from(
			new Uint8Array(await realm.crypto.subtle.digest("SHA-256", bytes)),
			(byte) => byte.toString(16).padStart(2, "0"),
		).join(""),
		byteLength: bytes.byteLength,
	});
	function capture(input, streaming) {
		if (streaming)
			return Promise.resolve(input)
				.then((response) => {
					if (!response || typeof response.clone !== "function")
						throw Error("Streaming input is not a cloneable Response");
					return response.clone().arrayBuffer();
				})
				.then(hash);
		if (input instanceof wasm.Module) {
			const captured = modules.get(input);
			return (
				captured ??
				Promise.reject(
					Error("Unobserved WebAssembly.Module has no actual-byte proof"),
				)
			);
		}
		if (input instanceof realm.ArrayBuffer)
			return hash(new Uint8Array(input).slice());
		if (realm.ArrayBuffer.isView(input))
			return hash(
				new Uint8Array(
					input.buffer,
					input.byteOffset,
					input.byteLength,
				).slice(),
			);
		return Promise.reject(
			Error("Unsupported WASM input has no actual-byte proof"),
		);
	}
	for (const operation of ["Module", "Instance"]) {
		const original = wasm[operation],
			descriptor = Object.getOwnPropertyDescriptor(wasm, operation);
		if (typeof original !== "function") continue;
		const wrapper = new Proxy(original, {
			construct(target, args, newTarget) {
				const entry = {
					operation,
					status: "pending",
					inputKind: operation === "Module" ? "buffer" : "module",
					instantiated: false,
				};
				events.push(entry);
				const proof = capture(args[0], false);
				track(proof.then((identity) => Object.assign(entry, identity)));
				let value;
				try {
					value = Reflect.construct(target, args, newTarget);
				} catch (error) {
					entry.status = "rejected";
					throw error;
				}
				entry.status = "fulfilled";
				if (operation === "Module") modules.set(value, proof);
				else entry.instantiated = true;
				return value;
			},
		});
		Object.defineProperty(wasm, operation, { ...descriptor, value: wrapper });
		originals.set(operation, { descriptor, wrapper });
	}
	for (const operation of [
		"compile",
		"compileStreaming",
		"instantiate",
		"instantiateStreaming",
	]) {
		const original = wasm[operation];
		if (typeof original !== "function") continue;
		const descriptor = Object.getOwnPropertyDescriptor(wasm, operation);
		const wrapper = function (...args) {
			const entry = {
				operation,
				status: "pending",
				inputKind:
					args[0] instanceof wasm.Module
						? "module"
						: operation.endsWith("Streaming")
							? "response"
							: "buffer",
				instantiated: false,
			};
			events.push(entry);
			// Snapshot buffer ranges synchronously, before original code can detach
			// or caller code can mutate them. Response clone is captured before use.
			const proof = capture(args[0], operation.endsWith("Streaming"));
			track(proof.then((identity) => Object.assign(entry, identity)));
			let result;
			try {
				result = Reflect.apply(original, this, args);
			} catch (error) {
				entry.status = "rejected";
				throw error;
			}
			Promise.resolve(result)
				.then(
					(value) => {
						entry.status = "fulfilled";
						const module = operation.startsWith("compile")
							? value
							: value?.module;
						if (module instanceof wasm.Module) modules.set(module, proof);
						if (operation.startsWith("instantiate")) entry.instantiated = true;
					},
					() => {
						entry.status = "rejected";
					},
				)
				.catch((error) => errors.push(String(error?.message ?? error)));
			return result;
		};
		Object.defineProperty(wasm, operation, { ...descriptor, value: wrapper });
		originals.set(operation, { descriptor, wrapper });
	}
	const controller = Object.freeze({
		async snapshot({ timeoutMs = 5000 } = {}) {
			if (
				!Number.isSafeInteger(timeoutMs) ||
				timeoutMs < 1 ||
				timeoutMs > 10000
			)
				throw Error("Bounded proof wait required");
			let timer;
			try {
				await Promise.race([
					Promise.allSettled([...pending]),
					new Promise((done) => {
						timer = setTimeout(done, timeoutMs);
					}),
				]);
			} finally {
				clearTimeout(timer);
			}
			const consumed = events.filter(
				(event) => event.status === "fulfilled" && event.instantiated,
			);
			const hooksIntact = [...originals].every(
				([operation, { wrapper }]) => wasm[operation] === wrapper,
			);
			return {
				version: 1,
				expectedWasmSha256,
				events: events.map((event) => ({ ...event })),
				errors: [...errors],
				hooksIntact,
				pendingProofCount: pending.size,
				consumedCount: consumed.length,
				actualBytesVerified:
					pending.size === 0 &&
					hooksIntact &&
					consumed.length > 0 &&
					errors.length === 0 &&
					consumed.every(
						(event) =>
							event.byteLength > 0 && event.sha256 === expectedWasmSha256,
					),
			};
		},
		async assertConsumed() {
			const observation = await this.snapshot();
			if (!observation.actualBytesVerified)
				throw Error(
					"Actual instantiated WASM bytes are missing or differ from approved authority",
				);
			return observation;
		},
		restore() {
			for (const [operation, { descriptor, wrapper }] of originals) {
				if (wasm[operation] !== wrapper)
					throw Error("WASM observer hook changed during run");
				Object.defineProperty(wasm, operation, descriptor);
			}
		},
	});
	Object.defineProperty(realm, "__particleAuthorityWasmObservation", {
		value: controller,
		configurable: false,
	});
	return controller;
}
