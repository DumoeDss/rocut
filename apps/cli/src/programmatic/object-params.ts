import * as wasm from "opencut-wasm";

export const OBJECT_PARAMS_MAX_BYTES = 64 * 1024;
const RESOLVERS = {
	liquid: "resolveLiquidObjectParamsJson",
	glass: "resolveGlassObjectParamsJson",
	ink: "resolveInkObjectParamsJson",
} as const;
export type ObjectParamsExports = Readonly<Record<string, unknown>>;
const installed = wasm as unknown as ObjectParamsExports;

export class ObjectParamsUnavailableError extends Error {}

function record(value: unknown): value is Record<string, unknown> {
	return !!value && typeof value === "object" && !Array.isArray(value);
}

// JSON transport only. Rust alone owns field admission, defaults and ranges.
function jsonTransport(value: unknown, depth = 0, budget = { nodes: 4096 }): void {
	if (depth > 32 || --budget.nodes < 0) throw Error("Object params JSON budget exceeded");
	if (value === null || typeof value === "string" || typeof value === "boolean") return;
	if (typeof value === "number" && Number.isFinite(value)) return;
	if (Array.isArray(value)) {
		for (const item of value) jsonTransport(item, depth + 1, budget);
		return;
	}
	if (record(value) && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)) {
		for (const key of Reflect.ownKeys(value)) {
			const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
			if (typeof key !== "string" || !descriptor.enumerable || !("value" in descriptor))
				throw Error("Object params must contain JSON data only");
			jsonTransport(descriptor.value, depth + 1, budget);
		}
		return;
	}
	throw Error("Object params must contain JSON data only");
}

function envelope(raw: unknown): Record<string, unknown> {
	if (typeof raw !== "string" || Buffer.byteLength(raw, "utf8") > OBJECT_PARAMS_MAX_BYTES)
		throw new ObjectParamsUnavailableError("Object params resolver returned invalid transport");
	let value: unknown;
	try { value = JSON.parse(raw); } catch {
		throw new ObjectParamsUnavailableError("Object params resolver returned invalid JSON");
	}
	if (!record(value) || value.version !== 1 || typeof value.ok !== "boolean" ||
		(value.ok ? !record(value.params) : !record(value.error)))
		throw new ObjectParamsUnavailableError("Object params resolver returned invalid envelope");
	return value;
}

export function resolveProgrammaticObjectParams(input: unknown, exports: ObjectParamsExports = installed): string {
	jsonTransport(input);
	const text = JSON.stringify(input);
	if (Buffer.byteLength(text, "utf8") > OBJECT_PARAMS_MAX_BYTES) throw Error("Object params JSON budget exceeded");
	if (!record(input) || Object.keys(input).length !== 2 ||
		!Object.hasOwn(input, "object") || !Object.hasOwn(input, "params") ||
		typeof input.object !== "string" || !Object.hasOwn(RESOLVERS, input.object) || !record(input.params))
		throw Error("Expected { object: liquid|glass|ink, params: { version: 1, ... } }");
	const name = RESOLVERS[input.object as keyof typeof RESOLVERS];
	const resolver = exports[name];
	if (typeof resolver !== "function") throw new ObjectParamsUnavailableError(`Object params resolver unavailable: ${name}`);
	let raw: unknown;
	try { raw = resolver(JSON.stringify(input.params)); } catch {
		throw new ObjectParamsUnavailableError(`Object params resolver failed: ${name}`);
	}
	envelope(raw);
	return raw as string;
}

export function getProgrammaticObjectParamsCapability(exports: ObjectParamsExports = installed) {
	return {
		version: 1,
		route: "programmatic/object-params",
		maxRequestBytes: OBJECT_PARAMS_MAX_BYTES,
		scope: "rust-params-only; no-file-io-or-author-execution",
		resolvers: Object.entries(RESOLVERS).map(([object, resolver]) => {
			let available = false;
			try { available = envelope(resolveProgrammaticObjectParams({ object, params: { version: 1 } }, exports)).ok === true; } catch { /* unavailable, no fallback */ }
			return { object, resolver, available };
		}),
	};
}
