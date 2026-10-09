import { expect, test } from "bun:test";
import type { MvEmberDraw, MvEmberPlan } from "@opencut/editor-contracts";
import { emberRasterFixture } from "./mv-ember-recording-fixture";

const rect = {
	kind: "rect",
	transform: [0.5, 0, 0, 0.75, 2, 3],
	rect: [1.25, -2.5, 60.75, 30.5],
	paint: {
		kind: "stroke",
		style: { kind: "solid", color: [1, 0.5, 0, 0.8] },
		composite: "lighter",
		opacity: 0.375,
		width: 1.25,
		cap: "round",
		join: "miter",
	},
} as const satisfies MvEmberDraw;

test("stroke rectangles call native strokeRect with exact dimensions and preserve the current path and caller state", () => {
	const io = emberRasterFixture();
	io.output.ctx.beginPath();
	io.output.ctx.moveTo(10, 20);
	io.output.ctx.lineTo(30, 40);
	io.output.ctx.lineWidth = 9;
	io.output.ctx.globalAlpha = 0.2;
	const before = io.output.ctx.properties();
	io.events.length = 0;
	io.draw({
		commands: [
			rect,
			{ ...rect, rect: [7, 8, -4, -6] },
			{ ...rect, rect: [3, 4, 0, 5] },
		],
	} satisfies MvEmberPlan);
	const strokes = io.events.filter((event) => event.op === "strokeRect");
	expect(strokes.map((event) => event.args)).toEqual([
		[1.25, -2.5, 60.75, 30.5],
		[7, 8, -4, -6],
		[3, 4, 0, 5],
	]);
	for (const stroke of strokes)
		expect(stroke.state).toMatchObject({
			strokeStyle: "rgba(255,127.5,0,0.8)",
			lineWidth: 1.25,
			lineCap: "round",
			lineJoin: "miter",
			globalAlpha: 0.375,
			globalCompositeOperation: "lighter",
			steps: [
				["moveTo", 10, 20],
				["lineTo", 30, 40],
			],
		});
	expect(
		io.events.some((event) => ["beginPath", "stroke"].includes(event.op)),
	).toBe(false);
	expect(io.output.ctx.properties()).toEqual(before);
	expect(io.output.ctx.stack).toHaveLength(0);
});

test("scratch rectangle strokes retain independent clip and paint CTMs, gradient state and command-atomic stepping", () => {
	const io = emberRasterFixture();
	const steps = io.steps({
		commands: [
			{
				kind: "surface",
				id: "outline",
				size: [64, 64],
				commands: [
					{
						...rect,
						operations: [{ kind: "rotate", radians: 0.3 }],
						clip: {
							transform: [1, 0, 0, 1, 12, 24],
							path: [
								{ kind: "moveTo", point: [0, 0] },
								{ kind: "lineTo", point: [20, 20] },
							],
						},
						paint: {
							...rect.paint,
							cap: "butt",
							join: "round",
							style: {
								kind: "linear",
								from: [0, 0],
								to: [40, 20],
								stops: [
									{ offset: 0, color: [1, 0, 0, 1] },
									{ offset: 1, color: [0, 0, 1, 0] },
								],
							},
						},
					},
				],
			},
		],
	} satisfies MvEmberPlan);
	expect(steps.next().done).toBe(false);
	const stroke = io.events.find((event) => event.op === "strokeRect")!;
	expect(stroke.target).toBe("canvas1");
	expect(stroke.state).toMatchObject({
		transform: [
			["setTransform", 0.5, 0, 0, 0.75, 2, 3],
			["rotate", 0.3],
		],
		clip: {
			rule: "nonzero",
			transform: [["setTransform", 1, 0, 0, 1, 12, 24]],
		},
		strokeStyle: {
			kind: "createLinearGradient",
			stops: [
				[0, "rgba(255,0,0,1)"],
				[1, "rgba(0,0,255,0)"],
			],
		},
		lineCap: "butt",
		lineJoin: "round",
	});
	expect(
		io.events.find((event) => event.op === "createLinearGradient")!.state
			.transform,
	).toEqual(stroke.state.transform);
	expect(io.canvases[1]!.ctx.stack).toHaveLength(0);
	expect(steps.return().done).toBe(true);
	expect([io.canvases[1]!.width, io.canvases[1]!.height]).toEqual([1, 1]);
	expect(io.output.ctx.stack).toHaveLength(0);
});

test("filled rectangles and general path strokes retain their separate Canvas primitives", () => {
	const io = emberRasterFixture();
	io.draw({
		commands: [
			{ ...rect, paint: { ...rect.paint, kind: "fill" } },
			{
				kind: "path",
				transform: rect.transform,
				path: [
					{ kind: "moveTo", point: [0, 0] },
					{ kind: "lineTo", point: [1, 2] },
				],
				paints: [rect.paint],
			},
		],
	} satisfies MvEmberPlan);
	expect(
		io.events
			.filter((event) =>
				["fillRect", "stroke", "strokeRect"].includes(event.op),
			)
			.map((event) => [event.op, ...event.args]),
	).toEqual([["fillRect", 1.25, -2.5, 60.75, 30.5], ["stroke"]]);
});
