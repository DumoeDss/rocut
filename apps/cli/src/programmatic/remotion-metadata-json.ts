/** Strict JSON identity. Key order is irrelevant; arrays retain their order.
 * Self-contained so the same function can run inside an opaque render realm. */
export function canonicalRemotionMetadataJson(value: unknown): string {
	const ancestors = new Set<object>();
	const encode = (item: unknown): string => {
		if (item === null) return "null";
		if (typeof item === "string" || typeof item === "boolean")
			return JSON.stringify(item);
		if (typeof item === "number" && Number.isFinite(item))
			return JSON.stringify(item);
		if (typeof item !== "object" || !item)
			throw Error("Remotion metadata contains a non-JSON value");
		if (ancestors.has(item))
			throw Error("Remotion metadata contains cyclic JSON");
		ancestors.add(item);
		try {
			const keys = Reflect.ownKeys(item);
			if (Array.isArray(item)) {
				if (
					keys.length !== item.length + 1 ||
					keys.some(
						(key) =>
							typeof key !== "string" ||
							(key !== "length" && !/^(0|[1-9][0-9]*)$/.test(key)),
					)
				)
					throw Error("Remotion metadata contains a sparse or extended array");
				const values: string[] = [];
				for (let index = 0; index < item.length; index++) {
					const descriptor = Object.getOwnPropertyDescriptor(
						item,
						String(index),
					);
					if (!descriptor || !("value" in descriptor) || !descriptor.enumerable)
						throw Error("Remotion metadata contains a non-JSON array property");
					values.push(encode(descriptor.value));
				}
				return "[" + values.join(",") + "]";
			}
			const prototype = Object.getPrototypeOf(item);
			if (prototype !== Object.prototype && prototype !== null)
				throw Error("Remotion metadata contains a non-JSON object");
			if (keys.some((key) => typeof key !== "string"))
				throw Error("Remotion metadata contains a symbol property");
			const names = keys
				.filter((key): key is string => typeof key === "string")
				.sort();
			return (
				"{" +
				names
					.map((key) => {
						const descriptor = Object.getOwnPropertyDescriptor(item, key);
						if (
							!descriptor ||
							!("value" in descriptor) ||
							!descriptor.enumerable
						)
							throw Error(
								"Remotion metadata contains a non-JSON object property",
							);
						return JSON.stringify(key) + ":" + encode(descriptor.value);
					})
					.join(",") +
				"}"
			);
		} finally {
			ancestors.delete(item);
		}
	};
	return encode(value);
}
