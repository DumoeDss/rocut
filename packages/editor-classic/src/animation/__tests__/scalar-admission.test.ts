import { describe, expect, test } from "bun:test";
import {
	admitAnimationsChannel,
	admitScalarChannel,
} from "../scalar-admission";
import type { ScalarAnimationChannel } from "../types";

const ramp: ScalarAnimationChannel = {
	keys: [
		{
			id: "a",
			time: 0,
			value: 0,
			segmentToNext: "linear",
			tangentMode: "flat",
		},
		{
			id: "b",
			time: 100000,
			value: 1,
			segmentToNext: "linear",
			tangentMode: "flat",
		},
	],
};

describe("admitScalarChannel", () => {
	test("admits channels when no numeric range is declared", () => {
		expect(
			admitScalarChannel({
				channel: ramp,
				fallbackValue: 0.5,
				domain: { start: 0, end: 100000 },
				spec: undefined,
			}),
		).toEqual({ kind: "admitted" });
	});

	test("admits empty channels without a core round-trip", () => {
		expect(
			admitScalarChannel({
				channel: undefined,
				fallbackValue: 0.5,
				domain: { start: 0, end: 100000 },
				spec: { min: 0, max: 1 },
			}),
		).toEqual({ kind: "admitted" });
	});

	test("keeps unresolved distinct from admitted and rejected", () => {
		const result = admitScalarChannel({
			channel: ramp,
			fallbackValue: 0.5,
			domain: { start: 0, end: 0 },
			spec: { min: 0, max: 1 },
		});
		expect(result.kind).toBe("unresolved");
	});

	test("inspects real bounded channels through the installed core", () => {
		const inBounds = admitScalarChannel({
			channel: ramp,
			fallbackValue: 0.5,
			domain: { start: 0, end: 100000 },
			spec: { min: 0, max: 1 },
		});
		expect(inBounds.kind).toBe("admitted");

		const outOfBounds = admitScalarChannel({
			channel: {
				keys: [
					{
						id: "a",
						time: 0,
						value: 0,
						segmentToNext: "linear",
						tangentMode: "flat",
					},
					{
						id: "b",
						time: 100000,
						value: 5,
						segmentToNext: "linear",
						tangentMode: "flat",
					},
				],
			},
			fallbackValue: 0.5,
			domain: { start: 0, end: 100000 },
			spec: { min: 0, max: 1 },
		});
		expect(outOfBounds.kind).toBe("rejected");
	});

	test("constant boundary bezier curves within bounds stay admitted", () => {
		const constant: ScalarAnimationChannel = {
			keys: [
				{
					id: "a",
					time: 0,
					value: 1,
					segmentToNext: "bezier",
					tangentMode: "flat",
					rightHandle: { dt: 40000, dv: 0 },
				},
				{
					id: "b",
					time: 100000,
					value: 1,
					segmentToNext: "linear",
					tangentMode: "flat",
					leftHandle: { dt: -40000, dv: 0 },
				},
			],
		};
		const result = admitScalarChannel({
			channel: constant,
			fallbackValue: 1,
			domain: { start: 0, end: 100000 },
			spec: { min: 0, max: 1 },
		});
		expect(result.kind).toBe("admitted");
	});
});

describe("admitAnimationsChannel", () => {
	test("legacy numeric keys cannot bypass bounded admission", () => {
		const channel = structuredClone(ramp);
		channel.keys[1].value = 5;
		for (const key of channel.keys)
			Reflect.deleteProperty(key, "segmentToNext");
		const before = structuredClone(channel);
		expect(
			admitAnimationsChannel({
				animations: { opacity: channel },
				propertyPath: "opacity",
				fallbackValue: 0,
				duration: 100000,
				spec: { min: 0, max: 1 },
			}).kind,
		).toBe("rejected");
		expect(channel).toEqual(before);
	});

	test("reads channels from element animations by property path", () => {
		const admitted = admitAnimationsChannel({
			animations: { opacity: ramp },
			propertyPath: "opacity",
			fallbackValue: 0.5,
			duration: 100000,
			spec: { min: 0, max: 1 },
		});
		expect(admitted.kind).toBe("admitted");

		const rejected = admitAnimationsChannel({
			animations: {
				"transform.rotate": {
					keys: [
						{
							id: "a",
							time: 0,
							value: 0,
							segmentToNext: "linear",
							tangentMode: "flat",
						},
						{
							id: "b",
							time: 100000,
							value: 720,
							segmentToNext: "linear",
							tangentMode: "flat",
						},
					],
				},
			},
			propertyPath: "transform.rotate",
			fallbackValue: 0,
			duration: 100000,
			spec: { min: -360, max: 360 },
		});
		expect(rejected.kind).toBe("rejected");
	});

	test("admits discrete and missing channels through the fallback", () => {
		expect(
			admitAnimationsChannel({
				animations: { discrete: { keys: [{ id: "d", time: 0, value: "a" }] } },
				propertyPath: "discrete",
				fallbackValue: 0.5,
				duration: 100000,
				spec: { min: 0, max: 1 },
			}).kind,
		).toBe("admitted");
	});
});
