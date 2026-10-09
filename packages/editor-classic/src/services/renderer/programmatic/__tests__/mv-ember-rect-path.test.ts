import { expect, test } from "bun:test";
import type { MvEmberPlan } from "@opencut/editor-contracts";
import { emberRasterFixture } from "./mv-ember-recording-fixture";

const fill = {
	kind: "fill",
	style: { kind: "solid", color: [1, 0, 0, 1] },
	composite: "source-over",
	opacity: 0.6,
} as const;

test("native rect path steps retain exact dimensions, path order and a single paint boundary", () => {
	const io = emberRasterFixture();
	io.draw({
		commands: [
			{
				kind: "path",
				transform: [1, 0, 0, 1, 20, 40],
				path: [
					{ kind: "moveTo", point: [10, 20] },
					{ kind: "lineTo", point: [30, 40] },
					{ kind: "rect", rect: [1.25, -2.5, 60.75, 30.5] },
					{ kind: "rect", rect: [7, 8, -4, -6] },
					{ kind: "rect", rect: [3, 4, 0, 5] },
				],
				paints: [fill],
			},
		],
	} satisfies MvEmberPlan);
	expect(
		io.events
			.filter((event) =>
				[
					"beginPath",
					"moveTo",
					"lineTo",
					"rect",
					"closePath",
					"fill",
					"fillRect",
				].includes(event.op),
			)
			.map((event) => [event.op, ...event.args]),
	).toEqual([
		["beginPath"],
		["moveTo", 10, 20],
		["lineTo", 30, 40],
		["rect", 1.25, -2.5, 60.75, 30.5],
		["rect", 7, 8, -4, -6],
		["rect", 3, 4, 0, 5],
		["fill"],
	]);
	expect(io.events.find((event) => event.op === "fill")!.state.steps).toEqual([
		["moveTo", 10, 20],
		["lineTo", 30, 40],
		["rect", 1.25, -2.5, 60.75, 30.5],
		["rect", 7, 8, -4, -6],
		["rect", 3, 4, 0, 5],
	]);
	expect(io.output.ctx.stack).toHaveLength(0);
});

test("rectangle clipping uses ctx.rect in its own transform then restores the caller clip", () => {
	const io = emberRasterFixture();
	io.draw({
		commands: [
			{
				kind: "rect",
				transform: [0.5, 0, 0, 0.75, 2, 3],
				operations: [{ kind: "translate", offset: [10, 20] }],
				rect: [0, 0, 1920, 1080],
				paint: fill,
				clip: {
					transform: [1, 0, 0, 1, 12, 24],
					operations: [{ kind: "rotate", radians: 0.3 }],
					path: [{ kind: "rect", rect: [1.25, 2.5, 720.75, 1080] }],
				},
			},
		],
	} satisfies MvEmberPlan);
	expect(
		io.events
			.filter((event) =>
				["beginPath", "rect", "moveTo", "lineTo", "closePath", "clip"].includes(
					event.op,
				),
			)
			.map((event) => [event.op, ...event.args]),
	).toEqual([
		["beginPath"],
		["rect", 1.25, 2.5, 720.75, 1080],
		["clip", "nonzero"],
	]);
	expect(
		io.events.find((event) => event.op === "fillRect")!.state,
	).toMatchObject({
		transform: [
			["setTransform", 0.5, 0, 0, 0.75, 2, 3],
			["translate", 10, 20],
		],
		clip: {
			rule: "nonzero",
			transform: [
				["setTransform", 1, 0, 0, 1, 12, 24],
				["rotate", 0.3],
			],
			steps: [["rect", 1.25, 2.5, 720.75, 1080]],
		},
	});
	expect(io.output.ctx.state.clip).toEqual([]);
	expect(io.output.ctx.stack).toHaveLength(0);
});
