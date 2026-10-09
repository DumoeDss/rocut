import { expect, test } from "bun:test";
import type {
	MvEmberCommand,
	MvEmberDraw,
	MvEmberPlan,
} from "@opencut/editor-contracts";
import { emberRasterFixture } from "./mv-ember-recording-fixture";
import {
	extendedFixture,
	expectReleased,
	surface,
} from "./mv-ember-extended-fixture";

const transform = [1, 0, 0, 1, 0, 0] as const;
const stroke = {
	kind: "textStroke",
	transform,
	operations: [{ kind: "translate", offset: [3, 5] }],
	font: "font",
	text: "壊",
	fontSize: 1500,
	tracking: 0,
	position: [105, 1205],
	align: "left",
	baseline: "alphabetic",
	style: { kind: "solid", color: [1, 0.5, 0, 1] },
	width: 60,
	cap: "round",
	join: "round",
	blurPx: 15,
	rasterBounds: [30, 40, 1400, 1600],
	opacity: 0.6,
	composite: "lighter",
} as const satisfies MvEmberDraw;

test("textStroke preserves native font/position/CTM, stroke and blur without fill or layout", () => {
	const value = extendedFixture(),
		{ io } = value;
	io.draw({
		commands: [
			stroke,
			{ ...stroke, width: 24, blurPx: 6 },
			{ ...stroke, width: 7.5, blurPx: 0 },
		],
	} satisfies MvEmberPlan);
	const strokes = io.events.filter((event) => event.op === "strokeText");
	expect(strokes.map((event) => event.args)).toEqual(
		Array(3).fill(["壊", 105, 1205]),
	);
	expect(
		strokes.map((event) => [event.state.lineWidth, event.state.filter]),
	).toEqual([
		[60, "blur(15px)"],
		[24, "blur(6px)"],
		[7.5, "none"],
	]);
	expect(strokes[0]!.state).toMatchObject({
		font: 'italic 500 1500px "Declared Font"',
		letterSpacing: "0px",
		textAlign: "left",
		textBaseline: "alphabetic",
		strokeStyle: "rgba(255,127.5,0,1)",
		lineCap: "round",
		lineJoin: "round",
		globalAlpha: 0.6,
		globalCompositeOperation: "lighter",
		transform: [
			["setTransform", 1, 0, 0, 1, 0, 0],
			["translate", 3, 5],
		],
	});
	expect(io.events.some((event) => event.op === "fillText")).toBe(false);
	expectReleased(value);
});

test("textStroke rejects invalid stroke raster settings and restores caller state", () => {
	for (const invalid of [
		{ width: 0 },
		{ width: NaN },
		{ cap: "invalid" },
		{ join: "invalid" },
		{ blurPx: 17 },
		{ blurPx: -1 },
		{ blurPx: Infinity },
	]) {
		const value = extendedFixture();
		expect(() =>
			value.io.draw({ commands: [{ ...stroke, ...invalid }] }),
		).toThrow("Invalid native text stroke settings");
		expect(value.io.events.some((event) => event.op === "strokeText")).toBe(
			false,
		);
		expectReleased(value);
	}
});

const pattern = {
	kind: "surfacePatternRect",
	surface: "noise",
	transform,
	operations: [
		{ kind: "scale", factors: [0.9, 3] },
		{ kind: "translate", offset: [5, 7] },
	],
	rect: [-5, -7, 1600, 900],
	composite: "source-in",
	opacity: 0.8,
	smoothing: true,
	smoothingQuality: "low",
} as const satisfies MvEmberCommand;

test("named surface pattern repeats natively at original CTM, not as tiled drawImage calls", () => {
	const value = extendedFixture(),
		{ io } = value;
	io.draw({ commands: [surface("noise"), pattern] } satisfies MvEmberPlan);
	const created = io.events.find((event) => event.op === "createPattern")!;
	expect(created.args).toEqual([io.canvases[1], "repeat"]);
	expect(created.state.transform).toEqual([
		["setTransform", 1, 0, 0, 1, 0, 0],
		["scale", 0.9, 3],
		["translate", 5, 7],
	]);
	expect(io.events.find((event) => event.op === "fillRect")!).toMatchObject({
		args: [-5, -7, 1600, 900],
		state: {
			globalCompositeOperation: "source-in",
			globalAlpha: 0.8,
			imageSmoothingEnabled: true,
			imageSmoothingQuality: "low",
		},
	});
	expect(io.events.some((event) => event.op === "drawImage")).toBe(false);
	expectReleased(value);
});

test("patterns reject self, future and released sources and clean up failed creation", () => {
	for (const commands of [
		[pattern],
		[{ ...surface("noise"), commands: [pattern] }],
		[pattern, surface("noise")],
		[surface("noise"), { kind: "releaseSurface", surface: "noise" }, pattern],
	]) {
		const value = extendedFixture();
		expect(() => value.io.draw({ commands })).toThrow(
			"Pattern requires an earlier completed live Ember scratch surface",
		);
		expectReleased(value);
	}
	const io = emberRasterFixture({ noPattern: true });
	expect(() => io.draw({ commands: [surface("noise"), pattern] })).toThrow(
		"Native surface pattern unavailable",
	);
	expect([io.canvases[1]!.width, io.canvases[1]!.height]).toEqual([1, 1]);
	expect(io.output.ctx.stack).toHaveLength(0);
});

test("image sourceRect uses direct nine-argument drawImage without intermediate surfaces", () => {
	const value = extendedFixture(),
		{ io } = value;
	const image = {
		kind: "image",
		image: "image",
		transform,
		sourceRect: [42, 0, 7, 600],
		destinationRect: [-3.25, 9.5, 7, 600],
		opacity: 0.6,
		composite: "source-over",
		smoothing: true,
		smoothingQuality: "low",
	} as const satisfies MvEmberDraw;
	io.draw({
		commands: [image, { ...image, sourceRect: undefined }],
	} satisfies MvEmberPlan);
	expect(
		io.events
			.filter((event) => event.op === "drawImage")
			.map((event) => event.args),
	).toEqual([
		[io.picture, 42, 0, 7, 600, -3.25, 9.5, 7, 600],
		[io.picture, -3.25, 9.5, 7, 600],
	]);
	expect(io.canvases).toHaveLength(1);
	expectReleased(value);
});
