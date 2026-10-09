import { expect, test } from "bun:test";
import { emberRasterFixture } from "./mv-ember-recording-fixture";
import {
	circles,
	circleCommand,
	expandedCircleCommand,
	circlePlan,
} from "./mv-ember-circle-fixture";
import {
	drain,
	extendedFixture,
	expectReleased,
} from "./mv-ember-extended-fixture";

test("circleBatch exactly preserves verbose move/arc path, CTM, clip, gradients and paint order in root and scratch", () => {
	const verbose = emberRasterFixture(),
		compact = emberRasterFixture(),
		stepped = emberRasterFixture();
	verbose.draw(circlePlan(expandedCircleCommand()));
	compact.draw(circlePlan(circleCommand()));
	expect(drain(stepped.steps(circlePlan(circleCommand())))).toBe(5);
	expect(compact.trace()).toBe(verbose.trace());
	expect(stepped.trace()).toBe(verbose.trace());
	const paints = compact.events.filter(
		(event) =>
			event.target === "canvas0" && ["fill", "stroke"].includes(event.op),
	);
	expect(paints.map((event) => event.op)).toEqual(["fill", "stroke", "fill"]);
	expect(new Set(paints.map((event) => event.state.path)).size).toBe(1);
	expect(paints.map((event) => event.state.globalCompositeOperation)).toEqual([
		"source-over",
		"lighter",
		"multiply",
	]);
	expect(paints[0]!.state.transform).toEqual([
		["setTransform", 0.5, 0, 0, 0.75, 2, 3],
		["translate", 10, 20],
		["rotate", 0.23],
		["scale", 1.1, 0.7],
	]);
	expect(paints[0]!.state.clip).toMatchObject({
		rule: "nonzero",
		transform: [
			["setTransform", 1, 0, 0, 1, 100, 200],
			["rotate", -0.13],
		],
	});
});

test("each circle retains its moveTo(x+r,y) followed by a complete clockwise arc with no close or path split", () => {
	const io = emberRasterFixture();
	io.draw({ commands: [{ ...circleCommand(), clip: undefined }] });
	expect(
		io.events
			.filter((event) =>
				["beginPath", "moveTo", "arc", "closePath"].includes(event.op),
			)
			.map((event) => [event.op, ...event.args]),
	).toEqual([
		["beginPath"],
		...[...circles].flatMap(([x, y, radius]) => [
			["moveTo", x + radius, y],
			["arc", x, y, radius, 0, 6.283185307179586, false],
		]),
	]);
	expect(io.events.filter((event) => event.op === "beginPath")).toHaveLength(1);
});

test("empty and nontrivial batch sizes preserve the independent old verbose replay without scene formulas", () => {
	for (const rows of [
		[],
		Array.from(
			{ length: 67 },
			(_, n) => [n * 0.123, -n * 0.33, n * 0.017] as const,
		),
	]) {
		const verbose = emberRasterFixture(),
			compact = emberRasterFixture();
		verbose.originalDraw({ commands: [expandedCircleCommand(rows)] });
		compact.draw({ commands: [circleCommand(rows)] });
		expect(compact.trace()).toBe(verbose.trace());
		expect(
			compact.events.filter((event) => event.op === "moveTo"),
		).toHaveLength(rows.length);
		expect(compact.events.filter((event) => event.op === "arc")).toHaveLength(
			rows.length + 2,
		);
	}
});

test("circleBatch retains command-atomic cancellation and releases surrounding scratch lifetimes", () => {
	for (const cancel of ["return", "throw"] as const)
		for (let boundary = 1; boundary <= 5; boundary++) {
			const value = extendedFixture(),
				steps = value.io.steps(circlePlan(circleCommand()));
			for (let n = 0; n < boundary; n++) expect(steps.next().done).toBe(false);
			if (cancel === "return") expect(steps.return().done).toBe(true);
			else
				expect(() => steps.throw(Error("circle cancellation"))).toThrow(
					"circle cancellation",
				);
			expectReleased(value);
			const trace = value.io.trace();
			expect(steps.next().done).toBe(true);
			expect(value.io.trace()).toBe(trace);
			value.io.draw(circlePlan(circleCommand()));
			expectReleased(value);
		}
});
