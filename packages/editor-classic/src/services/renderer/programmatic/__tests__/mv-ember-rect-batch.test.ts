import { expect, test } from "bun:test";
import type { MvEmberDraw, MvEmberPlan } from "@opencut/editor-contracts";
import { extendedFixture, expectReleased } from "./mv-ember-extended-fixture";

const batch = {
	kind: "rectBatch",
	transform: [1, 0, 0, 1, 105, 105],
	rects: [
		[0.25, 2.75, 1, 1],
		[3, 4, -5, 6],
		[7, 8, 0, 9],
	],
	paint: {
		kind: "fill",
		style: { kind: "solid", color: [0, 0, 0, 0.35] },
		composite: "destination-out",
		opacity: 1,
	},
} as const satisfies MvEmberDraw;

test("rectangle batches keep every independent ordered fillRect and original destination-out paint", () => {
	const value = extendedFixture(),
		{ io } = value;
	io.draw({ commands: [batch] } satisfies MvEmberPlan);
	const fills = io.events.filter((event) => event.op === "fillRect");
	expect(fills.map((event) => event.args)).toEqual(
		batch.rects.map((rect) => [...rect]),
	);
	for (const fill of fills)
		expect(fill.state).toMatchObject({
			fillStyle: "rgba(0,0,0,0.35)",
			globalAlpha: 1,
			globalCompositeOperation: "destination-out",
			transform: [["setTransform", 1, 0, 0, 1, 105, 105]],
		});
	expect(
		io.events.some((event) =>
			["beginPath", "rect", "fill", "strokeRect"].includes(event.op),
		),
	).toBe(false);
	expectReleased(value);
});

test("full 2600-rect batch is one atomic transport command but never one draw", () => {
	const value = extendedFixture(),
		{ io } = value;
	const rects = Array.from(
		{ length: 2600 },
		(_, index) => [index / 10, index / 7, 1, 1] as const,
	);
	const steps = io.steps({
		commands: [{ ...batch, rects }],
	} satisfies MvEmberPlan);
	expect(steps.next().done).toBe(false);
	expect(
		io.events
			.filter((event) => event.op === "fillRect")
			.map((event) => event.args),
	).toEqual(rects);
	expect(steps.return().done).toBe(true);
	expectReleased(value);
});

test("rectangle batch refuses stroke-paint substitutions", () => {
	const value = extendedFixture();
	expect(() =>
		value.io.draw({
			commands: [{ ...batch, paint: { ...batch.paint, kind: "stroke" } }],
		}),
	).toThrow("Native rectangle batches require fill paint");
	expect(value.io.events.some((event) => event.op === "fillRect")).toBe(false);
	expectReleased(value);
});
