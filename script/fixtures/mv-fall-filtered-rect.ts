import type { MvEmberDraw, MvEmberPlan } from "@opencut/editor-contracts";
import { MV_EMBER_RENDERER_SOURCE } from "../../packages/editor-classic/src/services/renderer/programmatic/mv-ember-renderer";

export function fallFilteredRect(blurPx = 10): MvEmberDraw {
	return {
		kind: "filteredRect",
		transform: [1, 0, 0, 1, 0, 0],
		operations: [],
		clip: null,
		rect: [22, 20, 20, 472],
		blurPx,
		paint: {
			kind: "fill",
			composite: "source-over",
			opacity: 1,
			style: {
				kind: "linear",
				from: [0, 0],
				to: [0, 512],
				stops: [
					{ offset: 0, color: [1, 1, 1, 0] },
					{ offset: 0.18, color: [1, 1, 1, 1] },
					{ offset: 1, color: [1, 1, 1, 0] },
				],
			},
		},
	};
}
export function fallFilterChecks(referenceDefinition: string) {
	const draw = new Function(
		`${MV_EMBER_RENDERER_SOURCE}; return drawMvEmber;`,
	)() as (
		ctx: OffscreenCanvasRenderingContext2D,
		plan: MvEmberPlan,
		assets: unknown,
		make: (w: number, h: number) => OffscreenCanvas,
	) => void;
	const original = new Function(
		"Z",
		`${referenceDefinition}\nreturn getStreakSprite();`,
	) as (z: {
		canvas: (w: number, h: number) => OffscreenCanvas;
	}) => OffscreenCanvas;
	const allocations: [number, number][] = [];
	const make = (w: number, h: number) => {
		allocations.push([w, h]);
		return new OffscreenCanvas(w, h);
	};
	const pixels = (c: OffscreenCanvas) =>
		c.getContext("2d")!.getImageData(0, 0, 64, 512).data;
	const difference = (a: Uint8ClampedArray, b: Uint8ClampedArray) => {
		let max = 0,
			sum = 0,
			changed = 0;
		for (let i = 0; i < a.length; i++) {
			const delta = Math.abs(a[i]! - b[i]!);
			max = Math.max(max, delta);
			sum += delta;
			changed += Number(delta !== 0);
		}
		return { max, mae: sum / a.length, changed };
	};
	const preset = (c: OffscreenCanvas) => {
		const x = c.getContext("2d")!;
		x.fillStyle = "#20a0e0";
		x.fillRect(2, 250, 5, 5);
		x.fillStyle = "#f02050";
		x.fillRect(54, 270, 5, 5);
	};
	const directZero = (c: OffscreenCanvas) => {
		const x = c.getContext("2d")!,
			g = x.createLinearGradient(0, 0, 0, 512);
		g.addColorStop(0, "rgba(255,255,255,0)");
		g.addColorStop(0.18, "rgba(255,255,255,1)");
		g.addColorStop(1, "rgba(255,255,255,0)");
		x.fillStyle = g;
		x.filter = "none";
		x.fillRect(22, 20, 20, 472);
	};
	const observations: Record<string, ReturnType<typeof difference>> = {};
	const negatives: Record<string, ReturnType<typeof difference>> = {};
	for (const existing of [false, true]) {
		const expected = new OffscreenCanvas(64, 512),
			actual = new OffscreenCanvas(64, 512);
		if (existing) {
			preset(expected);
			preset(actual);
		}
		original({
			canvas(w, h) {
				if (w !== 64 || h !== 512)
					throw Error("Original streak dimensions changed");
				return expected;
			},
		});
		draw(
			actual.getContext("2d")!,
			{ commands: [fallFilteredRect()] },
			{},
			make,
		);
		observations[existing ? "existing-target" : "original-streak"] = difference(
			pixels(actual),
			pixels(expected),
		);
		const omitted = new OffscreenCanvas(64, 512);
		if (existing) preset(omitted);
		draw(
			omitted.getContext("2d")!,
			{ commands: [fallFilteredRect(0)] },
			{},
			make,
		);
		negatives[existing ? "existing-target-omit-blur" : "omit-blur"] =
			difference(pixels(omitted), pixels(expected));
		const whole = new OffscreenCanvas(64, 512),
			wholeCtx = whole.getContext("2d")!;
		wholeCtx.filter = "blur(10px)";
		wholeCtx.drawImage(omitted, 0, 0);
		negatives[
			existing ? "existing-target-whole-canvas-blur" : "whole-canvas-blur"
		] = difference(pixels(whole), pixels(expected));
		for (const canvas of [expected, actual, omitted, whole])
			canvas.width = canvas.height = 1;
	}
	const zero = new OffscreenCanvas(64, 512),
		zeroExpected = new OffscreenCanvas(64, 512);
	directZero(zeroExpected);
	draw(zero.getContext("2d")!, { commands: [fallFilteredRect(0)] }, {}, make);
	observations["zero-blur"] = difference(pixels(zero), pixels(zeroExpected));
	zero.width = zero.height = zeroExpected.width = zeroExpected.height = 1;
	const passed =
		Object.values(observations).every((v) => v.max === 0) &&
		negatives["omit-blur"]!.max > 0 &&
		negatives["existing-target-whole-canvas-blur"]!.max > 0 &&
		allocations.length === 0;
	return {
		passed,
		width: 64,
		height: 512,
		threshold: { maxChannel: 0 },
		observations,
		negatives,
		explicitReplayCanvasAllocations: allocations,
		allocationScope:
			"Direct fill uses the existing target; Canvas/Skia internal filter scratch is logically budgeted, not an RSS measurement.",
		originalDefinitionExecutedUnchanged: true,
	};
}
