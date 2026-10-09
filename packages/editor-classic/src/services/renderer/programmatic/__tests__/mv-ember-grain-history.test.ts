import { expect, test } from "bun:test";
import type { MvEmberDraw, MvEmberPlan } from "@opencut/editor-contracts";
import { emberRasterFixture } from "./mv-ember-recording-fixture";

type Grain = Extract<MvEmberDraw, { kind: "grain" }>;
const grain: Grain = {
	kind: "grain",
	transform: [1, 0, 0, 1, -145, -92],
	rect: [0, 0, 2176, 1336],
	size: [2, 2],
	gray: [0, 127, 128, 255],
	opacity: 0.1,
};
const history: NonNullable<Grain["fillHistory"]> = {
	transform: [2, 0, 0, 2, 15, 20],
	style: {
		kind: "radial",
		from: [960, 540, 378],
		to: [960, 540, 1134],
		stops: [
			{ offset: 0, color: [0, 0, 0, 0] },
			{ offset: 1, color: [0.2, 0.1, 0.4, 0.45] },
		],
	},
};

test("grain replays declared fill history in its creation CTM before pattern and restores caller state", () => {
	const io = emberRasterFixture();
	io.output.ctx.fillStyle = "caller-brush";
	io.output.ctx.globalAlpha = 0.75;
	io.output.ctx.globalCompositeOperation = "multiply";
	const plan: MvEmberPlan = { commands: [{ ...grain, fillHistory: history }] };
	io.draw(plan);
	const radial = io.events.find(
		(event) => event.op === "createRadialGradient",
	)!;
	const pattern = io.events.find((event) => event.op === "createPattern")!;
	const draw = io.events.find((event) => event.op === "fillRect")!;
	expect(radial.args).toEqual([960, 540, 378, 960, 540, 1134]);
	expect(radial.state.transform).toEqual([
		["setTransform", ...history.transform],
	]);
	expect(pattern.state.transform).toEqual([
		["setTransform", ...grain.transform],
	]);
	expect(pattern.state.fillStyle).toEqual({
		kind: "createRadialGradient",
		stops: [
			[0, "rgba(0,0,0,0)"],
			[1, "rgba(51,25.5,102,0.45)"],
		],
		addColorStop: expect.any(Function),
	});
	expect(io.events.indexOf(radial)).toBeLessThan(io.events.indexOf(pattern));
	expect(io.events.indexOf(pattern)).toBeLessThan(io.events.indexOf(draw));
	expect(draw.state).toMatchObject({
		transform: [["setTransform", ...grain.transform]],
		globalCompositeOperation: "overlay",
		globalAlpha: 0.1,
	});
	expect(draw.args).toEqual(grain.rect);
	expect(io.events.filter((event) => event.op === "fillRect")).toHaveLength(1);
	expect(io.events.filter((event) => event.op === "getTransform")).toHaveLength(
		1,
	);
	expect(io.canvases).toHaveLength(2);
	expect(io.output.ctx.fillStyle).toBe("caller-brush");
	expect(io.output.ctx.globalAlpha).toBe(0.75);
	expect(io.output.ctx.globalCompositeOperation).toBe("multiply");
	expect(io.output.ctx.state.transform).toEqual([]);
	expect(io.output.ctx.stack).toHaveLength(0);
	expect(io.canvases[1]!.width).toBe(1);
});

test("absent grain history keeps old wire, raster operations and allocation behavior", () => {
	const io = emberRasterFixture();
	io.draw({ commands: [grain] } satisfies MvEmberPlan);
	expect(
		io.events.some(
			(event) => event.op.includes("Gradient") || event.op === "getTransform",
		),
	).toBe(false);
	expect(
		io.events
			.filter((event) => event.op === "setTransform")
			.map((event) => event.args),
	).toEqual([grain.transform]);
	expect(
		io.events.find((event) => event.op === "putImageData")!.args[0],
	).toEqual([
		0, 0, 0, 255, 127, 127, 127, 255, 128, 128, 128, 255, 255, 255, 255, 255,
	]);
	expect(io.canvases).toHaveLength(2);
	expect(io.canvases[1]!.width).toBe(1);
});

test("history failure restores the grain CTM and caller state before cleaning allocations", () => {
	const io = emberRasterFixture();
	io.output.ctx.fillStyle = "caller-brush";
	io.output.ctx.createRadialGradient = () => {
		throw Error("fixture gradient failure");
	};
	expect(() =>
		io.draw({ commands: [{ ...grain, fillHistory: history }] }),
	).toThrow("fixture gradient failure");
	const transforms = io.events.filter((event) => event.op === "setTransform");
	expect(transforms.at(-1)!.state.transform).toEqual([
		["setTransform", ...grain.transform],
	]);
	expect(
		io.events.some(
			(event) => event.op === "createPattern" || event.op === "fillRect",
		),
	).toBe(false);
	expect(io.output.ctx.fillStyle).toBe("caller-brush");
	expect(io.output.ctx.stack).toHaveLength(0);
	expect(io.output.ctx.state.transform).toEqual([]);
	expect(io.canvases[1]!.width).toBe(1);
});
