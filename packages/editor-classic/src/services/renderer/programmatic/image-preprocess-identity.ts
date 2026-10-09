/** Strict JSON structure identity: key order is not data; extra keys are data. */
export function sameImagePreprocessStructure({ left, right }: { left: unknown; right: unknown }): boolean {
	if (left === null || right === null) return left === right;
	if (typeof left !== typeof right) return false;
	if (typeof left === "number") return Number.isFinite(left) && Object.is(left, right);
	if (typeof left === "string" || typeof left === "boolean") return left === right;
	if (typeof left !== "object" || typeof right !== "object") return false;
	if (Array.isArray(left) !== Array.isArray(right)) return false;
	if (Array.isArray(left) && Array.isArray(right) && left.length !== right.length) return false;
	if (!Array.isArray(left) && [left, right].some(value => {
		const prototype: unknown = Object.getPrototypeOf(value);
		return prototype !== null && Object.getPrototypeOf(prototype) !== null;
	})) return false;
	const keys = Object.keys(left);
	if (Array.isArray(left) && keys.length !== left.length) return false;
	return keys.length === Object.keys(right).length && keys.every(key =>
		Object.prototype.hasOwnProperty.call(right, key) &&
		sameImagePreprocessStructure({ left: Reflect.get(left, key), right: Reflect.get(right, key) }));
}

/** Emit the exact same mechanism into the fixed private Canvas document. */
export const IMAGE_PREPROCESS_IDENTITY_SOURCE = `const sameMvPreprocessStructure = ${sameImagePreprocessStructure.toString()};`;
