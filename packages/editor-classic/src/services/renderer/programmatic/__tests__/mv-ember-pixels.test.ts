import { expect, test } from "bun:test";
import {
	blit,
	extendedFixture,
	expectReleased,
	grayPixels,
	surface,
} from "./mv-ember-extended-fixture";

test("gray pixels replay exact opaque RGBA and native coordinates in root and scratch", () => {
	const value = extendedFixture(),
		{ io } = value;
	io.draw({ commands: [grayPixels, surface("pixels"), blit("pixels")] });
	const pixels = io.events.filter((event) => event.op === "putImageData");
	expect(pixels.map((event) => event.target)).toEqual(["canvas0", "canvas1"]);
	for (const event of pixels)
		expect(event.args).toEqual([
			[0, 0, 0, 255, 7, 7, 7, 255, 128, 128, 128, 255, 255, 255, 255, 255],
			-3,
			5,
		]);
	expectReleased(value);
});

test("gray pixels never replay supplied transform, clip, operations, or paint fields", () => {
	const value = extendedFixture(),
		{ io } = value;
	io.draw({
		commands: [
			{
				...grayPixels,
				transform: null,
				clip: { path: null },
				operations: [{ kind: "unsupported" }],
				paint: { kind: "unsupported" },
				opacity: 0,
				composite: "destination-out",
			},
		],
	});
	expect(io.events.filter((event) => event.op === "putImageData")).toHaveLength(
		1,
	);
	expect(io.events.map((event) => event.op)).toEqual([
		"save",
		"setLineDash",
		"save",
		"putImageData",
		"restore",
		"restore",
	]);
	expectReleased(value);
});

test("gray pixel transport rejects malformed native dimensions, bytes and coordinates before allocation", () => {
	const malformed: Record<string, unknown>[] = [
		...[
			[0, 2],
			[-1, 2],
			[1.5, 2],
			[NaN, 2],
			[Infinity, 2],
			[4294967296, 2],
			[4294967295, 4294967295],
			[2],
			[2, 2, 1],
			null,
		].map((size) => ({ size })),
		...[
			[0],
			[0, 7, 128, 255, 0],
			[0, 7, 128, -1],
			[0, 7, 128, 256],
			[0, 7, 128, 1.2],
			[0, 7, 128, NaN],
			[0, 7, 128, "255"],
			null,
		].map((gray) => ({ gray })),
		...[
			[0],
			[0, 1, 2],
			[0.5, 0],
			[-2147483649, 0],
			[2147483648, 0],
			[NaN, 0],
			[Infinity, 0],
			["0", 0],
			null,
		].map((position) => ({ position })),
	];
	for (const invalid of malformed) {
		const value = extendedFixture(),
			{ io } = value;
		io.output.ctx.createImageData = () => {
			throw Error("unexpected allocation");
		};
		// Capture the deliberate fixture override as caller-owned state.
		value.initial = io.output.ctx.properties();
		expect(() =>
			io.draw({ commands: [{ ...grayPixels, ...invalid }] }),
		).toThrow(
			"Gray pixels require exact native dimensions, bytes and position",
		);
		expect(
			io.events.filter((event) => event.op === "putImageData"),
		).toHaveLength(0);
		expectReleased(value);
	}
});

test("invalid gray pixels in a scratch release all earlier and incomplete surfaces", () => {
	const value = extendedFixture(),
		{ io } = value;
	expect(() =>
		io.draw({
			commands: [
				surface("ready"),
				{
					...surface("bad"),
					commands: [{ ...grayPixels, gray: [300, 7, 128, 255] }],
				},
			],
		}),
	).toThrow("Gray pixels require");
	expect(io.canvases).toHaveLength(3);
	expectReleased(value);
});

test("gray pixels support signed native coordinate endpoints without reinterpretation", () => {
	const value = extendedFixture(),
		{ io } = value;
	io.draw({
		commands: [{ ...grayPixels, position: [-2147483648, 2147483647] }],
	});
	expect(
		io.events.find((event) => event.op === "putImageData")!.args.slice(1),
	).toEqual([-2147483648, 2147483647]);
	expectReleased(value);
});
