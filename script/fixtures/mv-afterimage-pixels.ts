import type {
	ProgrammaticSource,
	ResolvedProgrammaticResource,
} from "@opencut/editor-contracts";
import type { createAfterimageReference } from "./mv-afterimage-reference-browser";
import { capture, check, difference, pixels } from "./mv-afterimage-capture";

export type AfterimageOracle = Awaited<
	ReturnType<typeof createAfterimageReference>
>;
export async function originalPixels(oracle: AfterimageOracle, index: number) {
	const result = await oracle.render({
		time: 12.25 + index / 60,
		shotStart: 12.25,
		duration: 3,
	});
	try {
		return pixels(result.bitmap, 1920, 1080);
	} finally {
		result.bitmap.close();
		result.canvas.width = result.canvas.height = 1;
	}
}
function display(
	actual: Uint8ClampedArray,
	expected: Uint8ClampedArray,
	index: number,
) {
	let view = document.getElementById("comparison");
	if (!view) {
		view = document.createElement("div");
		view.id = "comparison";
		document.body.append(view);
	}
	view.replaceChildren();
	const label = document.createElement("h2");
	label.textContent = `afterimage frame ${index}: original / Rocut / difference × 16`;
	view.append(label);
	const delta = new Uint8ClampedArray(actual.length);
	for (let i = 0; i < delta.length; i++)
		delta[i] =
			i % 4 === 3
				? 255
				: Math.min(255, Math.abs(actual[i]! - expected[i]!) * 16);
	for (const data of [expected, actual, delta]) {
		const canvas = document.createElement("canvas");
		canvas.width = 1920;
		canvas.height = 1080;
		canvas.style.width = "640px";
		canvas.style.height = "360px";
		canvas
			.getContext("2d")!
			.putImageData(
				new ImageData(new Uint8ClampedArray(data), 1920, 1080),
				0,
				0,
			);
		view.append(canvas);
	}
}
export async function verifyAfterimagePixels(
	source: ProgrammaticSource,
	resources: readonly ResolvedProgrammaticResource[],
	oracle: AfterimageOracle,
) {
	const observations: Record<string, unknown> = {},
		seen = new Map<number, Uint8ClampedArray>();
	for (const index of [30, 0, 1, 6, 93, 94, 120, 170, 30]) {
		const actual = await capture(source, resources, index),
			expected = await originalPixels(oracle, index);
		const error = difference(actual, expected);
		observations[`original-${index}`] = error;
		display(actual, expected, index);
		check(
			error.max <= 2 && error.mae < 0.025,
			`Full original afterimage mismatch ${index}: ${JSON.stringify(error)}`,
		);
		if (seen.has(index))
			check(
				difference(actual, seen.get(index)!).max === 0,
				"Repeated/reversed afterimage changed pixels",
			);
		seen.set(index, actual);
	}
	const base = seen.get(30)!;
	check(
		difference(base, await capture(source, resources, 30, 20)).max === 0,
		"Trim changed source/scene time",
	);
	const reversed = structuredClone(source);
	Reflect.set(reversed.recipe!, "root", "reverse");
	(reversed.recipe!.nodes as unknown[]).push({
		id: "reverse",
		scene: {
			kind: "ref",
			input: "after",
			timeMap: [
				{ atFrame: 0, sourceFrame: 179 },
				{ atFrame: 179, sourceFrame: 0 },
			],
		},
	});
	check(
		difference(base, await capture(reversed, resources, 149)).max === 0,
		"Ref did not remap afterimage song/scene clock",
	);
	const role = structuredClone(source);
	Reflect.set(role.recipe!, "outputRoles", ["subject"]);
	check(
		(await capture(role, resources, 30)).every((v) => v === 0),
		"Excluded role leaked pixels",
	);
	for (const [name, mutate] of [
		[
			"no-blur",
			(data: any) => {
				for (const raster of data.rasters) raster.blur = 0;
			},
		],
		[
			"sharp-only",
			(data: any) => {
				data.layers = data.layers.filter(
					(layer: any) => layer.raster === "sharp",
				);
			},
		],
		[
			"no-cutout",
			(data: any) => {
				data.mask.cutout.rect = [-4096, -4096, 1, 1];
			},
		],
		[
			"no-grain",
			(data: any) => {
				data.grain = null;
			},
		],
		[
			"no-motion",
			(data: any) => {
				data.transform = [1, 0, 0, 1, 0, 0];
			},
		],
	] as const) {
		const error = difference(
			base,
			await capture(source, resources, 30, 0, mutate),
		);
		check(
			error.mae > 0.002 && error.changed > 100,
			`Negative control ${name} invisible: ${JSON.stringify(error)}`,
		);
		observations[`negative-${name}`] = error;
	}
	const credit = difference(
		seen.get(94)!,
		await capture(source, resources, 94, 0, (data) => {
			Reflect.set(data.credit, "opacity", 0);
		}),
	);
	check(
		credit.mae > 0.002 && credit.changed > 100,
		"Credit negative control invisible",
	);
	observations["negative-credit"] = credit;
	const clock = difference(base, await originalPixels(oracle, 42));
	check(clock.mae > 0.1, "Wrong clock negative control invisible");
	observations["negative-clock"] = clock;
	const seeded = structuredClone(source);
	Reflect.set(seeded, "seed", 17);
	const a = await capture(seeded, resources, 30),
		b = await capture(seeded, resources, 30);
	check(
		difference(a, b).max === 0 && difference(a, base).mae > 0.002,
		"Seed ignored or nondeterministic",
	);
	const small = {
		...source,
		width: 384,
		height: 216,
		frameRate: { numerator: 30000, denominator: 1001 },
	};
	const first = await capture(small, resources, 24),
		second = await capture(small, resources, 24, 10);
	check(
		difference(first, second).max === 0 &&
			first.some((v, i) => i % 4 !== 3 && v > 10),
		"Fractional fps/smaller canvas failed",
	);
	const missing = resources.filter((r) => r.resource.id !== "title");
	let rejected = false;
	try {
		await capture(source, missing, 30);
	} catch {
		rejected = true;
	}
	check(rejected, "Missing declared font silently fell back");
	display(base, await originalPixels(oracle, 30), 30);
	return {
		observations,
		checks: [
			"Actual original 1920x1080 scene, explicit matching font bytes, cutout, five ghost rasters, rise/blink/decay/end and credit",
			"Reverse/repeat, trim, ref clock, roles, seed and 30000/1001 small-canvas behavior",
			"Independent oracle plus wrong clock / missing blur, layer, cutout, grain, motion and credit negative controls; missing-font failure",
		],
	};
}
