import { expect, test } from "bun:test";
import {
	blit,
	extendedFixture,
	expectReleased,
	surface,
} from "./mv-ember-extended-fixture";

test("typed blit raster settings apply only to that command, including clipped blur", () => {
	const value = extendedFixture(),
		{ io } = value;
	io.draw({
		commands: [
			surface("source"),
			{
				...blit("source"),
				clip: {
					transform: [1, 0, 0, 1, 2, 3],
					path: [
						{ kind: "moveTo", point: [0, 0] },
						{ kind: "lineTo", point: [4, 5] },
					],
				},
				raster: { blurPx: 2.75, smoothing: false, smoothingQuality: "high" },
			},
			blit("source"),
			{
				...blit("source"),
				raster: { blurPx: 0, smoothing: true, smoothingQuality: "medium" },
			},
		],
	});
	const draws = io.events.filter((event) => event.op === "drawImage");
	expect(
		draws.map((event) => [
			event.state.filter,
			event.state.imageSmoothingEnabled,
			event.state.imageSmoothingQuality,
		]),
	).toEqual([
		["blur(2.75px)", false, "high"],
		["none", true, "low"],
		["none", true, "medium"],
	]);
	expect(draws[0]!.state.clip).toEqual({
		rule: "nonzero",
		transform: [["setTransform", 1, 0, 0, 1, 2, 3]],
		steps: [
			["moveTo", 0, 0],
			["lineTo", 4, 5],
		],
	});
	expect(draws[1]!.state.clip).toEqual([]);
	for (const event of draws) {
		expect(event.state.globalAlpha).toBe(0.7);
		expect(event.state.globalCompositeOperation).toBe("source-over");
		expect(event.args.slice(1)).toEqual([0, 0, 8, 9, 10, 20, 8, 9]);
	}
	expectReleased(value);
});

test("malformed typed blit raster settings never draw or leak private surfaces", () => {
	const valid = { blurPx: 2, smoothing: true, smoothingQuality: "high" };
	const invalid = [
		...[-1, 32.01, NaN, Infinity, "14", null].map((contrast) => ({
			...valid,
			contrast,
		})),
		...[-1, 16.01, NaN, Infinity, "2", undefined].map((blurPx) => ({
			...valid,
			blurPx,
		})),
		...[0, "true", null, undefined].map((smoothing) => ({
			...valid,
			smoothing,
		})),
		...["best", "HIGH", 0, null, undefined].map((smoothingQuality) => ({
			...valid,
			smoothingQuality,
		})),
		{},
	];
	for (const raster of invalid) {
		const value = extendedFixture(),
			{ io } = value;
		expect(() =>
			io.draw({
				commands: [
					surface("source"),
					{
						...surface("target"),
						commands: [{ ...blit("source"), raster }],
					},
				],
			}),
		).toThrow("Invalid native blit raster settings");
		expect(io.events.filter((event) => event.op === "drawImage")).toHaveLength(
			0,
		);
		expect(io.canvases).toHaveLength(3);
		expectReleased(value);
	}
});

test("production blit applies blur then contrast once and restores legacy filter state", () => {
	const value = extendedFixture();
	value.io.draw({
		commands: [
			surface("source"),
			{
				...blit("source"),
				raster: {
					blurPx: 4,
					contrast: 14,
					smoothing: true,
					smoothingQuality: "low",
				},
			},
			blit("source"),
		],
	});
	const draws = value.io.events.filter((event) => event.op === "drawImage");
	expect(draws.map((event) => event.state.filter)).toEqual([
		"blur(4px) contrast(14)",
		"none",
	]);
	expectReleased(value);
});
