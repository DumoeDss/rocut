import { expect, test } from "bun:test";
import type { ParamDefinition, ParamValues } from "../../params";
import {
	appendCanvasStroke,
	removeCanvasStroke,
	clearCanvasStrokes,
	canvasStrokeState,
	canvasFieldGroups,
	canvasTypedValue,
} from "../components/canvas-stroke-edit";

// Transport fixtures exercise authoring edits; Rust admission and actual DOM
// interaction are separate checks.
const fields = [
	"StartTicks",
	"EndTicks",
	"FromX",
	"FromY",
	"ToX",
	"ToY",
	"Radius",
	"Bristles",
	"Opacity",
	"Wetness",
	"Thickness",
];
const staticKeys = [
	"version",
	"columns",
	"rows",
	"durationTicks",
	"seed",
	"drying",
	"diffusion",
	"weaveFrequency",
	"weaveHeight",
	"lightX",
	"lightY",
	"lightZ",
	"relief",
];
const definitions: ParamDefinition[] = [
	{
		key: "strokeCount",
		label: "Count",
		type: "number",
		min: 0,
		max: 16,
		step: 1,
		default: 0,
		keyframable: false,
	},
	...staticKeys.map((key) => ({
		key,
		label: key,
		type: "number" as const,
		min: 0,
		max: 1,
		step: 0.01,
		default: 0.5,
		keyframable: false,
	})),
	...Array.from({ length: 16 }, (_, index) =>
		fields.map((field, axis) => ({
			key: `stroke${index}${field}`,
			label: field,
			type: "number" as const,
			min: 0,
			max: 120000,
			step: 0.001,
			default: axis + 0.000125,
			keyframable: false,
			required: false,
		})),
	).flat(),
];

test("explicit additions create exactly eleven fields per active trajectory through sixteen", () => {
	let params: ParamValues = { strokeCount: 0, drying: 0.000000125 };
	for (let count = 1; count <= 16; count++) {
		const before = structuredClone(params);
		params = appendCanvasStroke({ params, definitions });
		expect(before.strokeCount).toBe(count - 1);
		expect(params.strokeCount).toBe(count);
		expect(
			Object.keys(params).filter((key) => /^stroke\d/.test(key)),
		).toHaveLength(count * 11);
		for (const [axis, field] of fields.entries())
			expect(params[`stroke${count - 1}${field}`]).toBe(axis + 0.000125);
	}
	expect(params.drying).toBe(0.000000125);
	expect(() => appendCanvasStroke({ params, definitions })).toThrow();
});

test("first middle last removals preserve precise complete survivors in authored order", () => {
	let params: ParamValues = { strokeCount: 0, lightX: -0.123456789012345 };
	for (let slot = 0; slot < 3; slot++) {
		params = appendCanvasStroke({ params, definitions });
		for (const [axis, field] of fields.entries())
			params[`stroke${slot}${field}`] = slot + axis / 1000000;
	}
	params.stroke0StartTicks = 37;
	params.stroke1StartTicks = 1;
	params.stroke2StartTicks = 1;
	const before = structuredClone(params);
	for (const index of [0, 1, 2]) {
		const next = removeCanvasStroke({ params, definitions, index });
		for (const [target, source] of [0, 1, 2]
			.filter((slot) => slot !== index)
			.entries())
			for (const field of fields)
				expect(next[`stroke${target}${field}`]).toBe(
					params[`stroke${source}${field}`],
				);
		for (const field of fields)
			expect(Object.hasOwn(next, `stroke2${field}`)).toBe(false);
		expect(next.lightX).toBe(params.lightX);
	}
	expect(params).toEqual(before);
});

test("malformed schedule has an explicit clear operation preserving all material inputs", () => {
	for (const strokeCount of [-1, 0.5, 17, "1", NaN]) {
		const params: ParamValues = {
			strokeCount,
			stroke0Radius: 0.1,
			drying: "bad",
			lightZ: 0.333333333333333,
		};
		const before = structuredClone(params);
		expect(canvasStrokeState({ params, definitions }).issue).not.toBe("");
		expect(() => appendCanvasStroke({ params, definitions })).toThrow();
		expect(clearCanvasStrokes({ params })).toEqual({
			strokeCount: 0,
			drying: "bad",
			lightZ: 0.333333333333333,
		});
		expect(params).toEqual(before);
	}
	for (const key of ["stroke0Radius", "stroke16StartTicks", "stroke0Unknown"]) {
		const params = { strokeCount: 0, [key]: 0.1 };
		expect(canvasStrokeState({ params, definitions }).issue).not.toBe("");
		expect(clearCanvasStrokes({ params })).toEqual({ strokeCount: 0 });
	}
});

test("incomplete and invalid active inputs remain available for correction without defaults", () => {
	const params = appendCanvasStroke({
		params: { strokeCount: 0 },
		definitions,
	});
	delete params.stroke0Wetness;
	params.stroke0StartTicks = "bad";
	expect(canvasStrokeState({ params, definitions }).issue).toBe("");
	const next = appendCanvasStroke({ params, definitions });
	expect(Object.hasOwn(next, "stroke0Wetness")).toBe(false);
	expect(next.stroke0StartTicks).toBe("bad");
	expect(removeCanvasStroke({ params: next, definitions, index: 1 })).toEqual(
		params,
	);
	for (const input of ["", " ", "bad", "1+2", "Infinity", "NaN"])
		expect(canvasTypedValue({ input })).toBe(input);
	for (const input of ["37", "0.123456789012345", "-0.000125", "17.25"])
		expect(canvasTypedValue({ input })).toBe(Number(input));
});

test("static groups contain material and lighting without raw trajectory slots", () => {
	const groups = canvasFieldGroups({ definitions });
	expect(groups.map((group) => group.label)).toEqual(["Material", "Lighting"]);
	expect(groups[0].params.map((param) => param.key)).toEqual(
		staticKeys.slice(0, 9),
	);
	expect(groups[1].params.map((param) => param.key)).toEqual([
		"lightX",
		"lightY",
		"lightZ",
		"relief",
	]);
});
