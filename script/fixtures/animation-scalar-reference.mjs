import assert from "node:assert/strict";

export const semantics = "scalar-f64-v1";
export const apiNames = {
	sample: "sampleScalarAnimationBatchJson",
	inspect: "inspectScalarAnimationDomainsJson",
};

export function bits(value) {
	const bytes = Buffer.alloc(8);
	bytes.writeDoubleBE(value);
	return bytes.toString("hex");
}

// JSON.stringify erases negative zero; the boundary promises its f64 bit pattern.
export function wireJson(value) {
	if (typeof value === "number") {
		assert(Number.isFinite(value), "Use explicit raw JSON for invalid-number cases");
		return Object.is(value, -0) ? "-0.0" : String(value);
	}
	if (Array.isArray(value)) return `[${value.map(wireJson).join(",")}]`;
	if (value !== null && typeof value === "object") {
		return `{${Object.entries(value).map(([key, entry]) => `${JSON.stringify(key)}:${wireJson(entry)}`).join(",")}}`;
	}
	assert(value !== undefined);
	return JSON.stringify(value);
}

function cubic(u, points) {
	const m = 1 - u;
	return m * m * m * points[0] + 3 * m * m * u * points[1]
		+ 3 * m * u * u * points[2] + u * u * u * points[3];
}

function finite(value, keyIndex) {
	if (!Number.isFinite(value)) {
		const error = new Error("non-finite-arithmetic");
		error.code = "non-finite-arithmetic";
		error.keyIndex = keyIndex;
		throw error;
	}
	return value;
}

/** CPU reference: existing TS operation order, plus v1's explicit constant rule. */
export function sampleReference(item, time, { legacyConstantArithmetic = false } = {}) {
	assert(Number.isFinite(time));
	const { keys, extrapolation } = item.channel;
	if (!keys.length) return item.fallbackValue;
	if (keys.length === 1) return keys[0].value;
	const lastIndex = keys.length - 1;
	for (const [outside, edgeIndex, neighborIndex, mode] of [
		[time < keys[0].time, 0, 1, extrapolation.before],
		[time > keys[lastIndex].time, lastIndex, lastIndex - 1, extrapolation.after],
	]) {
		if (!outside) continue;
		const edge = keys[edgeIndex], neighbor = keys[neighborIndex];
		return finite(mode === "hold" ? edge.value : edge.value
			+ ((time - edge.time) / (neighbor.time - edge.time)) * (neighbor.value - edge.value), edgeIndex);
	}
	const exact = keys.find(key => key.time === time);
	if (exact) return exact.value;
	const index = keys.findIndex((key, i) => i < lastIndex && key.time < time && keys[i + 1].time > time);
	assert(index >= 0);
	const left = keys[index], right = keys[index + 1], span = right.time - left.time;
	if (left.segmentToNext === "step") return left.value;
	if (left.segmentToNext === "linear") {
		const fraction = Math.min(1, Math.max(0, (time - left.time) / span));
		return finite(left.value + (right.value - left.value) * fraction, index);
	}
	assert.equal(left.segmentToNext, "bezier");
	const rightDt = left.rightHandle ? Math.min(span, Math.max(0, left.rightHandle.dt)) : span / 3;
	const leftDt = right.leftHandle ? Math.max(-span, Math.min(0, right.leftHandle.dt)) : -span / 3;
	const rightDv = left.rightHandle?.dv ?? (right.value - left.value) / 3;
	const leftDv = right.leftHandle?.dv ?? -(right.value - left.value) / 3;
	const x = [left.time, left.time + rightDt, right.time + leftDt, right.time];
	const y = [left.value, left.value + rightDv, right.value + leftDv, right.value];
	for (const value of [...x, ...y]) finite(value, index);
	if (!legacyConstantArithmetic && y.every(value => value === y[0])) return y[0];
	let low = 0, high = 1;
	for (let iteration = 0; iteration < 20; iteration++) {
		const midpoint = (low + high) / 2;
		if (cubic(midpoint, x) < time) low = midpoint;
		else high = midpoint;
	}
	return finite(cubic((low + high) / 2, y), index);
}

export const key = (time, value, segmentToNext = "linear", handles = {}) => ({ time, value, segmentToNext, ...handles });
export const channel = (keys = [], before = "hold", after = "hold") => ({ keys, extrapolation: { before, after } });
export const sampleItem = (id, keys = [], times = [0], options = {}) => ({
	id, channel: channel(keys), fallbackValue: 0.5, times, ...options,
});
export const request = (items, budget) => ({ version: 1, numericSemantics: semantics, items,
	...(budget === undefined ? {} : { budget: { maxNodes: budget } }) });

export function constantDifference() {
	for (const value of [0.1, 0.2, 0.3, 1, Number.MAX_VALUE, Number.MIN_VALUE, -0]) {
		const item = sampleItem("constant-rule", [key(0, value, "bezier"), key(120000, value)], []);
		for (const time of [0.125, 1.5, 100, 30000, 60000, 90000, 119999.75]) {
			const canonical = sampleReference(item, time);
			let legacy;
			try { legacy = sampleReference(item, time, { legacyConstantArithmetic: true }); }
			catch (error) { return { item, time, canonical, canonicalBits: bits(canonical), legacyError: error.code }; }
			if (bits(canonical) !== bits(legacy)) return {
				item, time, canonical, legacy, canonicalBits: bits(canonical), legacyBits: bits(legacy),
			};
		}
	}
	throw new Error("No constant-operation difference observed; review reference coverage");
}
