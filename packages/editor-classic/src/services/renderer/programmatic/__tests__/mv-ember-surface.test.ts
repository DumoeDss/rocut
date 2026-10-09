import { expect, test } from "bun:test";
import type {
	MvEmberCommand,
	MvEmberDraw,
	MvEmberPlan,
} from "@opencut/editor-contracts";
import { emberRasterFixture } from "./mv-ember-recording-fixture";

const transform = [1, 0, 0, 1, 0, 0] as const;
const rect = [0, 0, 32, 32] as const;
const blit = (surface: string): MvEmberCommand & { kind: "blit" } => ({
	kind: "blit",
	surface,
	transform,
	sourceRect: rect,
	destinationRect: rect,
	composite: "source-over",
	opacity: 1,
});
const text: MvEmberDraw = {
	kind: "text",
	transform,
	font: "font",
	text: "AV𠮷",
	fontSize: 1000,
	tracking: -1.25,
	position: [10, 20],
	opacity: 0.7,
	composite: "source-over",
	align: "center",
	baseline: "alphabetic",
	style: {
		kind: "linear",
		from: [0, -800],
		to: [0, 100],
		stops: [
			{ offset: 0, color: [1, 0, 0, 1] },
			{ offset: 1, color: [0, 0, 1, 1] },
		],
	},
};
const plan: MvEmberPlan = {
	commands: [
		{ kind: "surface", id: "glyph", size: [32, 32], commands: [text] },
		{
			kind: "surface",
			id: "masked",
			size: [32, 32],
			commands: [
				blit("glyph"),
				{ ...blit("glyph"), composite: "destination-in", opacity: 0.5 },
			],
		},
		{
			kind: "surface",
			id: "paper",
			size: [32, 32],
			commands: [blit("masked"), { ...blit("glyph"), composite: "soft-light" }],
		},
		blit("paper"),
		{ ...blit("paper"), composite: "difference" },
	],
};

test("ordered multi-level surfaces reuse completed pixels without redrawing their graph", () => {
	const io = emberRasterFixture();
	io.draw(plan);
	expect(io.events.filter((e) => e.op === "fillText")).toHaveLength(1);
	const draws = io.events.filter((e) => e.op === "drawImage");
	expect(draws.map((e) => e.target)).toEqual([
		"canvas2",
		"canvas2",
		"canvas3",
		"canvas3",
		"canvas0",
		"canvas0",
	]);
	expect(draws.map((e) => e.state.globalCompositeOperation)).toEqual([
		"source-over",
		"destination-in",
		"source-over",
		"soft-light",
		"source-over",
		"difference",
	]);
	expect(draws.map((e) => e.args[0])).toEqual([
		io.canvases[1],
		io.canvases[1],
		io.canvases[2],
		io.canvases[1],
		io.canvases[3],
		io.canvases[3],
	]);
	expect(io.canvases).toHaveLength(4);
	for (const canvas of io.canvases.slice(1))
		expect([canvas.width, canvas.height]).toEqual([1, 1]);
	expect(io.output.ctx.stack).toHaveLength(0);
	expect(io.closes()).toBe(0);
});

test("gradient glyphs preserve native transform, actual size, tracking and baseline", () => {
	const io = emberRasterFixture();
	io.draw({
		commands: [
			{ ...text, operations: [{ kind: "translate", offset: [2, 3] }] },
		],
	});
	const gradient = io.events.find((e) => e.op === "createLinearGradient")!;
	expect(gradient.args).toEqual([0, -800, 0, 100]);
	expect(gradient.state.transform).toEqual([
		["setTransform", ...transform],
		["translate", 2, 3],
	]);
	const glyph = io.events.find((e) => e.op === "fillText")!;
	expect(glyph.args).toEqual(["AV𠮷", 10, 20]);
	expect(glyph.state).toMatchObject({
		font: 'italic 500 1000px "Declared Font"',
		textAlign: "center",
		textBaseline: "alphabetic",
		letterSpacing: "-1.25px",
		globalAlpha: 0.7,
		fillStyle: {
			kind: "createLinearGradient",
			stops: [
				[0, "rgba(255,0,0,1)"],
				[1, "rgba(0,0,255,1)"],
			],
		},
	});
});

test("a self/future read fails and releases every allocated surface, then a later frame succeeds", () => {
	for (const id of ["self", "future"]) {
		const io = emberRasterFixture();
		expect(() =>
			io.draw({
				commands: [
					{ kind: "surface", id: "self", size: [32, 32], commands: [blit(id)] },
					{ kind: "surface", id: "future", size: [32, 32], commands: [] },
				],
			}),
		).toThrow("earlier scratch");
		for (const canvas of io.canvases.slice(1))
			expect([canvas.width, canvas.height]).toEqual([1, 1]);
		expect(io.output.ctx.stack).toHaveLength(0);
		io.draw(plan);
		expect(io.events.filter((e) => e.op === "fillText")).toHaveLength(1);
	}
});
