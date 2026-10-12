import { join } from "node:path";
import { assertNativeProbeWasmIdentity } from "./native-probe-wasm-binding.mjs";

export const NATIVE_PRIVATE_WASM_ID = "rocut-object-private-wasm";

/** The stamp attests separately fetched served bytes after the native entry import,
 * not an independently observed WebAssembly instance or its consumed byte buffer. */
export function createNativeProbeWasmPlugin(binding) {
	const virtual = "\0" + NATIVE_PRIVATE_WASM_ID;
	return {
		name: "object-probe-private-wasm",
		enforce: "pre",
		resolveId(id) {
			if (id === NATIVE_PRIVATE_WASM_ID) return virtual;
		},
		load(id) {
			if (id !== virtual) return;
			assertNativeProbeWasmIdentity(binding);
			return `import ${JSON.stringify(binding.entry.replaceAll("\\", "/"))};
import wasmUrl from ${JSON.stringify(join(binding.directory, "opencut_wasm_bg.wasm").replaceAll("\\", "/") + "?url")};
const response = await fetch(wasmUrl);
if (!response.ok) throw Error("Native WASM fetch failed");
const bytes = await response.arrayBuffer();
const sha256 = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), byte => byte.toString(16).padStart(2, "0")).join("");
if (sha256 !== ${JSON.stringify(binding.wasmSha256)}) throw Error("Served native WASM differs");
globalThis.__nativeProbeWasmIdentity = ${JSON.stringify(binding.identity)};
export * from ${JSON.stringify(binding.entry.replaceAll("\\", "/"))};`;
		},
	};
}
