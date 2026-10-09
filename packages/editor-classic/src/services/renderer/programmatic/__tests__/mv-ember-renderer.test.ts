import { expect, test } from "bun:test";
import type {
	MvConvergePaint,
	MvConvergeTransform,
	MvEmberCommand,
	MvEmberDraw,
	MvEmberPlan,
} from "@opencut/editor-contracts";
import { emberRasterFixture } from "./mv-ember-recording-fixture";

const identity: MvConvergeTransform = [1, 0, 0, 1, 0, 0];
const fill: MvConvergePaint & { kind: "fill" } = {
	kind: "fill",
	style: { kind: "solid", color: [1, 0.5, 0, 1] },
	composite: "lighter",
	opacity: 0.75,
};
const rect: MvEmberDraw = {
	kind: "rect",
	transform: identity,
	rect: [0, 0, 20, 40],
	paint: fill,
};
const text: MvEmberDraw = {
	kind: "text",
	transform: identity,
	font: "font",
	text: "𠮷ÁV",
	fontSize: 22,
	tracking: 1.25,
	position: [96, 972],
	color: [1, 1, 1, 1],
	opacity: 0.8,
	composite: "source-over",
	align: "left",
	baseline: "alphabetic",
};
const image: MvEmberDraw = {
	kind: "image",
	transform: identity,
	image: "image",
	destinationRect: [-960, -1920, 1920, 3840],
	composite: "source-over",
	opacity: 1,
	smoothing: true,
	smoothingQuality: "high",
};
const surface: MvEmberCommand = {
	kind: "surface",
	id: "heat",
	size: [1600, 900],
	commands: [rect],
};
const blit: MvEmberCommand = {
	kind: "blit",
	surface: "heat",
	transform: identity,
	sourceRect: [0, 0, 1600, 4],
	destinationRect: [110.25, 20, 1600, 4],
	composite: "lighter",
	opacity: 1,
};

test("native transforms precede gradients; batched strokes reuse one path", () => {
	const io = emberRasterFixture();
	const stroke: MvConvergePaint = {
		kind: "stroke",
		style: {
			kind: "radial",
			from: [0, 0, 0],
			to: [0, 0, 100],
			stops: [
				{ offset: 0, color: [1, 1, 1, 1] },
				{ offset: 1, color: [1, 0, 0, 0] },
			],
		},
		composite: "lighter",
		opacity: 0.6,
		width: 7,
		cap: "round",
		join: "round",
	};
	io.draw({
		commands: [
			{
				kind: "path",
				transform: [0.5, 0, 0, 0.5, 0, 0],
				operations: [
					{ kind: "translate", offset: [960, 540] },
					{ kind: "rotate", radians: 0.51 },
					{ kind: "scale", factors: [1.1, 0.7] },
				],
				path: [
					{ kind: "moveTo", point: [0, 0] },
					{ kind: "lineTo", point: [1, 1] },
					{ kind: "close" },
				],
				paints: [stroke, { ...stroke, width: 2.2 }, fill],
			},
		],
	} satisfies MvEmberPlan);
	const paints = io.events.filter((e) => ["stroke", "fill"].includes(e.op));
	expect(paints).toHaveLength(3);
	expect(new Set(paints.map((e) => e.state.path)).size).toBe(1);
	expect(paints.map((e) => e.state.globalCompositeOperation)).toEqual([
		"lighter",
		"lighter",
		"lighter",
	]);
	expect(
		io.events.find((e) => e.op === "createRadialGradient")!.state.transform,
	).toEqual([
		["setTransform", 0.5, 0, 0, 0.5, 0, 0],
		["translate", 960, 540],
		["rotate", 0.51],
		["scale", 1.1, 0.7],
	]);
	expect(io.output.ctx.stack).toHaveLength(0);
});

test("annular clip and image retain independent CTMs and full native cover transform chain", () => {
	const io = emberRasterFixture();
	const clip = {
		transform: identity,
		path: [
			{
				kind: "arc" as const,
				center: [960, 540] as const,
				radius: 200,
				start: 0,
				end: 6.283185307179586,
			},
			{
				kind: "arc" as const,
				center: [960, 540] as const,
				radius: 100,
				start: 0,
				end: 6.283185307179586,
				anticlockwise: true,
			},
		],
	};
	io.draw({
		commands: [
			{
				...image,
				clip,
				operations: [
					{ kind: "translate", offset: [960, 540] },
					{ kind: "rotate", radians: 0.7 },
					{ kind: "scale", factors: [0.8, 0.8] },
					{ kind: "translate", offset: [-1160, -580] },
					{ kind: "translate", offset: [960, 540] },
				],
			},
			rect,
		],
	} satisfies MvEmberPlan);
	const draw = io.events.find((e) => e.op === "drawImage")!;
	expect(
		io.events.filter((e) => e.op === "arc").map((e) => e.args.at(-1)),
	).toEqual([false, true]);
	expect(draw.state.clip).toMatchObject({
		rule: "nonzero",
		transform: [["setTransform", ...identity]],
	});
	expect(draw.state.transform).toEqual([
		["setTransform", ...identity],
		["translate", 960, 540],
		["rotate", 0.7],
		["scale", 0.8, 0.8],
		["translate", -1160, -580],
		["translate", 960, 540],
	]);
	expect(draw.args).toEqual([io.picture, -960, -1920, 1920, 3840]);
	expect(draw.state.imageSmoothingQuality).toBe("high");
	expect(io.events.find((e) => e.op === "fillRect")!.state.clip).toEqual([]);
	expect(io.closes()).toBe(0);
});

test("shimmer replays exactly supplied 1600x900 scratch and 225 four-pixel strip blits", () => {
	const io = emberRasterFixture();
	const strips: MvEmberCommand[] = Array.from({ length: 225 }, (_, index) => ({
		...blit,
		sourceRect: [0, index * 4, 1600, 4],
		destinationRect: [index / 17, 20 + index * 4, 1600, 4],
	}));
	io.draw({ commands: [surface, ...strips] } satisfies MvEmberPlan);
	expect(io.canvases.map((c) => c.initial)).toEqual([
		[1920, 1080],
		[1600, 900],
	]);
	const draws = io.events.filter((e) => e.op === "drawImage");
	expect(draws).toHaveLength(225);
	for (const [index, event] of draws.entries()) {
		expect(event.args).toEqual([
			io.canvases[1],
			0,
			index * 4,
			1600,
			4,
			index / 17,
			20 + index * 4,
			1600,
			4,
		]);
		expect(event.state.globalCompositeOperation).toBe("lighter");
	}
	expect(io.canvases[1]!.width).toBe(1);
	expect(io.canvases[1]!.height).toBe(1);
});

test("HUD uses declared face and precomputed placement without measureText or formula evaluation", () => {
	const io = emberRasterFixture();
	io.draw({
		commands: [text, { ...text, text: "", tracking: 0 }],
	} satisfies MvEmberPlan);
	const draws = io.events.filter((e) => e.op === "fillText");
	expect(draws.map((e) => e.args)).toEqual([
		["𠮷ÁV", 96, 972],
		["", 96, 972],
	]);
	expect(draws[0]!.state).toMatchObject({
		font: 'italic 500 22px "Declared Font"',
		letterSpacing: "1.25px",
		textAlign: "left",
		textBaseline: "alphabetic",
		direction: "ltr",
		fontKerning: "auto",
		wordSpacing: "0px",
		globalAlpha: 0.8,
	});
	expect(io.canvases).toHaveLength(1);
});

test("grain uploads exact Rust bytes and paints overlay at the supplied pixel-identity offset", () => {
	const io = emberRasterFixture();
	io.draw({
		commands: [
			{
				kind: "grain",
				transform: [1, 0, 0, 1, -12, -24],
				size: [2, 2],
				gray: [0, 127, 128, 255],
				opacity: 0.06,
				rect: [12, 24, 1920, 1080],
			},
		],
	} satisfies MvEmberPlan);
	expect(io.events.find((e) => e.op === "putImageData")!.args[0]).toEqual([
		0, 0, 0, 255, 127, 127, 127, 255, 128, 128, 128, 255, 255, 255, 255, 255,
	]);
	expect(io.events.find((e) => e.op === "fillRect")!.state).toMatchObject({
		globalCompositeOperation: "overlay",
		globalAlpha: 0.06,
		transform: [["setTransform", 1, 0, 0, 1, -12, -24]],
	});
	expect(io.canvases[1]!.initial).toEqual([2, 2]);
	expect(io.canvases[1]!.width).toBe(1);
});

test("clip burn gradients and reversed ellipses use supplied state; scratch never survives a frame", () => {
	const io = emberRasterFixture();
	const command: MvEmberDraw = {
		kind: "path",
		transform: identity,
		clip: {
			transform: [0.5, 0, 0, 0.5, 0, 0],
			path: [
				{ kind: "arc", center: [960, 540], radius: 30, start: 0, end: 6.28 },
			],
		},
		operations: [{ kind: "translate", offset: [15, 20] }],
		path: [
			{
				kind: "ellipse",
				center: [1, 2],
				radii: [3, 4],
				rotation: 0.1,
				start: 0.2,
				end: 0.3,
				anticlockwise: true,
			},
		],
		paints: [
			{
				...fill,
				style: {
					kind: "linear",
					from: [0, 0],
					to: [10, 20],
					stops: [
						{ offset: 0, color: [1, 0, 0, 1] },
						{ offset: 1, color: [0, 1, 0, 0] },
					],
				},
			},
		],
	};
	io.draw({ commands: [command, surface, blit] } satisfies MvEmberPlan);
	expect(io.events.find((e) => e.op === "ellipse")!.args).toEqual([
		1,
		2,
		3,
		4,
		0.1,
		0.2,
		0.3,
		true,
	]);
	expect(
		io.events.find((e) => e.op === "createLinearGradient")!.state,
	).toMatchObject({
		transform: [
			["setTransform", ...identity],
			["translate", 15, 20],
		],
		clip: {
			rule: "nonzero",
			transform: [["setTransform", 0.5, 0, 0, 0.5, 0, 0]],
		},
	});
	expect(() => io.draw({ commands: [blit] })).toThrow("earlier scratch");
	io.draw({ commands: [surface, blit] } satisfies MvEmberPlan);
	expect(io.canvases).toHaveLength(3);
	for (const canvas of io.canvases.slice(1))
		expect([canvas.width, canvas.height]).toEqual([1, 1]);
});

test("success, missing resources, forbidden scratch references and raster failures clean up", () => {
	const bad = [
		{ commands: [blit] },
		{ commands: [surface, surface] },
		{ commands: [{ ...surface, commands: [surface] }] },
		{ commands: [{ ...surface, commands: [blit] }] },
		{ commands: [surface, { ...text, font: "image" }] },
		{ commands: [surface, { ...image, image: "font" }] },
	];
	for (const plan of bad) {
		const io = emberRasterFixture();
		expect(() => io.draw(plan)).toThrow();
		expect(io.output.ctx.stack).toHaveLength(0);
		for (const canvas of io.canvases.slice(1))
			expect([canvas.width, canvas.height]).toEqual([1, 1]);
		expect(io.closes()).toBe(0);
	}
	for (const options of [{ noContext: 1 }, { drawError: true }]) {
		const io = emberRasterFixture(options);
		expect(() => io.draw({ commands: [surface, blit] })).toThrow();
		expect([io.canvases[1]!.width, io.canvases[1]!.height]).toEqual([1, 1]);
		expect(io.output.ctx.stack).toHaveLength(0);
	}
	const io = emberRasterFixture({ noPattern: true });
	expect(() =>
		io.draw({
			commands: [
				{
					kind: "grain",
					transform: identity,
					size: [1, 1],
					gray: [123],
					opacity: 1,
					rect: [0, 0, 1, 1],
				},
			],
		}),
	).toThrow();
	expect([io.canvases[1]!.width, io.canvases[1]!.height]).toEqual([1, 1]);
});

test("real recipe dispatch renders Ember only in its role and releases every layer/scratch", () => {
	const io = emberRasterFixture();
	io.render({
		version: 1,
		songSeconds: 3,
		outputRoles: ["background", "foreground"],
		post: [],
		root: {
			kind: "ember",
			role: "foreground",
			data: { commands: [surface, blit, text] },
		},
	});
	expect(io.events.filter((e) => e.op === "fillText")).toHaveLength(1);
	expect(io.events.filter((e) => e.op === "drawImage")).toHaveLength(3);
	expect(io.canvases).toHaveLength(4);
	for (const canvas of io.canvases.slice(1))
		expect([canvas.width, canvas.height]).toEqual([1, 1]);
	expect([io.output.width, io.output.height]).toEqual([1920, 1080]);
});
