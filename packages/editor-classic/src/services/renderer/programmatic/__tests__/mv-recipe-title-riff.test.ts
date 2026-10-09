import { expect, test } from "bun:test";
import type { MvRecipePlan, MvTitleRiffPlan } from "@opencut/editor-contracts";
import { circleCommand } from "./mv-ember-circle-fixture";
import { grayPixels } from "./mv-ember-extended-fixture";
import { recipeRecordingFixture } from "./mv-recipe-recording-fixture";

const transform = [1, 0, 0, 1, 0, 0] as const;
const data: MvTitleRiffPlan = {
	commands: [
		{
			kind: "surface",
			id: "glyph",
			size: [16, 16],
			commands: [
				grayPixels,
				circleCommand(),
				{
					kind: "text",
					transform,
					font: "font",
					text: "残響",
					fontSize: 1000,
					tracking: 0,
					position: [2, 3],
					align: "left",
					baseline: "alphabetic",
					color: [1, 1, 1, 1],
					composite: "source-over",
					opacity: 0.8,
				},
			],
		},
		{
			kind: "blit",
			surface: "glyph",
			transform,
			sourceRect: [0, 0, 16, 16],
			destinationRect: [0, 0, 4, 3],
			composite: "source-over",
			opacity: 0.7,
			raster: { blurPx: 2, smoothing: true, smoothingQuality: "high" },
		},
		{ kind: "releaseSurface", surface: "glyph" },
		{
			kind: "image",
			image: "image",
			transform,
			destinationRect: [0, 0, 4, 3],
			composite: "source-over",
			opacity: 0.3,
			smoothing: true,
			smoothingQuality: "low",
		},
	],
};
const titlePlan = (
	kind: "titleRiff" | "ember" = "titleRiff",
): MvRecipePlan => ({
	version: 1,
	songSeconds: 6.071,
	outputRoles: ["background", "foreground"],
	post: [],
	root: {
		kind: "ref",
		sampledFrame: 364,
		input: { kind, role: "foreground", data },
	},
});
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
	expect(io.assets.descriptor("font").kind).toBe("font");
	expect(io.assets.image("image")).toMatchObject({ width: 4, height: 8 });
};

test("titleRiff synchronous and stepped dispatch use the existing Ember replay in only the selected role", () => {
	const reference = recipeRecordingFixture();
	reference.original(titlePlan("ember"));
	for (const native of [false, true])
		for (const stepped of [false, true]) {
			const io = recipeRecordingFixture();
			if (stepped)
				expect(drain(io.steps({ plan: titlePlan(), native }))).toBe(11);
			else io.render({ plan: titlePlan(), native });
			expect(io.trace()).toBe(reference.trace());
			expect(io.events.filter((event) => event.op === "fillText")).toHaveLength(
				1,
			);
			expect(
				io.events.filter((event) => event.op === "putImageData"),
			).toHaveLength(1);
			expect(
				io.events.filter((event) => event.op === "drawImage"),
			).toHaveLength(4);
			expect(io.canvases).toHaveLength(4);
			expect(
				io.canvases
					.slice(1)
					.every(
						(canvas) => canvas.backend === (native ? "native2d" : "offscreen"),
					),
			).toBe(true);
			released(io);
		}
});

test("titleRiff cancellation at every command/role boundary releases parents and private scratch on either backend", () => {
	for (const native of [false, true])
		for (const cancel of ["return", "throw"] as const)
			for (let boundary = 1; boundary <= 11; boundary++) {
				const io = recipeRecordingFixture(),
					steps = io.steps({ plan: titlePlan(), native });
				for (let n = 0; n < boundary; n++)
					expect(steps.next().done).toBe(false);
				if (cancel === "return") expect(steps.return().done).toBe(true);
				else
					expect(() => steps.throw(Error("title cancelled"))).toThrow(
						"title cancelled",
					);
				released(io);
				const trace = io.trace();
				expect(steps.next().done).toBe(true);
				expect(io.trace()).toBe(trace);
				expect(drain(io.steps({ plan: titlePlan(), native }))).toBe(11);
				released(io);
			}
});

test("titleRiff factory and draw failures release every already-owned parent and scratch", () => {
	for (let failFactoryAt = 1; failFactoryAt <= 3; failFactoryAt++) {
		const io = recipeRecordingFixture({ failFactoryAt });
		expect(() => io.render({ plan: titlePlan(), native: true })).toThrow(
			"factory allocation failure",
		);
		released(io);
	}
	for (let drawErrorAt = 1; drawErrorAt <= 4; drawErrorAt++) {
		const io = recipeRecordingFixture({ drawErrorAt });
		expect(() => drain(io.steps({ plan: titlePlan(), native: true }))).toThrow(
			"recipe draw failure",
		);
		released(io);
		io.render({ plan: titlePlan(), native: true });
		released(io);
	}
});
