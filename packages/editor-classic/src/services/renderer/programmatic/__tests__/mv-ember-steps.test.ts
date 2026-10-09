import { expect, test } from "bun:test";
import type { MvEmberCommand, MvEmberPlan } from "@opencut/editor-contracts";
import { MV_EMBER_RENDERER_SOURCE } from "../mv-ember-renderer";
import { emberRasterFixture } from "./mv-ember-recording-fixture";

const transform = [1, 0, 0, 1, 0, 0] as const;
const paint = {
	kind: "fill",
	style: { kind: "solid", color: [0.1, 0.2, 0.3, 0.4] },
	composite: "source-over",
	opacity: 0.6,
} as const;
const rect = { kind: "rect", transform, rect: [1, 2, 30, 40], paint } as const;
const image = {
	kind: "image",
	transform,
	image: "image",
	destinationRect: [3, 4, 50, 60],
	composite: "source-over",
	opacity: 0.7,
	smoothing: true,
	smoothingQuality: "high",
} as const;
const grain = {
	kind: "grain",
	transform,
	rect: [0, 0, 64, 64],
	size: [2, 2],
	gray: [3, 50, 129, 244],
	opacity: 0.25,
} as const;
const blit = (surface: string): MvEmberCommand & { kind: "blit" } => ({
	kind: "blit",
	surface,
	transform,
	sourceRect: [0, 0, 64, 64],
	destinationRect: [5, 6, 64, 64],
	composite: "source-over",
	opacity: 0.8,
});
const plan: MvEmberPlan = {
	commands: [
		rect,
		{
			kind: "surface",
			id: "glyph",
			size: [64, 64],
			commands: [
				{
					kind: "text",
					transform,
					operations: [{ kind: "translate", offset: [3, 5] }],
					font: "font",
					text: "AV",
					fontSize: 1000,
					tracking: 1.3,
					position: [8, 9],
					align: "center",
					baseline: "alphabetic",
					opacity: 0.5,
					composite: "source-over",
					style: {
						kind: "linear",
						from: [0, -800],
						to: [0, 50],
						stops: [
							{ offset: 0, color: [1, 0, 0, 1] },
							{ offset: 1, color: [0, 0, 1, 1] },
						],
					},
				},
				{
					kind: "path",
					transform,
					operations: [{ kind: "rotate", radians: 0.13 }],
					clip: {
						transform,
						path: [
							{
								kind: "arc",
								center: [20, 20],
								radius: 18,
								start: 0,
								end: 6.28,
							},
						],
					},
					path: [
						{ kind: "moveTo", point: [0, 0] },
						{ kind: "lineTo", point: [32, 40] },
						{ kind: "close" },
					],
					paints: [paint],
				},
				grain,
				image,
			],
		},
		{
			kind: "surface",
			id: "masked",
			size: [64, 64],
			commands: [
				blit("glyph"),
				{ ...rect, paint: { ...paint, composite: "multiply" } },
			],
		},
		blit("masked"),
		image,
		{ kind: "surface", id: "empty", size: [4, 5], commands: [] },
		grain,
	],
};
const boundaryCount =
	plan.commands.length +
	plan.commands.reduce(
		(sum, command) =>
			sum + (command.kind === "surface" ? command.commands.length : 0),
		0,
	);
type Fixture = ReturnType<typeof emberRasterFixture>;

function prepared(options: Parameters<typeof emberRasterFixture>[0] = {}) {
	const io = emberRasterFixture(options);
	Object.assign(io.output.ctx, {
		filter: "blur(2px)",
		globalAlpha: 0.37,
		globalCompositeOperation: "xor",
		letterSpacing: "9px",
		direction: "rtl",
	});
	return { io, initial: io.output.ctx.properties() };
}
function released({ io, initial }: ReturnType<typeof prepared>) {
	expect(io.output.ctx.properties()).toEqual(initial);
	expect(io.output.ctx.stack).toHaveLength(0);
	expect(io.output.ctx.state.transform).toEqual([]);
	expect(io.output.ctx.state.clip).toEqual([]);
	expect([io.output.width, io.output.height]).toEqual([1920, 1080]);
	for (const canvas of io.canvases.slice(1)) {
		expect([canvas.width, canvas.height]).toEqual([1, 1]);
		expect(canvas.ctx.stack).toHaveLength(0);
	}
	expect(io.closes()).toBe(0);
}
function drain(steps: ReturnType<Fixture["steps"]>) {
	let count = 0;
	while (!steps.next().done) count++;
	return count;
}

test("sync wrapper and resumed iterator exactly preserve frozen pre-iterator Canvas operations", async () => {
	const old = prepared(),
		sync = prepared(),
		stepped = prepared();
	old.io.originalDraw(plan);
	sync.io.draw(plan);
	const steps = stepped.io.steps(plan);
	expect(stepped.io.events).toHaveLength(0);
	let count = 0;
	while (!steps.next().done) {
		count++;
		expect(stepped.io.output.ctx.stack).toHaveLength(1);
		for (const canvas of stepped.io.canvases.slice(1))
			expect(canvas.ctx.stack).toHaveLength(0);
		const pausedEvents = stepped.io.events.length;
		await Promise.resolve();
		expect(stepped.io.events).toHaveLength(pausedEvents);
	}
	expect(count).toBe(boundaryCount);
	expect(sync.io.trace()).toBe(old.io.trace());
	expect(stepped.io.trace()).toBe(old.io.trace());
	expect(stepped.io.canvases.map((c) => c.initial)).toEqual(
		old.io.canvases.map((c) => c.initial),
	);
	for (const value of [old, sync, stepped]) released(value);
});

test("return or injected throw at every root/child/commit boundary cleans private ownership", () => {
	for (const cancel of ["return", "throw"] as const)
		for (let boundary = 1; boundary <= boundaryCount; boundary++) {
			const value = prepared(),
				{ io } = value,
				steps = io.steps(plan);
			for (let n = 0; n < boundary; n++) expect(steps.next().done).toBe(false);
			if (cancel === "return") expect(steps.return().done).toBe(true);
			else
				expect(() => steps.throw(Error("cancelled at boundary"))).toThrow(
					"cancelled at boundary",
				);
			released(value);
			const stopped = io.trace();
			expect(steps.next().done).toBe(true);
			expect(steps.return().done).toBe(true);
			expect(io.trace()).toBe(stopped);
			// Cancellation must not leak a completed or half-built scratch into the next frame.
			expect(() => io.draw({ commands: [blit("glyph")] })).toThrow(
				"earlier scratch",
			);
			io.draw(plan);
			released(value);
		}
});

test("cancelling an unstarted iterator performs no Canvas/resource operation", () => {
	const value = prepared(),
		steps = value.io.steps(plan);
	expect(steps.return().done).toBe(true);
	expect(steps.next().done).toBe(true);
	expect(value.io.events).toHaveLength(0);
	expect(value.io.canvases).toHaveLength(1);
	released(value);
});

test("surface children yield before commit and cannot read their incomplete parent", () => {
	const value = prepared(),
		{ io } = value;
	const steps = io.steps({
		commands: [
			{
				kind: "surface",
				id: "self",
				size: [64, 64],
				commands: [rect, blit("self")],
			},
		],
	});
	expect(steps.next().done).toBe(false);
	expect(
		io.events.filter((e) => e.op === "fillRect").map((e) => e.target),
	).toEqual(["canvas1"]);
	expect(io.events.filter((e) => e.op === "drawImage")).toHaveLength(0);
	expect(() => steps.next()).toThrow("earlier scratch");
	released(value);
	// Last-child pause still owns the surface; return must dispose it without sampling it.
	const last = io.steps({
		commands: [
			{ kind: "surface", id: "one", size: [7, 8], commands: [rect] },
			blit("one"),
		],
	});
	expect(last.next().done).toBe(false);
	expect(io.canvases.at(-1)!.width).toBe(7);
	last.return();
	expect(io.events.filter((e) => e.op === "drawImage")).toHaveLength(0);
	released(value);
});

test("root and child native errors after a pause match the old sync operation trace", () => {
	for (const child of [false, true]) {
		const commands: unknown[] = child
			? [
					{
						kind: "surface",
						id: "failed",
						size: [64, 64],
						commands: [rect, image],
					},
				]
			: [rect, image];
		const old = prepared({ drawError: true }),
			stepped = prepared({ drawError: true });
		expect(() => old.io.originalDraw({ commands })).toThrow(
			"fixture image failure",
		);
		const steps = stepped.io.steps({ commands });
		expect(steps.next().done).toBe(false);
		expect(() => steps.next()).toThrow("fixture image failure");
		expect(stepped.io.trace()).toBe(old.io.trace());
		expect(steps.next().done).toBe(true);
		released(old);
		released(stepped);
	}
});

test("scratch context and grain failures release all allocations after prior commands", () => {
	for (const options of [{ noContext: 1 }, { noPattern: true }]) {
		const value = prepared(options),
			old = prepared(options);
		const failed = {
			commands: [
				rect,
				{ kind: "surface", id: "failed", size: [8, 9], commands: [grain] },
			],
		};
		expect(() => old.io.originalDraw(failed)).toThrow();
		const steps = value.io.steps(failed);
		expect(steps.next().done).toBe(false);
		expect(() => drain(steps)).toThrow();
		expect(value.io.trace()).toBe(old.io.trace());
		released(value);
	}
});

test("multiple complete frames do not reuse scratch or iterator state", () => {
	const value = prepared(),
		{ io } = value;
	expect(drain(io.steps(plan))).toBe(boundaryCount);
	expect(() => drain(io.steps({ commands: [blit("masked")] }))).toThrow(
		"earlier scratch",
	);
	expect(drain(io.steps(plan))).toBe(boundaryCount);
	expect(io.events.filter((e) => e.op === "fillText")).toHaveLength(2);
	expect(io.canvases).toHaveLength(11);
	released(value);
});

test("diagnostic injection anchors remain single-match after iterator extraction", () => {
	for (const anchor of [
		"const allocated = [], scratch = new Map();",
		"const canvas = new OffscreenCanvas(...size); allocated.push(canvas); return canvas;",
		"if (command.clip) {",
		"target.clip('nonzero');",
		"mvEmberTransform(target,command);",
	])
		expect(MV_EMBER_RENDERER_SOURCE.split(anchor)).toHaveLength(2);
});
