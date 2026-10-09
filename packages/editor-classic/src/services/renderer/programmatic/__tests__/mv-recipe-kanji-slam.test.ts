import { expect, test } from "bun:test";
import { kanjiPlan } from "./mv-recipe-kanji-slam-fixture";
import { recipeRecordingFixture } from "./mv-recipe-recording-fixture";

const drain = (steps: Generator<void, void, unknown>) => {
	let count = 0;
	while (!steps.next().done) count++;
	return count;
};
const released = (io: ReturnType<typeof recipeRecordingFixture>) => {
	expect([io.output.width, io.output.height]).toEqual([4, 3]);
	for (const canvas of io.canvases) {
		expect(canvas.ctx.stack).toHaveLength(0);
		if (canvas !== io.output)
			expect([canvas.width, canvas.height]).toEqual([1, 1]);
	}
	expect(io.closes()).toBe(0);
};

test("kanjiSlam sync/stepped role dispatch transports all five native primitives unchanged (trace, not pixels)", () => {
	const reference = recipeRecordingFixture();
	reference.original(kanjiPlan("ember"));
	for (const native of [false, true])
		for (const stepped of [false, true]) {
			const io = recipeRecordingFixture();
			if (stepped)
				expect(drain(io.steps({ plan: kanjiPlan(), native }))).toBe(14);
			else io.render({ plan: kanjiPlan(), native });
			expect(io.trace()).toBe(reference.trace());
			expect(io.events.filter((e) => e.op === "strokeText")).toHaveLength(1);
			expect(io.events.filter((e) => e.op === "putImageData")).toHaveLength(1);
			expect(io.events.filter((e) => e.op === "createPattern")).toHaveLength(1);
			expect(
				io.events.filter((e) => e.op === "drawImage" && e.args.length === 9),
			).toHaveLength(2);
			expect(
				io.events
					.filter((e) => e.op === "fillRect")
					.slice(0, 2)
					.map((e) => e.args),
			).toEqual([
				[1, 2, 3, 4],
				[2, 3, 4, 5],
			]);
			expect(
				io.canvases
					.slice(1)
					.every((c) => c.backend === (native ? "native2d" : "offscreen")),
			).toBe(true);
			released(io);
		}
});

test("kanjiSlam cancellation at every replay boundary releases scratch and remains reusable", () => {
	const count = drain(
		recipeRecordingFixture().steps({ plan: kanjiPlan(), native: true }),
	);
	for (const native of [false, true])
		for (const cancel of ["return", "throw"] as const)
			for (let boundary = 1; boundary <= count; boundary++) {
				const io = recipeRecordingFixture(),
					steps = io.steps({ plan: kanjiPlan(), native });
				for (let n = 0; n < boundary; n++)
					expect(steps.next().done).toBe(false);
				if (cancel === "return") expect(steps.return().done).toBe(true);
				else
					expect(() => steps.throw(Error("kanji cancelled"))).toThrow(
						"kanji cancelled",
					);
				released(io);
				const trace = io.trace();
				expect(steps.next().done).toBe(true);
				expect(io.trace()).toBe(trace);
				expect(drain(io.steps({ plan: kanjiPlan(), native }))).toBe(count);
				released(io);
			}
});
