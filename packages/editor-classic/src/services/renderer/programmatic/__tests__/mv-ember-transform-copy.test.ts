import { expect, test } from "bun:test";
import { MV_EMBER_RASTER_SOURCE } from "../mv-ember-raster";

test("matrix copying remains an ordered native Canvas operation, not a flattened transform", () => {
	const events: unknown[][] = [];
	const matrix = {
		a: 1.0461002588272095,
		b: 0,
		c: 0,
		d: 1.0461002588272095,
		e: -44.256248474121094,
		f: -24.894994258880615,
	};
	const ctx = {
		setTransform: (...args: unknown[]) =>
			events.push(["setTransform", ...args]),
		translate: (...args: number[]) => events.push(["translate", ...args]),
		scale: (...args: number[]) => events.push(["scale", ...args]),
		getTransform: () => {
			events.push(["getTransform"]);
			return matrix;
		},
	};
	const apply = new Function(
		`${MV_EMBER_RASTER_SOURCE}; return mvEmberTransform;`,
	)();
	apply(ctx, {
		transform: [1, 0, 0, 1, 0, 0],
		operations: [
			{ kind: "translate", offset: [10, 20] },
			{ kind: "copyTransform" },
			{ kind: "scale", factors: [0.94, 0.94] },
		],
	});
	expect(events).toEqual([
		["setTransform", 1, 0, 0, 1, 0, 0],
		["translate", 10, 20],
		["getTransform"],
		["setTransform", matrix],
		["scale", 0.94, 0.94],
	]);
	expect(events[3]![1]).toBe(matrix);
});
