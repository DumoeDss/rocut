import { expect, test } from "bun:test";
import {
	admitAnimationTargetChannels,
	admitAnimationsChannel,
} from "../scalar-admission";
import { getParamChannelLayout } from "../../params";
import type { ScalarAnimationChannel } from "../types";

const channel = (value: number): ScalarAnimationChannel => ({
	keys: [
		{ id: "a", time: 0, value, segmentToNext: "linear", tangentMode: "flat" },
	],
});
const target = {
	channelLayout: getParamChannelLayout({
		param: { key: "color", label: "Color", type: "color", default: "#804020" },
	}),
	getBaseValue: () => "#804020",
	// Deliberately different declared component ranges expose first-range routing.
	numericRanges: {
		r: { min: 0, max: 10 },
		g: { min: 0, max: 1 },
		b: { min: 0, max: 1 },
		a: { min: 0, max: 1 },
	},
};
test("bounded composite channels use the selected component and its own range", () => {
	const animations = {
		color: { r: channel(2), g: channel(2), b: channel(0.1), a: channel(1) },
	};
	const before = structuredClone(animations);
	expect(
		admitAnimationsChannel({
			animations,
			propertyPath: "color",
			componentKey: "g",
			fallbackValue: 0.1,
			duration: 100000,
			spec: target.numericRanges.g,
		}).kind,
	).toBe("rejected");
	expect(
		admitAnimationTargetChannels({
			animations,
			propertyPath: "color",
			duration: 100000,
			target,
			componentKey: "r",
		}).map((item) => item.kind),
	).toEqual(["admitted"]);
	expect(
		admitAnimationTargetChannels({
			animations,
			propertyPath: "color",
			duration: 100000,
			target,
			componentKey: "g",
		}).map((item) => item.kind),
	).toEqual(["rejected"]);
	expect(
		admitAnimationTargetChannels({
			animations,
			propertyPath: "color",
			duration: 100000,
			target,
		}).map((item) => [item.componentKey, item.kind]),
	).toEqual([
		["r", "admitted"],
		["g", "rejected"],
		["b", "admitted"],
		["a", "admitted"],
	]);
	expect(animations).toEqual(before);
});
test("composite base values are decomposed instead of Number(color) and three states survive", () => {
	const safe = { color: { g: channel(0.5) } };
	expect(
		admitAnimationTargetChannels({
			animations: safe,
			propertyPath: "color",
			duration: 100000,
			target,
			componentKey: "g",
		})[0].kind,
	).toBe("admitted");
	expect(
		admitAnimationTargetChannels({
			animations: safe,
			propertyPath: "color",
			duration: 0,
			target,
			componentKey: "g",
		})[0].kind,
	).toBe("unresolved");
	expect(
		admitAnimationTargetChannels({
			animations: safe,
			propertyPath: "color",
			duration: 100000,
			target: { ...target, getBaseValue: () => "not a color" },
			componentKey: "g",
		})[0].kind,
	).toBe("unresolved");
	expect(
		admitAnimationTargetChannels({
			animations: safe,
			propertyPath: "color",
			duration: 100000,
			target: { ...target, numericRanges: undefined },
		}).every((item) => item.kind === "admitted"),
	).toBe(true);
	expect(
		admitAnimationTargetChannels({
			animations: undefined,
			propertyPath: "color",
			duration: 100000,
			target: { ...target, getBaseValue: () => "not a color" },
			componentKey: "g",
		})[0].kind,
	).toBe("admitted");
});
