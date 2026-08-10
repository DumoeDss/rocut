import type { TransactionOperation } from "..";

export function cloneTransactionValue<Value>(value: Value): Value {
	if (typeof structuredClone !== "function") {
		throw new Error("The transaction engine requires structuredClone");
	}
	return structuredClone(value);
}

export function deepFreezeTransactionValue<Value>(
	value: Value,
): Readonly<Value> {
	if (
		value === null ||
		(typeof value !== "object" && typeof value !== "function")
	) {
		return value;
	}
	if (value instanceof Map) {
		for (const [key, entry] of value) {
			deepFreezeTransactionValue(key);
			deepFreezeTransactionValue(entry);
		}
	} else if (value instanceof Set) {
		for (const entry of value) deepFreezeTransactionValue(entry);
	} else {
		for (const key of Reflect.ownKeys(value)) {
			const descriptor = Object.getOwnPropertyDescriptor(value, key);
			if (descriptor && "value" in descriptor) {
				deepFreezeTransactionValue(descriptor.value);
			}
		}
	}
	return Object.freeze(value);
}

type CanonicalValue =
	| readonly ["null"]
	| readonly ["undefined"]
	| readonly ["boolean", boolean]
	| readonly ["number", string]
	| readonly ["string", string]
	| readonly ["array", readonly CanonicalValue[]]
	| readonly ["object", readonly (readonly [string, CanonicalValue])[]];

function canonicalize(args: {
	readonly value: unknown;
	readonly seen: Set<object>;
}): CanonicalValue {
	const { value, seen } = args;
	if (value === null) return ["null"];
	if (value === undefined) return ["undefined"];
	if (typeof value === "boolean") return ["boolean", value];
	if (typeof value === "string") return ["string", value];
	if (typeof value === "number") {
		if (!Number.isFinite(value)) {
			throw new TypeError("Transaction operations require finite numbers");
		}
		return ["number", Object.is(value, -0) ? "-0" : String(value)];
	}
	if (typeof value !== "object") {
		throw new TypeError(
			`Transaction operations do not support ${typeof value} values`,
		);
	}
	if (seen.has(value)) {
		throw new TypeError("Transaction operations must not contain cycles");
	}
	seen.add(value);
	try {
		if (Array.isArray(value)) {
			const entries: CanonicalValue[] = [];
			for (let index = 0; index < value.length; index += 1) {
				if (!Object.hasOwn(value, index)) {
					throw new TypeError("Transaction operations require dense arrays");
				}
				entries.push(canonicalize({ value: value[index], seen }));
			}
			return ["array", entries];
		}
		const prototype = Object.getPrototypeOf(value);
		if (prototype !== Object.prototype && prototype !== null) {
			throw new TypeError("Transaction operations require plain objects");
		}
		const entries: Array<readonly [string, CanonicalValue]> = [];
		for (const key of Reflect.ownKeys(value)) {
			if (typeof key !== "string") {
				throw new TypeError(
					"Transaction operations do not support symbol keys",
				);
			}
			const descriptor = Object.getOwnPropertyDescriptor(value, key);
			if (!descriptor?.enumerable || !("value" in descriptor)) {
				throw new TypeError(
					"Transaction operations require enumerable data properties",
				);
			}
		}
		for (const key of Object.keys(value).sort()) {
			const descriptor = Object.getOwnPropertyDescriptor(value, key);
			if (!descriptor || !("value" in descriptor)) {
				throw new TypeError("Transaction operation property disappeared");
			}
			entries.push([key, canonicalize({ value: descriptor.value, seen })]);
		}
		return ["object", entries];
	} finally {
		seen.delete(value);
	}
}

export function canonicalOperationFingerprint(
	operations: readonly TransactionOperation[],
): string {
	return JSON.stringify(canonicalize({ value: operations, seen: new Set() }));
}
