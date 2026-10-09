import type {
	ProgrammaticSource,
	ResolvedProgrammaticResource,
} from "@opencut/editor-contracts";
import { renderProgrammaticCanvas } from "../../packages/editor-classic/src/services/renderer/programmatic/canvas-runtime";
import { resolveProgrammaticFrame } from "../../packages/editor-classic/src/services/renderer/programmatic/frame";
import { lightLeakSource } from "./mv-light-leak-source";
import { lightLeakAudioFixture } from "./mv-light-leak-audio";
import { panel } from "./mv-composition-fixture";

export const check = (ok: unknown, text: string) => {
	if (!ok) throw Error(text);
};
export function pixels(image: CanvasImageSource, width = 160, height = 96) {
	const canvas = new OffscreenCanvas(width, height),
		ctx = canvas.getContext("2d")!;
	ctx.drawImage(image, 0, 0);
	return ctx.getImageData(0, 0, width, height).data;
}
export const difference = (a: Uint8ClampedArray, b: Uint8ClampedArray) => {
	check(a.length === b.length, "Pixel lengths differ");
	let max = 0,
		total = 0;
	for (let i = 0; i < a.length; i++) {
		const d = Math.abs(a[i]! - b[i]!);
		max = Math.max(max, d);
		total += d;
	}
	return { max, mae: total / a.length };
};
export async function capture(
	source: ProgrammaticSource,
	index = 0,
	resources: readonly ResolvedProgrammaticResource[] = [],
	trimFrames = 0,
) {
	const step =
		(120000 * source.frameRate.denominator) / source.frameRate.numerator;
	const frame = resolveProgrammaticFrame({
		source,
		clipStart: 120000,
		clipDuration: (source.durationFrames - trimFrames) * step,
		trimStart: trimFrames * step,
		timelineTime: 120000 + (index - trimFrames) * step,
	});
	if (!frame) throw Error("Missing light-leak frame");
	const bitmap = await renderProgrammaticCanvas({ source, frame, resources });
	try {
		return pixels(bitmap, source.width, source.height);
	} finally {
		bitmap.close();
	}
}
export function originalPixels(
	source: ProgrammaticSource,
	index: number,
	{
		amount = 0.8,
		alpha = "expand",
		seed = source.seed,
		timeOffset = 0,
		speed = 1,
		blend = "screen",
		primaryOnly = false,
		opaque = false,
	}: {
		amount?: number;
		alpha?: "preserve" | "expand";
		seed?: number;
		timeOffset?: number;
		speed?: number;
		blend?: string;
		primaryOnly?: boolean;
		opaque?: boolean;
	} = {},
) {
	const width = source.width,
		height = source.height,
		canvas = new OffscreenCanvas(width, height),
		ctx = canvas.getContext("2d")!;
	ctx.fillStyle = `rgba(51,76.5,102,${opaque ? 1 : 0.5})`;
	ctx.fillRect(0, 0, width, height);
	let coverage: Uint8Array | undefined;
	if (alpha === "preserve") {
		const image = ctx.getImageData(0, 0, width, height);
		coverage = new Uint8Array(width * height);
		for (let i = 0; i < coverage.length; i++) {
			coverage[i] = image.data[i * 4 + 3]!;
			image.data[i * 4 + 3] = 255;
		}
		ctx.putImageData(image, 0, 0);
	}
	let draws = 0;
	const proxy = new Proxy(ctx, {
		get(target, key) {
			if (key === "fillRect")
				return (x: number, y: number, w: number, h: number) => {
					draws++;
					if (!primaryOnly || draws === 1) target.fillRect(x, y, w, h);
				};
			const value = Reflect.get(target, key, target);
			return typeof value === "function" ? value.bind(target) : value;
		},
		set(target, key, value) {
			return Reflect.set(
				target,
				key,
				key === "globalCompositeOperation" && value === "screen"
					? blend
					: value,
				target,
			);
		},
	});
	const reference = Reflect.get(window, "__lightLeakReference") as (
		ctx: unknown,
		t: number,
		amount: number,
		seed: number,
		w: number,
		h: number,
	) => void;
	check(typeof reference === "function", "Original light-leak oracle missing");
	const seconds =
		(Math.round(source.recipe!.songStartSeconds * 120000) +
			(index * 120000 * source.frameRate.denominator) /
				source.frameRate.numerator) /
		120000;
	reference(proxy, seconds * speed + timeOffset, amount, seed, width, height);
	if (coverage) {
		const image = ctx.getImageData(0, 0, width, height);
		for (let i = 0; i < coverage.length; i++)
			image.data[i * 4 + 3] = coverage[i]!;
		ctx.putImageData(image, 0, 0);
	}
	return ctx.getImageData(0, 0, width, height).data;
}

export async function verifyLightLeakPixels() {
	const base = lightLeakSource(),
		observations: Record<string, unknown> = {};
	const seen = new Map<number, Uint8ClampedArray>();
	for (const frame of [123, 2, 71, 0, 123]) {
		const actual = await capture(base, frame),
			expected = originalPixels(base, frame),
			error = difference(actual, expected);
		check(
			error.max <= 1,
			`Original seq overlay pixel mismatch ${frame}: ${JSON.stringify(error)}`,
		);
		if (seen.has(frame))
			check(
				difference(actual, seen.get(frame)!).max === 0,
				"Reverse/repeat frame changed",
			);
		seen.set(frame, actual);
		observations[`original-${frame}`] = error;
	}
	const actual = seen.get(123)!;
	for (const [name, options] of [
		["source-over", { blend: "source-over" }],
		["single-gradient", { primaryOnly: true }],
		["wrong-clock", { timeOffset: 5 }],
		["wrong-seed", { seed: 4 }],
	] as const) {
		const error = difference(actual, originalPixels(base, 123, options));
		check(error.mae > 0.05, `Negative control ${name} was invisible`);
		observations[`negative-${name}`] = error;
	}
	check(
		difference(actual, await capture(base, 123, [], 100)).max === 0,
		"Trim changed outer leak clock",
	);
	const reversed = structuredClone(base) as any;
	reversed.recipe.root = "reverse";
	reversed.recipe.nodes.push({
		id: "reverse",
		scene: {
			kind: "ref",
			input: "base",
			timeMap: [
				{ atFrame: 0, sourceFrame: 299 },
				{ atFrame: 299, sourceFrame: 0 },
			],
		},
	});
	check(
		difference(actual, await capture(reversed, 123)).max === 0,
		"Child reverse remapped post song time",
	);
	const preserved = structuredClone(base) as any;
	preserved.recipe.post[0].effects[0].alpha = "preserve";
	const keep = await capture(preserved, 123);
	check(
		difference(keep, originalPixels(preserved, 123, { alpha: "preserve" }))
			.max <= 1,
		"Preserve RGB differs from original opaque screen + coverage oracle",
	);
	check(
		keep.every((v, i) => i % 4 !== 3 || v === 128),
		"Preserve changed partial alpha",
	);
	check(
		actual.some((v, i) => i % 4 === 3 && v > 128),
		"Expand did not add coverage",
	);
	const empty = structuredClone(preserved) as any;
	empty.recipe.outputRoles = ["background"];
	check(
		(await capture(empty, 123)).every((v) => v === 0),
		"Preserve fabricated coverage for excluded role",
	);
	empty.recipe.post[0].effects[0].alpha = "expand";
	check(
		(await capture(empty, 123)).some((v, i) => i % 4 === 3 && v > 0),
		"Explicit expand must screen onto transparent composite",
	);
	const zero = structuredClone(base) as any;
	zero.recipe.post[0].effects[0].amount = 0;
	const plain = structuredClone(base) as any;
	plain.recipe.post = [];
	check(
		difference(await capture(zero, 123), await capture(plain, 123)).max === 0,
		"Zero amount was not exact identity",
	);
	const fractional = structuredClone(plain) as any;
	const grade = (delta: number) => ({
		kind: "grade",
		exposure: 0,
		contrast: 1,
		saturation: 1,
		lift: [delta, delta, delta],
		gain: [1 + delta, 1 + delta, 1 + delta],
	});
	fractional.recipe.post = [
		{
			stage: "composite",
			effects: [
				grade(0.5 / 255),
				zero.recipe.post[0].effects[0],
				grade(-0.5 / 255),
			],
		},
	];
	const noBarrier = structuredClone(fractional);
	noBarrier.recipe.post[0].effects.splice(1, 1);
	check(
		difference(await capture(fractional, 123), await capture(noBarrier, 123))
			.max === 0,
		"Zero leak split a fractional color chain and changed quantization",
	);
	fractional.recipe.post[0].effects[1].amount = 0.1;
	check(
		difference(await capture(fractional, 123), await capture(noBarrier, 123))
			.mae > 0.01,
		"Grouping incorrectly removed active leak",
	);
	const {
		source: audio,
		resource,
		expectedAmount,
	} = await lightLeakAudioFixture();
	const sound = await capture(audio, 0, [resource]);
	check(
		difference(sound, originalPixels(audio, 0, { amount: expectedAmount }))
			.max <= 1,
		"Curve then audio amount did not reach glyph-independent raster",
	);
	const ordered = structuredClone(base) as any;
	ordered.recipe.post[0].effects = [
		{ kind: "fade", amount: 0.5 },
		...ordered.recipe.post[0].effects,
	];
	const reordered = structuredClone(ordered);
	reordered.recipe.post[0].effects.reverse();
	check(
		difference(await capture(ordered, 123), await capture(reordered, 123)).mae >
			0.1,
		"Color/leak barrier lost authored order",
	);
	// Two separated roles: role-local leakage may not touch the right background.
	const divided = structuredClone(preserved) as any;
	divided.recipe.outputRoles = ["background", "foreground"];
	divided.recipe.root = "panels";
	divided.recipe.nodes.push(
		{
			id: "back",
			scene: { kind: "solid", role: "background", color: [0.1, 0.6, 0.2, 1] },
		},
		{
			id: "panels",
			scene: {
				kind: "panels",
				panels: [
					panel("base", [
						[0, 0],
						[0.5, 0],
						[0.5, 1],
						[0, 1],
					]),
					panel("back", [
						[0.5, 0],
						[1, 0],
						[1, 1],
						[0.5, 1],
					]),
				],
			},
		},
	);
	divided.recipe.post[0].stage = "role";
	divided.recipe.post[0].roles = ["foreground"];
	const local = await capture(divided, 123);
	const without = structuredClone(divided);
	without.recipe.post = [];
	const clean = await capture(without, 123);
	let rightDifference = 0,
		leftDifference = 0;
	for (let y = 2; y < 94; y++)
		for (let x = 2; x < 158; x++)
			for (let c = 0; c < 3; c++) {
				const i = (y * 160 + x) * 4 + c;
				const d = Math.abs(local[i]! - clean[i]!);
				if (x > 82) rightDifference += d;
				else if (x < 78) leftDifference += d;
			}
	check(
		rightDifference === 0 && leftDifference > 100,
		"Role light leak crossed into another role",
	);
	divided.recipe.post[0].stage = "composite";
	delete divided.recipe.post[0].roles;
	const composite = await capture(divided, 123);
	check(
		difference(composite, local).mae > 0.1,
		"Composite incorrectly behaved like foreground-only post",
	);
	observations.roleIsolation = { rightDifference, leftDifference };
	return {
		observations,
		checks: [
			"original extracted seq overlay pixels, two screen gradients, moving source clock and seed negative controls",
			"preserve/expand/zero and excluded-role coverage semantics; ordered color barrier; role/composite isolation",
			"reverse/repeat, child reverse, trim and 30000/1001 source frames; curve then verified audio response",
		],
	};
}
