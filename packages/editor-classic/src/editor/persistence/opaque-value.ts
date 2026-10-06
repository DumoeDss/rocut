/**
 * Clone values at the editor/store seam without silently narrowing the store's
 * opaque payload to JSON. Dates, Maps, Sets, typed arrays and ArrayBuffers are
 * deliberately retained.
 */
export function cloneOpaque<Value>(value: Value): Value {
	if (typeof structuredClone !== "function") {
		throw new Error("This Host does not provide structured cloning");
	}
	// Overlay traversals visit many scalar leaves. They cannot share mutable
	// state; unsupported symbols/functions must still reach native rejection.
	if (value === null) return value;
	switch (typeof value) {
		case "undefined":
		case "boolean":
		case "string":
		case "number":
		case "bigint":
			return value;
	}
	return structuredClone(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function identityOf(value: unknown): string | number | null {
	if (!isRecord(value)) return null;
	return typeof value.id === "string" || typeof value.id === "number"
		? value.id
		: null;
}

/**
 * Overlay a known editor projection onto an opaque retained value.
 *
 * Current values decide which identified array members exist. Retained members
 * are matched only by stable `id`, so deletion drops private fields and a new id
 * cannot inherit them. Unknown object siblings are copied from `retained`.
 */
export function overlayOpaque<Value>({
	retained,
	known,
}: {
	retained: unknown;
	known: Value;
}): Value {
	if (Array.isArray(known)) {
		const retainedArray = Array.isArray(retained) ? retained : [];
		const retainedById = new Map<string | number, unknown>();
		for (const member of retainedArray) {
			const identity = identityOf(member);
			if (identity !== null) retainedById.set(identity, member);
		}
		// eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- recursion preserves the caller's array shape.
		return known.map((member, index) => {
			const identity = identityOf(member);
			const previous =
				identity === null ? retainedArray[index] : retainedById.get(identity);
			return overlayOpaque({ retained: previous, known: member });
		}) as Value;
	}

	if (isRecord(known)) {
		const knownIdentity = identityOf(known);
		const retainedIdentity = identityOf(retained);
		const mayRetain =
			knownIdentity === null || knownIdentity === retainedIdentity;
		const retainedRecord =
			isRecord(retained) && mayRetain ? retained : undefined;
		// Known children are overlaid below. Cloning them here as well copies
		// every large sequence once per ancestor, only to discard those copies.
		// Clone unknown siblings together to preserve their shared references.
		const prototype = retainedRecord && Object.getPrototypeOf(retainedRecord);
		const base = !retainedRecord
			? {}
			: prototype === Object.prototype || prototype === null
				? cloneOpaque(
						Object.fromEntries(
							Object.entries(retainedRecord).filter(
								([key]) =>
									!Object.prototype.propertyIsEnumerable.call(known, key),
							),
						),
					)
				: cloneOpaque(retainedRecord);
		for (const [key, value] of Object.entries(known)) {
			base[key] = overlayOpaque({
				retained: retainedRecord?.[key],
				known: value,
			});
		}
		// eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- known keys came from Value and retained siblings remain opaque.
		return base as Value;
	}

	return cloneOpaque(known);
}
