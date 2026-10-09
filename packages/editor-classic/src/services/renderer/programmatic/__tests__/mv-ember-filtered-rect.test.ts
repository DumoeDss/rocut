import { expect, test } from "bun:test";
import type { MvEmberDraw, MvEmberPlan } from "@opencut/editor-contracts";
import { emberRasterFixture } from "./mv-ember-recording-fixture";

const command = {
	kind: "filteredRect",
	transform: [1, 0, 0, 1, 0, 0],
	operations: [],
	clip: null,
	rect: [22, 20, 20, 472],
	blurPx: 10,
	paint: {
		kind: "fill",
		composite: "source-over",
		opacity: 1,
		style: {
			kind: "linear",
			from: [0, 0],
			to: [0, 512],
			stops: [
				{ offset: 0, color: [1, 1, 1, 0] },
				{ offset: 0.18, color: [1, 1, 1, 1] },
				{ offset: 1, color: [1, 1, 1, 0] },
			],
		},
	},
} as const satisfies MvEmberDraw;

test("filtered rectangle directly fills under the native filter and preserves path/caller state", () => {
	const io = emberRasterFixture();
	io.output.ctx.beginPath();
	io.output.ctx.moveTo(10, 20);
	io.output.ctx.filter = "blur(3px)";
	io.output.ctx.globalAlpha = 0.25;
	const before = io.output.ctx.properties();
	io.events.length = 0;
	io.draw({ commands: [command, { ...command, blurPx: 0 }] });
	const fills = io.events.filter((event) => event.op === "fillRect");
	expect(fills).toHaveLength(2);
	expect(fills.map((event) => event.state.filter)).toEqual([
		"blur(10px)",
		"none",
	]);
	for (const event of fills) {
		expect(event.args).toEqual([22, 20, 20, 472]);
		expect(event.state).toMatchObject({
			transform: [["setTransform", 1, 0, 0, 1, 0, 0]],
			globalCompositeOperation: "source-over",
			globalAlpha: 1,
			steps: [["moveTo", 10, 20]],
			fillStyle: {
				kind: "createLinearGradient",
				stops: [
					[0, "rgba(255,255,255,0)"],
					[0.18, "rgba(255,255,255,1)"],
					[1, "rgba(255,255,255,0)"],
				],
			},
		});
	}
	expect(
		io.events.filter((event) =>
			["drawImage", "clearRect", "beginPath"].includes(event.op),
		),
	).toHaveLength(0);
	expect(io.canvases).toHaveLength(1);
	expect(io.output.ctx.properties()).toEqual(before);
	expect(io.output.ctx.stack).toHaveLength(0);
});

test("unsupported filtered-rectangle space/settings fail before drawing and restore state", () => {
	for (const patch of [
		{ transform: [1, 0, 0, 1, 1, 0] },
		{ operations: [{ kind: "copyTransform" }] },
		{ clip: { transform: [1, 0, 0, 1, 0, 0], path: [] } },
		{ blurPx: -1 },
		{ blurPx: 17 },
		{ blurPx: Number.NaN },
		{ rect: [0, 0, 8193, 5] },
		{ rect: [0, Number.POSITIVE_INFINITY, 1, 1] },
		{ paint: { ...command.paint, kind: "stroke" } },
		{ paint: { ...command.paint, composite: "copy" } },
		{ paint: { ...command.paint, opacity: 2 } },
	]) {
		const io = emberRasterFixture();
		const before = io.output.ctx.properties();
		const invalid: MvEmberPlan = { commands: [{ ...command }] };
		Object.assign(invalid.commands[0]!, patch);
		expect(() => io.draw(invalid)).toThrow(
			"Invalid native identity filtered fillRect",
		);
		expect(
			io.events.some((event) =>
				["fillRect", "drawImage", "clip"].includes(event.op),
			),
		).toBe(false);
		expect(io.output.ctx.properties()).toEqual(before);
		expect(io.output.ctx.stack).toHaveLength(0);
	}
});

test("filtered rectangle is an atomic cancellable scratch draw", () => {
	const io = emberRasterFixture();
	const steps = io.steps({
		commands: [
			{ kind: "surface", id: "streak", size: [64, 512], commands: [command] },
		],
	});
	expect(steps.next().done).toBe(false);
	expect(io.events.filter((event) => event.op === "fillRect")).toHaveLength(1);
	expect(io.canvases[1]!.ctx.stack).toHaveLength(0);
	expect(steps.return().done).toBe(true);
	expect([io.canvases[1]!.width, io.canvases[1]!.height]).toEqual([1, 1]);
	expect(io.output.ctx.stack).toHaveLength(0);
});
