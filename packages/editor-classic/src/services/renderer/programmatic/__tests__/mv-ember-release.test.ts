import { expect, test } from "bun:test";
import type { MvEmberPlan } from "@opencut/editor-contracts";
import {
	blit,
	drain,
	extendedFixture,
	expectReleased,
	grayPixels,
	surface,
} from "./mv-ember-extended-fixture";

const diamond: MvEmberPlan = {
	commands: [
		surface("source"),
		{ ...surface("left"), commands: [blit("source")] },
		{ ...surface("right"), commands: [blit("source")] },
		{ kind: "releaseSurface", surface: "source" },
		blit("left"),
		blit("right"),
		{ kind: "releaseSurface", surface: "left" },
		{ kind: "releaseSurface", surface: "right" },
		grayPixels,
	],
};
const boundaries = diamond.commands.length + 3;

test("diamond DAG releases a consumed source before completion while both children remain usable", () => {
	const value = extendedFixture(),
		{ io } = value,
		steps = io.steps(diamond);
	for (let n = 0; n < 6; n++) expect(steps.next().done).toBe(false);
	expect(io.canvases.map((canvas) => [canvas.width, canvas.height])).toEqual([
		[1920, 1080],
		[8, 9],
		[8, 9],
		[8, 9],
	]);
	expect(steps.next().done).toBe(false);
	expect(io.canvases.map((canvas) => [canvas.width, canvas.height])).toEqual([
		[1920, 1080],
		[1, 1],
		[8, 9],
		[8, 9],
	]);
	// Release itself does not paint, and the frame is still resumable.
	expect(
		io.events
			.filter((event) => event.op === "drawImage")
			.map((event) => event.target),
	).toEqual(["canvas2", "canvas3"]);
	expect(drain(steps)).toBe(boundaries - 7);
	expect(
		io.events
			.filter((event) => event.op === "drawImage")
			.map((event) => [
				event.target,
				io.canvases.findIndex((canvas) => canvas === event.args[0]),
			]),
	).toEqual([
		["canvas2", 1],
		["canvas3", 1],
		["canvas0", 2],
		["canvas0", 3],
	]);
	expectReleased(value);
});

test("release lifecycle rejects missing, future, double, reused, child and incomplete surfaces", () => {
	const release = { kind: "releaseSurface", surface: "source" };
	const cases: { commands: unknown[]; error: string }[] = [
		{ commands: [release], error: "completed live" },
		{ commands: [release, surface("source")], error: "completed live" },
		{
			commands: [surface("source"), release, release],
			error: "completed live",
		},
		{
			commands: [surface("source"), release, blit("source")],
			error: "earlier scratch",
		},
		{
			commands: [surface("source"), release, surface("source")],
			error: "Duplicate",
		},
		{
			commands: [{ ...surface("source"), commands: [release] }],
			error: "only allowed at the root",
		},
		{
			commands: [
				surface("source"),
				{ ...surface("child"), commands: [release] },
			],
			error: "only allowed at the root",
		},
		{
			commands: [
				{ ...surface("source"), commands: [grayPixels, blit("source")] },
			],
			error: "earlier scratch",
		},
	];
	for (const entry of cases) {
		const value = extendedFixture();
		expect(() => value.io.draw({ commands: entry.commands })).toThrow(
			entry.error,
		);
		expectReleased(value);
		// Neither success nor failure makes old IDs visible to the next frame.
		value.io.draw(diamond);
		expectReleased(value);
	}
});

test("return or throw across every explicit-release boundary releases remaining surfaces and keeps declared assets", () => {
	for (const cancel of ["return", "throw"] as const)
		for (let boundary = 1; boundary <= boundaries; boundary++) {
			const value = extendedFixture(),
				{ io } = value,
				steps = io.steps(diamond);
			for (let n = 0; n < boundary; n++) expect(steps.next().done).toBe(false);
			if (cancel === "return") expect(steps.return().done).toBe(true);
			else expect(() => steps.throw(Error("cancelled"))).toThrow("cancelled");
			expectReleased(value);
			const trace = io.trace();
			expect(steps.next().done).toBe(true);
			expect(steps.return().done).toBe(true);
			expect(io.trace()).toBe(trace);
			expect(() => io.draw({ commands: [blit("source")] })).toThrow(
				"earlier scratch",
			);
			expect(drain(io.steps(diamond))).toBe(boundaries);
			expectReleased(value);
		}
});
