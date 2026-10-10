import { expect, test } from "bun:test";
import { emberRasterFixture } from "./mv-ember-recording-fixture";

const transform = [1, 0, 0, 1, 0, 0] as const;
const identity = {
	binding: { algorithm: "heart-components-v1" },
	part: { kind: "body" },
	width: 300,
	height: 600,
	rgbaSha256: "a".repeat(64),
};
const prepared = {
	kind: "preparedImage",
	image: identity,
	transform,
	operations: [{ kind: "translate", offset: [13, 17] }],
	clip: null,
	sourceRect: [0, 0, 300, 600],
	destinationRect: [-150, -300, 300, 600],
	composite: "lighter",
	opacity: 0.7,
	smoothing: false,
	smoothingQuality: "low",
};
const shadow = {
	kind: "shadowPath",
	transform,
	operations: [{ kind: "scale", factors: [0.5, 0.5] }],
	clip: null,
	path: [
		{ kind: "moveTo", point: [2, 4] },
		{ kind: "quadraticCurveTo", control: [8, 16], point: [32, 64] },
	],
	paints: [
		{
			kind: "stroke",
			style: { kind: "solid", color: [1, 0.5, 0, 1] },
			width: 3,
			cap: "round",
			join: "round",
			opacity: 0.6,
			composite: "source-over",
		},
	],
	shadow: { color: [1, 0.25, 0, 0.8], blurPx: 4, offset: [0, 0] },
};

test("Heart prepared images use the dedicated owner, exact native crop and CTM", () => {
	const io = emberRasterFixture();
	let requested: unknown;
	Object.assign(io.assets, {
		preparedImage(value: unknown) {
			requested = value;
			return io.picture;
		},
	});
	io.draw({
		commands: [
			{ kind: "surface", id: "heart", size: [300, 600], commands: [prepared] },
		],
	});
	expect(requested).toEqual(identity);
	const event = io.events.find(({ op }) => op === "drawImage");
	expect(event?.target).toBe("canvas1");
	expect(event?.args).toEqual([
		io.picture,
		0,
		0,
		300,
		600,
		-150,
		-300,
		300,
		600,
	]);
	expect(event?.state).toMatchObject({
		globalAlpha: 0.7,
		globalCompositeOperation: "lighter",
		imageSmoothingEnabled: false,
		transform: [
			["setTransform", ...transform],
			["translate", 13, 17],
		],
	});
	expect([io.canvases[1]?.width, io.canvases[1]?.height]).toEqual([1, 1]);
	expect(io.closes()).toBe(0);
});

test("Heart rejects missing or mismatched prepared owners without ordinary-resource fallback", () => {
	for (const mismatch of [false, true]) {
		const io = emberRasterFixture();
		if (mismatch)
			Object.assign(io.assets, {
				preparedImage: () => ({ width: 1, height: 1 }),
			});
		expect(() => io.draw({ commands: [prepared] })).toThrow(
			mismatch ? "dimensions mismatch" : "prepared-image owner",
		);
		expect(io.events.some(({ op }) => op === "drawImage")).toBe(false);
		expect(io.output.ctx.stack).toHaveLength(0);
	}
});

test("Heart replays native quadratic paths and Canvas shadows, not bitmap blur", () => {
	const io = emberRasterFixture();
	io.draw({ commands: [shadow] });
	expect(io.events.find(({ op }) => op === "quadraticCurveTo")?.args).toEqual([
		8, 16, 32, 64,
	]);
	expect(io.events.find(({ op }) => op === "stroke")?.state).toMatchObject({
		shadowBlur: 4,
		shadowColor: "rgba(255,63.75,0,0.8)",
		shadowOffsetX: 0,
		shadowOffsetY: 0,
		filter: "none",
		lineWidth: 3,
		globalAlpha: 0.6,
		transform: [
			["setTransform", ...transform],
			["scale", 0.5, 0.5],
		],
	});
	expect(io.events.some(({ op }) => op === "drawImage")).toBe(false);
	expect(io.output.ctx.stack).toHaveLength(0);
	expect(io.output.ctx.shadowColor).toBeUndefined();
});

test("Heart invalid shadow payloads unwind the iterator and scratch surfaces", () => {
	for (const invalid of [
		{ blurPx: -1 },
		{ blurPx: 17 },
		{ blurPx: NaN },
		{ offset: [0, 1] },
	]) {
		const io = emberRasterFixture();
		expect(() =>
			io.draw({
				commands: [
					{
						kind: "surface",
						id: "shadow",
						size: [64, 64],
						commands: [{ ...shadow, shadow: { ...shadow.shadow, ...invalid } }],
					},
				],
			}),
		).toThrow("Heart shadow primitive");
		expect(io.events.some(({ op }) => op === "stroke")).toBe(false);
		expect([io.canvases[1]?.width, io.canvases[1]?.height]).toEqual([1, 1]);
		expect(io.output.ctx.stack).toHaveLength(0);
	}
});
