/** Compare snapshot data with the legacy projection serializer's semantics. */
export function projectionValuesEqual({
	left,
	right,
}: {
	left: unknown;
	right: unknown;
}): boolean {
	if (typeof left !== typeof right) return false;
	if (left === null || right === null) return left === right;
	if (typeof left !== "object" || typeof right !== "object") {
		// The legacy representation treats -0 as 0 and two NaNs as equal.
		return left === right || String(left) === String(right);
	}
	if (Array.isArray(left) || Array.isArray(right)) {
		if (!Array.isArray(left) || !Array.isArray(right)) return false;
		// Array#map/join historically collapses an empty array and one hole.
		// Keep that behavior without serializing normal dense, equal-length data.
		if (left.length !== right.length)
			return stableValue(left) === stableValue(right);
		for (let index = 0; index < left.length; index++) {
			if (index in left !== index in right) return false;
			if (
				index in left &&
				!projectionValuesEqual({ left: left[index], right: right[index] })
			)
				return false;
		}
		return true;
	}
	const keys = Object.keys(left);
	if (keys.length !== Object.keys(right).length) return false;
	for (const key of keys) {
		if (!Object.prototype.propertyIsEnumerable.call(right, key)) return false;
		if (
			!projectionValuesEqual({
				left: Reflect.get(left, key),
				right: Reflect.get(right, key),
			})
		)
			return false;
	}
	return true;
}

function stableValue(value: unknown): string {
	if (value === null) return "null";
	if (value === undefined) return "undefined";
	if (typeof value === "string") return `string:${JSON.stringify(value)}`;
	if (typeof value === "number" || typeof value === "boolean")
		return `${typeof value}:${String(value)}`;
	if (Array.isArray(value))
		return `array:[${value.map(stableValue).join(",")}]`;
	if (typeof value === "object")
		return `object:{${Object.keys(value)
			.sort()
			.map(
				(key) =>
					`${JSON.stringify(key)}:${stableValue(Reflect.get(value, key))}`,
			)
			.join(",")}}`;
	return `${typeof value}:${String(value)}`;
}
