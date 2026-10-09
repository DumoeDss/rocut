import { expect, test } from "bun:test";
import { factoryNodes, recipePlan, solidNode } from "./mv-recipe-test-plans";
import { recipeRecordingFixture } from "./mv-recipe-recording-fixture";

const released = (io: ReturnType<typeof recipeRecordingFixture>) => {
	for (const canvas of io.canvases) {
		expect(canvas.ctx.stack).toHaveLength(0);
		if (canvas !== io.output)
			expect([canvas.width, canvas.height]).toEqual([1, 1]);
	}
	expect(io.closes()).toBe(0);
};
test("every internal 2D helper uses the explicit factory without changing default replay operations", () => {
	for (const root of factoryNodes) {
		const plan = recipePlan({ root });
		const old = recipeRecordingFixture(),
			defaults = recipeRecordingFixture(),
			native = recipeRecordingFixture();
		old.original(plan);
		defaults.render({ plan });
		native.render({ plan, native: true });
		expect(defaults.trace()).toBe(old.trace());
		expect(native.trace()).toBe(old.trace());
		expect(
			native.canvases.slice(1).every((c) => c.backend === "native2d"),
		).toBe(true);
		for (const io of [old, defaults, native]) released(io);
	}
});
test("a factory failure at each allocation releases already-created parent and helper surfaces", () => {
	for (const root of factoryNodes) {
		const plan = recipePlan({ root });
		const reference = recipeRecordingFixture();
		reference.render({ plan, native: true });
		for (
			let failFactoryAt = 1;
			failFactoryAt < reference.canvases.length;
			failFactoryAt++
		) {
			const io = recipeRecordingFixture({ failFactoryAt });
			expect(() => io.render({ plan, native: true })).toThrow(
				"factory allocation failure",
			);
			released(io);
		}
	}
});
test("mesh, surface transitions and spatial post keep genuine Offscreen WebGL allocation", () => {
	const roots = [
		{
			kind: "grid",
			role: "background",
			data: {
				image: "image",
				rect: [0, 0, 4, 3],
				fit: "cover",
				fullImage: false,
				faces: [{}],
			},
		},
		{
			kind: "transition",
			from: solidNode,
			to: solidNode,
			style: { kind: "peel" },
			commands: [{ kind: "surface" }],
		},
	];
	const plans = roots.map((root) => recipePlan({ root }));
	plans.push(
		recipePlan({
			root: solidNode,
			post: [
				{
					stage: "composite",
					effects: [{ effect: { kind: "bloom", amount: 0.5 } }],
				},
			],
		}),
	);
	for (const plan of plans) {
		const io = recipeRecordingFixture();
		expect(() => io.render({ plan, native: true })).toThrow("WebGL2");
		expect(io.canvases.some((c) => c.backend === "offscreen")).toBe(true);
		expect(
			io.lifecycle.some(
				(item) =>
					Array.isArray(item) && item[0] === "context" && item[2] === "webgl2",
			),
		).toBe(true);
		released(io);
	}
});
