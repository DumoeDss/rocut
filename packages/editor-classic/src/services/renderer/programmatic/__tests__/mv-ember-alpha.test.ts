import { expect, test } from "bun:test";
import type { MvEmberSurfaceDraw } from "@opencut/editor-contracts";
import {
	extendedFixture,
	expectReleased,
	surface,
} from "./mv-ember-extended-fixture";

const alpha = {
	kind: "alphaPixels",
	size: [2, 2],
	alpha: [0, 7, 128, 255],
	position: [-3, 5],
} as const satisfies MvEmberSurfaceDraw;

test("alpha pixels upload white RGB with exact original alpha, independently of paint and transform", () => {
	const value = extendedFixture(),
		{ io } = value;
	io.draw({
		commands: [
			{
				...alpha,
				transform: null,
				clip: { path: null },
				opacity: 0,
				composite: "destination-out",
			},
			{ ...surface("alpha"), commands: [alpha] },
		],
	});
	const pixels = io.events.filter((event) => event.op === "putImageData");
	expect(pixels.map((event) => event.target)).toEqual(["canvas0", "canvas1"]);
	for (const event of pixels)
		expect(event.args).toEqual([
			[
				255, 255, 255, 0, 255, 255, 255, 7, 255, 255, 255, 128, 255, 255, 255,
				255,
			],
			-3,
			5,
		]);
	expect(
		io.events.some((event) => ["setTransform", "clip"].includes(event.op)),
	).toBe(false);
	expectReleased(value);
});

test("invalid alpha byte payloads are rejected before allocation and release all surfaces", () => {
	for (const invalid of [
		{ alpha: [0, 7, 128] },
		{ alpha: [0, 7, 128, 256] },
		{ alpha: [0, 7, 128, -1] },
		{ alpha: [0, 7, 128, 0.5] },
		{ alpha: [0, 7, 128, NaN] },
		{ alpha: null },
		{ size: [0, 2] },
		{ size: [2.5, 2] },
		{ size: [Infinity, 2] },
		{ position: [0.5, 0] },
		{ position: [2147483648, 0] },
	]) {
		const value = extendedFixture();
		expect(() =>
			value.io.draw({
				commands: [
					surface("ready"),
					{ ...surface("bad"), commands: [{ ...alpha, ...invalid }] },
				],
			}),
		).toThrow(
			"Alpha pixels require exact native dimensions, bytes and position",
		);
		expect(
			value.io.events.filter((event) => event.op === "putImageData"),
		).toHaveLength(1);
		expectReleased(value);
	}
});
