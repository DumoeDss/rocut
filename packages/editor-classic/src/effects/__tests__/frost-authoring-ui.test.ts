import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import type { ParamDefinition, ParamValues } from "../../params";
import {
	appendFrostStroke,
	removeFrostStroke,
	frostStrokeState,
	frostFieldGroups,
	frostTypedValue,
	FROST_STROKE_FIELDS,
} from "../components/frost-stroke-edit";
import {
	appendBubblePoint,
	removeBubblePoint,
} from "../components/bubble-trajectory-edit";

// Catalog observation double for transport only: no WASM exports are mocked or
// executed. Native catalog/admission and actual DOM/undo remain separate gates.
const definitions: ParamDefinition[] = [
	{
		key: "strokeCount",
		label: "Strokes",
		type: "number",
		min: 0,
		max: 16,
		step: 1,
		default: 0,
		keyframable: false,
	},
	{
		key: "holdTicks",
		label: "Hold",
		type: "number",
		min: 0,
		max: 3600000,
		step: 1,
		default: 0,
		keyframable: false,
	},
	{
		key: "recoveryTicks",
		label: "Recovery",
		type: "number",
		min: 1,
		max: 3600000,
		step: 1,
		default: 120000,
		keyframable: false,
	},
	{
		key: "seed",
		label: "Seed",
		type: "number",
		min: 0,
		max: 16777215,
		step: 1,
		default: 17,
		keyframable: false,
	},
	...[
		"amount",
		"coverage",
		"scale",
		"blur",
		"refraction",
		"tintStrength",
		"tintR",
		"tintG",
		"tintB",
	].map((key) => ({
		key,
		label: key,
		type: "number" as const,
		min: 0,
		step: 0.01,
		default: 0.5,
		keyframable: true,
	})),
	...Array.from({ length: 16 }, (_, index) =>
		FROST_STROKE_FIELDS.map((field) => ({
			key: `stroke${index}${field}`,
			label: field,
			type: "number" as const,
			min: 0,
			step: 0.001,
			default:
				field === "TimeTicks"
					? 0
					: field === "Strength"
						? 1
						: field === "Radius"
							? 0.1
							: 0.5,
			keyframable: false,
			required: false,
		})),
	).flat(),
];

test("zero/one/max explicit additions use all seven catalog defaults without inactive slots", () => {
	let params: ParamValues = { strokeCount: 0, opaque: "neighbor" };
	for (let count = 1; count <= 16; count++) {
		const before = structuredClone(params);
		const next = appendFrostStroke({ params, definitions });
		expect(params).toEqual(before);
		expect(next.strokeCount).toBe(count);
		for (const field of FROST_STROKE_FIELDS)
			expect(next[`stroke${count - 1}${field}`]).toBe(
				definitions.find((param) => param.key === `stroke${count - 1}${field}`)!
					.default,
			);
		expect(next.opaque).toBe("neighbor");
		expect(Object.hasOwn(next, `stroke${count}TimeTicks`)).toBe(false);
		params = next;
	}
	expect(() => appendFrostStroke({ params, definitions })).toThrow();
	const smaller = definitions.map((param) =>
		param.key === "strokeCount" && param.type === "number"
			? { ...param, max: 1 }
			: param,
	);
	expect(() =>
		appendFrostStroke({
			params: { ...params, strokeCount: 2 },
			definitions: smaller,
		}),
	).toThrow();
});

test("deleting first/middle/last preserves all seven fields and clears last slot without sorting", () => {
	let params: ParamValues = {
		strokeCount: 0,
		amount: 0.125,
		opaque: "neighbor",
	};
	Reflect.set(params, "opaque", { sentinel: ["keep", { value: 7 }] });
	for (let index = 0; index < 3; index++)
		params = appendFrostStroke({ params, definitions });
	for (let index = 0; index < 3; index++)
		for (const [axis, field] of FROST_STROKE_FIELDS.entries())
			params[`stroke${index}${field}`] =
				field === "TimeTicks" ? [100, 1, 1][index] : index + axis / 100;
	const before = structuredClone(params);
	for (const index of [0, 1, 2]) {
		const next = removeFrostStroke({ params, definitions, index });
		const survivors = [0, 1, 2].filter((slot) => slot !== index);
		for (const [target, original] of survivors.entries())
			for (const field of FROST_STROKE_FIELDS)
				expect(next[`stroke${target}${field}`]).toBe(
					params[`stroke${original}${field}`],
				);
		for (const field of FROST_STROKE_FIELDS)
			expect(Object.hasOwn(next, `stroke2${field}`)).toBe(false);
		expect(next.opaque).toEqual(params.opaque);
		expect(next.amount).toBe(params.amount);
		expect(params).toEqual(before);
	}
	const one = appendFrostStroke({ params: { strokeCount: 0 }, definitions });
	expect(removeFrostStroke({ params: one, definitions, index: 0 })).toEqual({
		strokeCount: 0,
	});
});

test("incomplete drafts, inactive slots and invalid counts are never normalized", () => {
	for (const count of [undefined, null, "1", -1, 0.5, 17, NaN, Infinity]) {
		const params: ParamValues = {};
		Reflect.set(params, "strokeCount", count);
		const before = structuredClone(params);
		expect(frostStrokeState({ params, definitions }).issue).not.toBe("");
		expect(() => appendFrostStroke({ params, definitions })).toThrow();
		expect(() =>
			removeFrostStroke({ params, definitions, index: 0 }),
		).toThrow();
		expect(params).toEqual(before);
	}
	for (const field of FROST_STROKE_FIELDS) {
		const params = appendFrostStroke({
			params: { strokeCount: 0 },
			definitions,
		});
		delete params[`stroke0${field}`];
		expect(() => appendFrostStroke({ params, definitions })).toThrow();
		expect(() =>
			removeFrostStroke({ params, definitions, index: 0 }),
		).toThrow();
	}
	expect(() =>
		appendFrostStroke({
			params: { strokeCount: 0, stroke0Radius: 0.1 },
			definitions,
		}),
	).toThrow();
	for (const index of [-1, 0.5, 2])
		expect(() =>
			removeFrostStroke({
				params: appendFrostStroke({ params: { strokeCount: 0 }, definitions }),
				definitions,
				index,
			}),
		).toThrow();
});

test("typed finite values are exact and invalid text remains text, not zero/default/expression", () => {
	for (const input of ["", " ", "bad", "1+2", "Infinity", "NaN", "1x"])
		expect(frostTypedValue({ input })).toBe(input);
	for (const input of ["0.000125", "0.5", "-1.25", "9007199254740991", "17.25"])
		expect(frostTypedValue({ input })).toBe(Number(input));
	const params = appendFrostStroke({ params: { strokeCount: 0 }, definitions });
	params.stroke0TimeTicks = "";
	expect(frostStrokeState({ params, definitions }).issue).toBe("");
	expect(appendFrostStroke({ params, definitions }).stroke0TimeTicks).toBe("");
});

test("groups separate nine optics from static recovery and active stroke controls", () => {
	const groups = frostFieldGroups({ definitions });
	expect(groups.map((group) => group.label)).toEqual(["Optics", "Recovery"]);
	expect(groups[0].params).toHaveLength(9);
	expect(groups[1].params.map((param) => param.key)).toEqual([
		"holdTicks",
		"recoveryTicks",
		"seed",
	]);
	expect(
		groups
			.flatMap((group) => group.params)
			.some((param) => param.key.startsWith("stroke")),
	).toBe(false);
	const builder = readFileSync(new URL("../index.ts", import.meta.url), "utf8");
	const standalone = readFileSync(
		new URL("../../timeline/element-utils.ts", import.meta.url),
		"utf8",
	);
	expect(builder).toContain(
		"definition.params.filter((param) => param.required !== false)",
	);
	expect(standalone).toContain(
		"const instance = buildDefaultEffectInstance({ effectType });",
	);
	const defaults = Object.fromEntries(
		definitions
			.filter((param) => param.required !== false)
			.map((param) => [param.key, param.default]),
	);
	expect(defaults.strokeCount).toBe(0);
	expect(Object.keys(defaults).some((key) => /^stroke\d/.test(key))).toBe(
		false,
	);
});

test("unchanged Bubble transport retains its existing point behavior", () => {
	const bubble: ParamDefinition[] = ["Time", "X", "Y"].map((axis) => ({
		key: `point1${axis}`,
		label: axis,
		type: "number",
		min: 0,
		step: 1,
		default: 0.5,
	}));
	const params: ParamValues = {
		pointCount: 1,
		point0Time: 0,
		point0X: 0.2,
		point0Y: 0.7,
	};
	const next = appendBubblePoint({ params, definitions: bubble });
	expect(next).toEqual({
		...params,
		pointCount: 2,
		point1Time: 1,
		point1X: 0.2,
		point1Y: 0.7,
	});
	expect(removeBubblePoint({ params: next, index: 1 })).toEqual(params);
});

test("Frost static inputs retain raw text and reuse the shared save retention path", () => {
	const number = readFileSync(
		new URL("../components/frost-number-field.tsx", import.meta.url),
		"utf8",
	);
	expect(number).toContain("supportsExpressions: false");
	expect(number).not.toContain("allowExpressions={false}");
	expect(number).not.toContain("onScrub=");
	expect(number).not.toContain("snapToStep");
	expect(number).not.toContain("clamp");
	const panel = readFileSync(
		new URL("../components/effect-fields.tsx", import.meta.url),
		"utf8",
	);
	expect(panel).toContain("params={displayed}");
	expect(panel).toContain("const error = await saveEffectPreview({");
	expect(panel).toContain("setRetained(error ? attemptedParams : null)");
	expect(panel).toContain(
		"setRetainedAnimations(error ? attemptedAnimations : undefined)",
	);
	expect(panel).toContain("discard: () => editor.timeline.discardPreview()");
});
