import { expect, spyOn, test } from "bun:test";
import { cloneOpaque, overlayOpaque } from "../opaque-value";

test("immutable scalar leaves retain exact values without native clone calls", () => {
	const values = [
		null,
		undefined,
		true,
		false,
		"",
		"cue",
		0,
		-0,
		NaN,
		Infinity,
		-Infinity,
		12n,
	];
	const clone = spyOn(globalThis, "structuredClone");
	try {
		for (const value of values)
			expect(Object.is(cloneOpaque(value), value)).toBe(true);
		expect(clone).not.toHaveBeenCalled();
	} finally {
		clone.mockRestore();
	}
});

test("unsupported leaves still fail native cloning and mutable objects remain isolated", () => {
	for (const value of [Symbol("opaque"), () => undefined]) {
		expect(() => cloneOpaque(value)).toThrow();
	}
	const value = { data: new Uint8Array([1, 2]), date: new Date(42) };
	const copy = cloneOpaque(value);
	copy.data[0] = 9;
	copy.date.setTime(100);
	expect(value.data[0]).toBe(1);
	expect(value.date.getTime()).toBe(42);
});

test("overlays do not deep-clone known subtrees at every ancestor", () => {
	const retained = {
		scenes: [
			{
				id: "scene",
				cues: Array.from({ length: 120 }, (_, i) => ({
					id: `cue-${i}`,
					text: "old",
				})),
			},
		],
	};
	const known = {
		scenes: [
			{
				id: "scene",
				cues: retained.scenes[0].cues.map((cue) => ({ ...cue, text: "new" })),
			},
		],
	};
	const clone = spyOn(globalThis, "structuredClone");
	try {
		const result = overlayOpaque({ retained, known });
		expect(result).toEqual(known);
		expect(result).not.toBe(known);
		// Deterministic cost guard, not a machine-dependent millisecond gate:
		// known arrays must never enter a discarded deep clone.
		const clonedInputs = clone.mock.calls.map(([value]) =>
			JSON.stringify(value),
		);
		expect(clonedInputs.some((value) => value?.includes('"cues":'))).toBe(
			false,
		);
		expect(clonedInputs.some((value) => value?.includes('"scenes":'))).toBe(
			false,
		);
	} finally {
		clone.mockRestore();
	}
});

test("retained opaque siblings stay isolated with aliases, cycles and binary types", () => {
	const privateValue = {
		bytes: new Uint8Array([7, 8]),
		when: new Date(1234),
		set: new Set(["a"]),
		map: new Map([["a", 1]]),
	};
	const cycle: { self?: unknown } = {};
	cycle.self = cycle;
	const retained = {
		id: "same",
		text: "old",
		privateA: privateValue,
		privateB: privateValue,
		cycle,
	};
	const result = overlayOpaque({
		retained,
		known: {
			...retained,
			text: "new",
			privateA: undefined,
			privateB: undefined,
			cycle: undefined,
		},
	});
	// Explicit undefined clears a known field instead of retaining old data.
	expect(result.privateA).toBeUndefined();
	const opaque = overlayOpaque<Record<string, unknown>>({
		retained,
		known: { id: "same", text: "new" },
	});
	expect(opaque.privateA).toEqual(privateValue);
	expect(opaque.privateA).toBe(opaque.privateB);
	expect(opaque.privateA).not.toBe(privateValue);
	expect(opaque.cycle).toEqual(cycle);
	expect(opaque.cycle).not.toBe(cycle);
	expect(retained.text).toBe("old");
});

test("identity reorder and replacement preserve only matching private fields", () => {
	const retained = [
		{ id: "a", private: { a: 1 } },
		{ id: "b", private: { b: 1 } },
	];
	expect(
		overlayOpaque({ retained, known: [{ id: "b" }, { id: "c" }] }),
	).toEqual([{ id: "b", private: { b: 1 } }, { id: "c" }]);
});
