import { TransactionError } from "..";
import { ProjectStoreError } from "@opencut/editor-ports";

export function cloneDraftValue<Value>(value: Value): Value {
	if (typeof structuredClone !== "function") {
		throw new Error("Draft editing requires structuredClone");
	}
	return structuredClone(value);
}

export function deepFreezeDraftValue<Value>(
	value: Value,
	seen: WeakSet<object> = new WeakSet(),
): Readonly<Value> {
	if (
		value === null ||
		(typeof value !== "object" && typeof value !== "function")
	) {
		return value;
	}
	if (seen.has(value)) return value;
	seen.add(value);
	if (value instanceof Map) {
		for (const [key, entry] of value) {
			deepFreezeDraftValue(key, seen);
			deepFreezeDraftValue(entry, seen);
		}
	} else if (value instanceof Set) {
		for (const entry of value) deepFreezeDraftValue(entry, seen);
	} else {
		for (const key of Reflect.ownKeys(value)) {
			const descriptor = Object.getOwnPropertyDescriptor(value, key);
			if (descriptor && "value" in descriptor) {
				deepFreezeDraftValue(descriptor.value, seen);
			}
		}
	}
	return Object.freeze(value);
}

export function immutableDraftValue<Value>(value: Value): Readonly<Value> {
	return deepFreezeDraftValue(cloneDraftValue(value));
}

function draftErrorPrototype(error: Error): object {
	if (error instanceof TransactionError) return TransactionError.prototype;
	if (error instanceof ProjectStoreError) return ProjectStoreError.prototype;
	if (error instanceof TypeError) return TypeError.prototype;
	if (error instanceof RangeError) return RangeError.prototype;
	if (error instanceof ReferenceError) return ReferenceError.prototype;
	if (error instanceof SyntaxError) return SyntaxError.prototype;
	if (error instanceof URIError) return URIError.prototype;
	if (error instanceof EvalError) return EvalError.prototype;
	return Error.prototype;
}

interface DraftMapEvidenceSnapshot {
	readonly evidenceType: "Map";
	readonly entries: Array<[unknown, unknown]>;
	readonly properties: Record<PropertyKey, unknown>;
}

interface DraftSetEvidenceSnapshot {
	readonly evidenceType: "Set";
	readonly values: unknown[];
	readonly properties: Record<PropertyKey, unknown>;
}

interface DraftDateEvidenceSnapshot {
	readonly evidenceType: "Date";
	readonly timestamp: number;
	readonly properties: Record<PropertyKey, unknown>;
}

interface DraftRegExpEvidenceSnapshot {
	readonly evidenceType: "RegExp";
	readonly source: string;
	readonly flags: string;
	readonly lastIndex: number;
	readonly properties: Record<PropertyKey, unknown>;
}

function copyDraftEvidenceProperties(args: {
	readonly source: object;
	readonly target: Record<PropertyKey, unknown>;
	readonly seen: Map<object, unknown>;
	readonly omitted?: ReadonlySet<PropertyKey>;
}): void {
	for (const key of Reflect.ownKeys(args.source)) {
		if (args.omitted?.has(key)) continue;
		const descriptor = Object.getOwnPropertyDescriptor(args.source, key);
		if (descriptor === undefined) continue;
		Object.defineProperty(args.target, key, {
			configurable: true,
			enumerable: descriptor.enumerable,
			writable: true,
			// Evidence-owned accessors are never invoked or retained.
			value:
				"value" in descriptor
					? cloneDraftEvidenceSafely(descriptor.value, args.seen)
					: undefined,
		});
	}
}

function regexpBooleanSlot(value: RegExp, key: string): boolean {
	const getter = Object.getOwnPropertyDescriptor(RegExp.prototype, key)?.get;
	return getter === undefined
		? false
		: Boolean(Reflect.apply(getter, value, []));
}

function regexpStringSlot(value: RegExp, key: "source"): string {
	const getter = Object.getOwnPropertyDescriptor(RegExp.prototype, key)?.get;
	if (getter === undefined) throw new TypeError(`Missing RegExp ${key} getter`);
	return String(Reflect.apply(getter, value, []));
}

function regexpFlags(value: RegExp): string {
	return [
		["hasIndices", "d"],
		["global", "g"],
		["ignoreCase", "i"],
		["multiline", "m"],
		["dotAll", "s"],
		["unicode", "u"],
		["unicodeSets", "v"],
		["sticky", "y"],
	]
		.filter(([slot]) => regexpBooleanSlot(value, slot ?? ""))
		.map(([, flag]) => flag)
		.join("");
}

function cloneDraftEvidence(
	value: unknown,
	seen: Map<object, unknown>,
): unknown {
	if (
		value === null ||
		typeof value === "undefined" ||
		typeof value === "boolean" ||
		typeof value === "number" ||
		typeof value === "string" ||
		typeof value === "bigint" ||
		typeof value === "symbol"
	) {
		return value;
	}
	if (typeof value === "function") return "[unavailable function evidence]";

	const prior = seen.get(value);
	if (prior !== undefined) return prior;

	if (value instanceof Map) {
		const entries: Array<[unknown, unknown]> = [];
		const properties = Object.create(null) as Record<PropertyKey, unknown>;
		const cloned: DraftMapEvidenceSnapshot = {
			evidenceType: "Map",
			entries,
			properties,
		};
		seen.set(value, cloned);
		for (const [key, entry] of Map.prototype.entries.call(value)) {
			entries.push([
				cloneDraftEvidenceSafely(key, seen),
				cloneDraftEvidenceSafely(entry, seen),
			]);
		}
		copyDraftEvidenceProperties({ source: value, target: properties, seen });
		return cloned;
	}
	if (value instanceof Set) {
		const values: unknown[] = [];
		const properties = Object.create(null) as Record<PropertyKey, unknown>;
		const cloned: DraftSetEvidenceSnapshot = {
			evidenceType: "Set",
			values,
			properties,
		};
		seen.set(value, cloned);
		for (const entry of Set.prototype.values.call(value)) {
			values.push(cloneDraftEvidenceSafely(entry, seen));
		}
		copyDraftEvidenceProperties({ source: value, target: properties, seen });
		return cloned;
	}
	if (value instanceof Date) {
		const properties = Object.create(null) as Record<PropertyKey, unknown>;
		const cloned: DraftDateEvidenceSnapshot = {
			evidenceType: "Date",
			timestamp: Date.prototype.getTime.call(value),
			properties,
		};
		seen.set(value, cloned);
		copyDraftEvidenceProperties({ source: value, target: properties, seen });
		return cloned;
	}
	if (value instanceof RegExp) {
		const properties = Object.create(null) as Record<PropertyKey, unknown>;
		const lastIndex = Object.getOwnPropertyDescriptor(value, "lastIndex");
		const cloned: DraftRegExpEvidenceSnapshot = {
			evidenceType: "RegExp",
			source: regexpStringSlot(value, "source"),
			flags: regexpFlags(value),
			lastIndex:
				lastIndex !== undefined && "value" in lastIndex
					? Number(lastIndex.value)
					: 0,
			properties,
		};
		seen.set(value, cloned);
		copyDraftEvidenceProperties({
			source: value,
			target: properties,
			seen,
			omitted: new Set(["lastIndex"]),
		});
		return cloned;
	}

	const cloned: object =
		value instanceof Error
			? Object.create(draftErrorPrototype(value))
			: Array.isArray(value)
				? []
				: Object.create(
						Object.getPrototypeOf(value) === null ? null : Object.prototype,
					);
	seen.set(value, cloned);

	for (const key of Reflect.ownKeys(value)) {
		if (Array.isArray(value) && key === "length") continue;
		const descriptor = Object.getOwnPropertyDescriptor(value, key);
		if (descriptor === undefined) continue;
		Object.defineProperty(cloned, key, {
			configurable: true,
			enumerable: descriptor.enumerable,
			writable: true,
			// Accessors are intentionally not invoked or retained: either choice
			// would keep attacker-controlled code/live state across the boundary.
			value:
				"value" in descriptor
					? cloneDraftEvidenceSafely(descriptor.value, seen)
					: undefined,
		});
	}
	if (Array.isArray(value)) {
		(cloned as unknown[]).length = value.length;
	}
	return cloned;
}

function cloneDraftEvidenceSafely(
	value: unknown,
	seen: Map<object, unknown>,
): unknown {
	try {
		return cloneDraftEvidence(value, seen);
	} catch {
		return "[unavailable unsafe evidence]";
	}
}

/**
 * Preserve the known T1 error prototypes while severing every mutable data
 * reference at the Draft boundary. Unknown prototypes and executable/accessor
 * properties are reduced to inert data. Map, Set, Date, and RegExp internal
 * slots become tagged data snapshots, including nested cycles, before the
 * complete evidence graph is frozen.
 */
export function immutableDraftErrorEvidence(error: unknown): unknown {
	try {
		return deepFreezeDraftValue(cloneDraftEvidenceSafely(error, new Map()));
	} catch {
		// Hostile proxies can throw from reflection traps. Error reporting must
		// still remain a structured outcome rather than reject approve().
		return Object.freeze(
			new Error("Engine error evidence could not be safely inspected"),
		);
	}
}
