import * as wasm from "opencut-wasm";
import { liquidParameters, liquidRate } from "./liquid-browser-cases";
import type { Readback } from "./liquid-browser-readback-capture";

/** Runs before any scene compositor exists, so the diagnostic guard is isolated. */
export async function checkLiquidReadbackLifecycle(expectedBackend: string) {
	const readback = Reflect.get(wasm, "applyEffectPassesReadback") as
		| Readback
		| undefined;
	if (typeof readback !== "function")
		throw Error("Diagnostic WASM lacks applyEffectPassesReadback");
	const source = new OffscreenCanvas(4, 3);
	source.getContext("2d")!.fillRect(0, 0, 4, 3);
	const resolved = JSON.parse(
		wasm.resolveStylizedEffectJson(
			JSON.stringify({
				effectType: "liquid",
				params: liquidParameters(),
				localTime: 0,
				frameRate: liquidRate,
			}),
		),
	);
	if (resolved.error || !resolved.passes.length)
		throw Error("Lifecycle fixture has no valid effect pass");
	const options = {
		source,
		width: 4,
		height: 3,
		passes: resolved.passes.map(
			(pass: {
				shader: string;
				uniforms: Record<string, number | number[]>;
			}) => ({
				shader: pass.shader,
				uniforms: Object.entries(pass.uniforms).map(([name, value]) => ({
					name,
					value: Array.isArray(value) ? value : [value],
				})),
			}),
		),
	};
	const results: { name: string; ok: boolean; error?: string }[] = [];
	const observe = (promise: ReturnType<Readback>) =>
		promise.then(
			(value) => ({ ok: true, value, error: "" }),
			(error) => ({ ok: false, value: undefined, error: String(error) }),
		);
	const valid = (outcome: Awaited<ReturnType<typeof observe>>) =>
		Boolean(
			outcome.ok &&
			outcome.value?.rgba.length === 48 &&
			outcome.value.backend === expectedBackend,
		);
	const pending = observe(readback(options));
	let disposalError = "";
	try {
		wasm.disposeGpu();
	} catch (error) {
		disposalError = String(error);
	}
	results.push({
		name: "pending readback rejects synchronous disposal",
		ok: disposalError.includes(
			"Cannot dispose GPU while a diagnostic readback is pending",
		),
		error: disposalError,
	});
	const concurrent = observe(readback(options));
	const [first, second] = await Promise.all([pending, concurrent]);
	results.push({
		name: "first pending readback completes",
		ok: valid(first),
		error: first.error,
	});
	results.push({
		name: "pending readback rejects concurrent readback",
		ok:
			!second.ok &&
			second.error.includes("Only one diagnostic readback may be pending"),
		error: second.error,
	});
	try {
		wasm.disposeGpu();
		results.push({
			name: "successful readback releases disposal guard",
			ok: true,
		});
	} catch (error) {
		results.push({
			name: "successful readback releases disposal guard",
			ok: false,
			error: String(error),
		});
	}
	await wasm.initializeGpu();
	const invalid = await observe(readback({ ...options, width: 0 }));
	results.push({
		name: "invalid dimensions reject before allocation",
		ok:
			!invalid.ok &&
			invalid.error.includes("Diagnostic dimensions must be nonzero"),
		error: invalid.error,
	});
	const recovered = await observe(readback(options));
	results.push({
		name: "invalid dimensions release guard for next valid readback",
		ok: valid(recovered),
		error: recovered.error,
	});
	wasm.disposeGpu();
	await wasm.initializeGpu();
	const backend = new wasm.WasmRuntimeGraphicsQuery().selectedBackend();
	results.push({
		name: "reinitialization preserves requested backend",
		ok: backend === expectedBackend,
	});
	return {
		ok: results.every((result) => result.ok),
		backend,
		results,
		notRun: [
			"real mapping failure injection",
			"real callback timeout injection",
		],
	};
}
