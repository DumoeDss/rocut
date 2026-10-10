import { expect, test } from "bun:test";
import type { MvGradientRect, MvRecipePlan } from "@opencut/editor-contracts";
import { MV_EMBER_RASTER_SOURCE } from "../mv-ember-raster";
import { extendedFixture, expectReleased } from "./mv-ember-extended-fixture";

const gradient = {
	kind: "gradientRect",
	transform: [1, 0, 0, 1, 10, 20],
	operations: [{ kind: "scale", factors: [0.5, 0.5] }],
	styleTransform: [1, 0, 0, 1, 100, 200],
	styleOperations: [{ kind: "translate", offset: [3, 4] }],
	rect: [0, 0, 1920, 1080],
	paint: {
		kind: "fill",
		composite: "source-over",
		opacity: 0.9,
		style: {
			kind: "linear",
			from: [0, 0],
			to: [1920, 1080],
			stops: [{ offset: 0, color: [0.1, 0.2, 0.3, 1] }],
		},
	},
} as const satisfies MvGradientRect;

test("production Ink role dispatch creates the brush in its CTM and fills in the unchanged draw CTM", () => {
	const value = extendedFixture();
	const plan = {
		version: 1,
		songSeconds: 1,
		outputRoles: ["graphics"],
		root: { kind: "ink", role: "graphics", data: { commands: [gradient] } },
		post: [],
	} as const satisfies MvRecipePlan;
	value.io.render(plan);
	const created = value.io.events.filter(
		(event) => event.op === "createLinearGradient",
	);
	const fills = value.io.events.filter((event) => event.op === "fillRect");
	expect(created).toHaveLength(1);
	expect(fills).toHaveLength(1);
	expect(created[0]!.state.transform).toEqual([
		["setTransform", 1, 0, 0, 1, 100, 200],
		["translate", 3, 4],
	]);
	expect(fills[0]!.state.transform).toEqual([
		["setTransform", 1, 0, 0, 1, 10, 20],
		["scale", 0.5, 0.5],
	]);
	expect(fills[0]!.args).toEqual([0, 0, 1920, 1080]);
	expect(value.io.events.some((event) => event.op === "getTransform")).toBe(
		false,
	);
	expectReleased(value);
});

test("production transform dispatcher preserves the scaled-copy native read boundary", () => {
	const events: unknown[] = [];
	const apply: (context: object, command: object) => void = new Function(
		`${MV_EMBER_RASTER_SOURCE}; return mvEmberTransform;`,
	)();
	apply(
		{
			setTransform: (...args: number[]) => events.push(["set", ...args]),
			getTransform: () => {
				events.push("read");
				return { a: 1.2, b: 0.4, c: -0.6, d: 1.4, e: -120, f: 36 };
			},
		},
		{
			transform: [1, 0, 0, 1, 0, 0],
			operations: [
				{ kind: "copyScaledTransform", scale: 0.25, offset: [60, 60] },
			],
		},
	);
	expect(events).toEqual([
		["set", 1, 0, 0, 1, 0, 0],
		"read",
		["set", 0.3, 0.1, -0.15, 0.35, -15, 24],
	]);
});
