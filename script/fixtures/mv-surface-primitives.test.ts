import { expect, test } from "bun:test";
import { MV_EMBER_RENDERER_SOURCE } from "../../packages/editor-classic/src/services/renderer/programmatic/mv-ember-renderer";
import { pixelPlan } from "./mv-surface-pixels-fixture";
import { surfaceReplaySource } from "./mv-surface-mutations";
import { surfaceLifecycleProof } from "./mv-surface-checks";
import { emberRasterFixture } from "../../packages/editor-classic/src/services/renderer/programmatic/__tests__/mv-ember-recording-fixture";

test("controlled fixture has byte-complete uploads, both sampling modes and explicit DAG lifetimes", () => {
	const plan = pixelPlan();
	expect(
		plan.commands
			.filter((command) => command.kind === "releaseSurface")
			.map((command) => command.surface),
	).toEqual(["unused", "pixels", "scaled", "blurred"]);
	for (const command of plan.commands) {
		if (command.kind !== "surface") continue;
		for (const child of command.commands) {
			if (child.kind !== "grayPixels") continue;
			expect(child.gray).toHaveLength(child.size[0] * child.size[1]);
			expect(
				child.gray.every(
					(byte) => Number.isInteger(byte) && byte >= 0 && byte <= 255,
				),
			).toBe(true);
		}
	}
	expect(pixelPlan(true).commands).toEqual(
		plan.commands.filter((command) => command.kind !== "releaseSurface"),
	);
	const scaled = plan.commands.find(
		(command) => command.kind === "surface" && command.id === "scaled",
	);
	if (scaled?.kind !== "surface")
		throw Error("Missing controlled scaled surface");
	expect(
		scaled.commands.map((command) =>
			command.kind === "blit" ? command.raster?.smoothing : null,
		),
	).toEqual([false, true]);
});

test("negative controls mutate exactly one fixed native replay anchor and remain executable JavaScript", () => {
	expect(surfaceReplaySource()).toBe(MV_EMBER_RENDERER_SOURCE);
	for (const mutation of [
		"omitBlur",
		"wrongSmoothing",
		"transparentGray",
		"prematureRelease",
	] as const) {
		const source = surfaceReplaySource(mutation);
		expect(source).not.toBe(MV_EMBER_RENDERER_SOURCE);
		expect(() => new Function(source)).not.toThrow();
	}
});

test("release proof requires actual early backing-size changes, not only final cleanup", () => {
	const snapshots: number[][][] = Array.from({ length: 15 }, () => []);
	snapshots[2] = [[1, 1]];
	snapshots[8] = [
		[1, 1],
		[1, 1],
		[96, 96],
	];
	snapshots[11] = [
		[1, 1],
		[1, 1],
		[1, 1],
		[96, 96],
	];
	snapshots[14] = [
		[1, 1],
		[1, 1],
		[1, 1],
		[1, 1],
	];
	const value = {
		snapshots,
		final: [
			[1, 1],
			[1, 1],
			[1, 1],
			[1, 1],
		],
	};
	expect(Object.values(surfaceLifecycleProof(value)).every(Boolean)).toBe(true);
	for (const boundary of [2, 8, 11, 14]) {
		const corrupted = structuredClone(value);
		corrupted.snapshots[boundary]![0] = [32, 32];
		expect(Object.values(surfaceLifecycleProof(corrupted)).every(Boolean)).toBe(
			false,
		);
	}
});

test("controlled plan release milestones match the production iterator boundaries", () => {
	const fixture = emberRasterFixture();
	const steps = fixture.steps(pixelPlan()),
		snapshots: number[][][] = [];
	while (!steps.next().done)
		snapshots.push(
			fixture.canvases.slice(1).map((canvas) => [canvas.width, canvas.height]),
		);
	const final = fixture.canvases
		.slice(1)
		.map((canvas) => [canvas.width, canvas.height]);
	expect(snapshots).toHaveLength(15);
	expect(
		Object.values(surfaceLifecycleProof({ snapshots, final })).every(Boolean),
	).toBe(true);
});
