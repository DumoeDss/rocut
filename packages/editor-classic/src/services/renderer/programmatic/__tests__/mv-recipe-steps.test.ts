import { expect, test } from "bun:test";
import {
	completeRecipe,
	grade,
	leak,
	recipePlan,
} from "./mv-recipe-test-plans";
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

test("complete sync/stepped recipe and post grouping preserve frozen replay operation order", async () => {
	const old = recipeRecordingFixture(),
		sync = recipeRecordingFixture(),
		stepped = recipeRecordingFixture();
	old.original(completeRecipe);
	sync.render({ plan: completeRecipe });
	const iterator = stepped.steps({ plan: completeRecipe });
	const initial = stepped.trace();
	expect(stepped.trace()).toBe(initial);
	let count = 0;
	while (!iterator.next().done) {
		count++;
		const paused = stepped.trace();
		await Promise.resolve();
		expect(stepped.trace()).toBe(paused);
	}
	expect(count).toBeGreaterThan(20);
	expect(sync.trace()).toBe(old.trace());
	expect(stepped.trace()).toBe(old.trace());
	for (const io of [old, sync, stepped]) released(io);
});

test("return/throw at every recursive, role, Ember and post boundary releases the entire live graph", () => {
	const reference = recipeRecordingFixture();
	const count = drain(reference.steps({ plan: completeRecipe }));
	for (const mode of ["return", "throw"] as const) {
		for (let boundary = 1; boundary <= count; boundary++) {
			const io = recipeRecordingFixture(),
				steps = io.steps({ plan: completeRecipe, native: true });
			for (let n = 0; n < boundary; n++) expect(steps.next().done).toBe(false);
			if (mode === "return") expect(steps.return().done).toBe(true);
			else
				expect(() => steps.throw(Error("recipe cancelled"))).toThrow(
					"recipe cancelled",
				);
			released(io);
			const trace = io.trace();
			expect(steps.next().done).toBe(true);
			expect(io.trace()).toBe(trace);
			// Reusing the same names must create fresh surfaces, not inherit a partial graph.
			drain(io.steps({ plan: completeRecipe, native: true }));
			released(io);
		}
	}
});

test("empty and unstarted recipes cancel without leaking or touching the caller surface", () => {
	const io = recipeRecordingFixture(),
		unstarted = io.steps({ plan: completeRecipe, native: true });
	const initial = io.trace();
	unstarted.return();
	expect(io.trace()).toBe(initial);
	const empty = io.steps({
		plan: recipePlan({ root: { kind: "empty" } }),
		native: true,
	});
	expect(empty.next().done).toBe(false);
	expect(io.events.filter((e) => e.op === "drawImage")).toHaveLength(0);
	empty.return();
	released(io);
});

test("native draw failures at each graph depth unwind every parent surface and context", () => {
	const full = recipeRecordingFixture();
	full.render({ plan: completeRecipe });
	const count = full.events.filter((event) => event.op === "drawImage").length;
	for (let drawErrorAt = 1; drawErrorAt <= count; drawErrorAt++) {
		const io = recipeRecordingFixture({ drawErrorAt });
		expect(() =>
			drain(io.steps({ plan: completeRecipe, native: true })),
		).toThrow("recipe draw failure");
		released(io);
		io.render({ plan: completeRecipe, native: true });
		released(io);
	}
});

test("post yields only between the original contiguous groups, preserving zero-leak coalescing", () => {
	const io = recipeRecordingFixture();
	const zero = { ...leak, effect: { ...leak.effect, amount: 0 } };
	expect(drain(io.postSteps([grade, zero, grade]))).toBe(1);
	expect(io.events.filter((event) => event.op === "putImageData")).toHaveLength(
		1,
	);
	const grouped = recipeRecordingFixture();
	expect(drain(grouped.postSteps([grade, leak, grade]))).toBe(3);
	expect(
		grouped.events.filter((event) => event.op === "putImageData"),
	).toHaveLength(2);
	expect(
		grouped.events.filter((event) => event.op === "createRadialGradient"),
	).toHaveLength(1);
	released(grouped);
});
