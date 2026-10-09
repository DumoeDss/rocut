import { expect, test } from "bun:test";
import type {
	MvEmberPlan,
	MvEmberSurfaceDraw,
} from "@opencut/editor-contracts";
import {
	blit,
	drain,
	extendedFixture,
	expectReleased,
	grayPixels,
	surface,
} from "./mv-ember-extended-fixture";

const append = ({
	target,
	commands = [],
}: {
	target: string;
	commands?: readonly MvEmberSurfaceDraw[];
}) => ({ kind: "appendSurface", surface: target, commands }) as const;
const streamed: MvEmberPlan = {
	commands: [
		surface("source"),
		{ ...surface("target"), commands: [] },
		append({ target: "target", commands: [blit("source"), blit("source")] }),
		{ kind: "releaseSurface", surface: "source" },
		blit("target"),
		{ kind: "releaseSurface", surface: "target" },
	],
};

test("append keeps exactly the same canvas trace as contiguous drawing without copies or resets", () => {
	const contiguous = extendedFixture(),
		split = extendedFixture();
	contiguous.io.draw({
		commands: [
			surface("source"),
			{ ...surface("target"), commands: [blit("source"), blit("source")] },
			{ kind: "releaseSurface", surface: "source" },
			blit("target"),
			{ kind: "releaseSurface", surface: "target" },
		],
	});
	split.io.draw(streamed);
	expect(split.io.trace()).toBe(contiguous.io.trace());
	expect(split.io.canvases).toHaveLength(3);
	expectReleased(contiguous);
	expectReleased(split);
});

test("append rejects empty missing future released self-sampled and nested targets", () => {
	const pattern = (id: string) => ({
		...blit(id),
		kind: "surfacePatternRect",
		rect: [0, 0, 8, 9],
		smoothing: true,
		smoothingQuality: "low",
	});
	const release = { kind: "releaseSurface", surface: "source" };
	const cases: unknown[][] = [
		[append({ target: "" })],
		[append({ target: "missing" })],
		[append({ target: "source" }), surface("source")],
		[surface("source"), release, append({ target: "source" })],
		[
			surface("source"),
			append({ target: "source", commands: [blit("source")] }),
		],
		[
			surface("source"),
			{ ...append({ target: "source" }), commands: [pattern("source")] },
		],
		[
			surface("source"),
			append({ target: "source", commands: [blit("future")] }),
			surface("future"),
		],
		[
			surface("source"),
			surface("target"),
			release,
			append({ target: "target", commands: [blit("source")] }),
		],
		[
			surface("source"),
			{ ...append({ target: "source" }), commands: [surface("nested")] },
		],
		[
			surface("source"),
			{ ...append({ target: "source" }), commands: [release] },
		],
		[
			surface("source"),
			{
				...append({ target: "source" }),
				commands: [append({ target: "source" })],
			},
		],
		[
			surface("source"),
			{ ...surface("target"), commands: [append({ target: "source" })] },
		],
		[
			surface("source"),
			append({ target: "source" }),
			release,
			surface("source"),
		],
	];
	for (const commands of cases) {
		const value = extendedFixture();
		expect(() => value.io.draw({ commands })).toThrow();
		expectReleased(value);
		value.io.draw(streamed);
		expectReleased(value);
	}
});

test("append may yield while unpublished and always cleans up on return or throw", () => {
	const complete = extendedFixture(),
		boundaries = drain(complete.io.steps(streamed));
	expect(boundaries).toBe(9);
	for (const mode of ["return", "throw"] as const)
		for (let boundary = 1; boundary <= boundaries; boundary++) {
			const value = extendedFixture(),
				steps = value.io.steps(streamed);
			for (let n = 0; n < boundary; n++) expect(steps.next().done).toBe(false);
			if (mode === "return") expect(steps.return().done).toBe(true);
			else expect(() => steps.throw(Error("cancelled"))).toThrow("cancelled");
			expectReleased(value);
			const trace = value.io.trace();
			expect(steps.next().done).toBe(true);
			expect(value.io.trace()).toBe(trace);
			expect(() =>
				value.io.draw({
					commands: [append({ target: "target", commands: [grayPixels] })],
				}),
			).toThrow("completed live");
			expectReleased(value);
		}
});

test("draw errors in an unpublished append target release every canvas and retain assets", () => {
	const value = extendedFixture();
	expect(() =>
		value.io.draw({
			commands: [
				surface("target"),
				{
					...append({ target: "target", commands: [grayPixels] }),
					commands: [
						grayPixels,
						{ kind: "unsupported", transform: [1, 0, 0, 1, 0, 0] },
					],
				},
			],
		}),
	).toThrow("Unsupported Ember draw command");
	expectReleased(value);
	value.io.draw(streamed);
	expectReleased(value);
});
