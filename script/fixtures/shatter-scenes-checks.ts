import type {
	MvShatter,
	MvShatterScene,
	ProgrammaticSource,
} from "@opencut/editor-contracts";
import type {
	MeshPixelComparison,
	MeshProbeContext,
	MeshSnapshot,
} from "./mesh-scenes-contract";
import { assert, comparePixels, sceneSource } from "./mesh-scenes-support.mjs";
import {
	sampleShatter,
	shatterControlDifference,
	type ShatterCounterexample,
	type ShatterOracleFrame,
} from "./shatter-oracle";

function assertCounterexampleRejected(
	reference: ShatterOracleFrame,
	wrong: ShatterOracleFrame,
	name: string,
) {
	const mask = reference.mask.map((value, i) =>
		value && wrong.mask[i] ? 1 : 0,
	);
	assert(
		mask.filter(Boolean).length > mask.length * 0.25,
		`Shatter ${name} counterexample coverage`,
	);
	const diagnostic = Reflect.get(globalThis, "__meshScenesFailure");
	let rejected = false;
	try {
		comparePixels(wrong.pixels, reference.pixels, {
			label: `Shatter negative control ${name}`,
			mask,
			maxPremul: 5,
			maxAlpha: 3,
			meanPremul: 1.5,
			minPixels: mask.length * 0.25,
		});
	} catch {
		rejected = true;
	} finally {
		if (diagnostic === undefined)
			Reflect.deleteProperty(globalThis, "__meshScenesFailure");
		else Reflect.set(globalThis, "__meshScenesFailure", diagnostic);
	}
	assert(rejected, `Shatter ${name} would pass the actual pixel gate`);
}

const defaults = (): MvShatter => ({
	image: "mesh-a.png",
	rect: [0, 0, 1, 1],
	fit: "stretch",
	fragments: 12,
	center: [0.4, 0.6],
	spread: 0.4,
	spin: 2.4,
	gravity: 0.15,
	depth: 0.35,
	perspective: 0.8,
	refraction: 0.04,
	shading: 0.45,
	shadow: 0.3,
	opacity: 0.72,
});
const scene = (
	settings: MvShatter,
	extra: Partial<MvShatterScene> = {},
): MvShatterScene => ({
	kind: "shatter",
	role: "foreground",
	settings,
	span: { startFrame: 0, durationFrames: 24 },
	easing: "linear",
	...extra,
});

export async function checkShatterScenes({
	capture,
	resources,
	images,
}: MeshProbeContext) {
	const width = 192,
		height = 108,
		settings = defaults();
	const make = (
		settings: MvShatter,
		seed = 19,
		extra: Partial<MvShatterScene> = {},
	) =>
		sceneSource(resources, scene(settings, extra), {
			seed,
		}) as ProgrammaticSource;
	const source = make(settings),
		comparisons: MeshPixelComparison[] = [],
		snapshots: MeshSnapshot[] = [];
	const compare = async (
		label: string,
		active: MvShatter,
		frame = 12,
		{ strict = false, seed = 19, extra = {} as Partial<MvShatterScene> } = {},
	) => {
		const shot = make(active, seed, extra),
			actual = await capture(shot, frame);
		const activeScene = scene(active, extra);
		const expected = await sampleShatter(
			active.image === "mesh-b.png" ? images.b : images.a,
			active,
			frame,
			width,
			height,
			{ seed, span: activeScene.span, easing: activeScene.easing },
		);
		comparisons.push(
			comparePixels(actual.pixels, expected.pixels, {
				label,
				mask: expected.mask,
				maxPremul: strict ? 2 : 5,
				maxAlpha: strict ? 1 : 3,
				meanPremul: strict ? 0.4 : 1.5,
				minPixels: width * height * 0.25,
			}),
		);
		snapshots.push(
			{ label, width, height, pixels: actual.pixels },
			{ label: `${label} CPU`, width, height, pixels: expected.pixels },
		);
		return { actual, expected, source: shot };
	};
	const initial = await compare("Shatter initial full image", settings, 0, {
		strict: true,
	});
	const neutral: MvShatter = {
		...settings,
		spread: 0,
		spin: 0,
		gravity: 0,
		depth: 0,
		refraction: 0,
		shadow: 0,
		opacity: 1,
	};
	const flat = await compare(
		"Shatter neutral full-frame no cracks",
		neutral,
		12,
		{ strict: true },
	);
	await compare("Shatter opacity once", { ...neutral, opacity: 0.5 }, 12, {
		strict: true,
	});
	assert(
		flat.expected.mask.every((v) => v === 1),
		"Neutral Shatter must not mask shared edges",
	);
	for (const fit of ["contain", "cover", "stretch"] as const) {
		await compare(
			`Shatter neutral ${fit}`,
			{ ...neutral, fit, rect: [0.125, 0.2, 0.75, 0.5] },
			12,
			{ strict: true },
		);
		await compare(`Shatter projected ${fit}`, {
			...settings,
			fit,
			rect: [0.125, 0.2, 0.75, 0.5],
		});
	}
	await compare("Shatter source outside frame", {
		...settings,
		rect: [-0.1, -0.15, 1.3, 1.4],
	});
	const middle = await compare("Shatter motion shadows refraction", settings);
	const end = await compare(
		"Shatter persistent scattered endpoint",
		settings,
		24,
	);
	assert(
		end.actual.hash !== initial.actual.hash,
		"Shatter must not restore its input at progress one",
	);
	await compare("Shatter maximum projection", {
		...settings,
		depth: 1,
		spin: 2 * Math.PI,
		perspective: 0.8,
	});
	await compare("Shatter default density", { ...settings, fragments: 48 });
	await compare("Shatter second image identity", {
		...settings,
		image: "mesh-b.png",
	});
	await compare("Shatter explicit eased span", settings, 10, {
		extra: { span: { startFrame: 4, durationFrames: 24 }, easing: "inQuad" },
	});

	const variants: [string, Partial<MvShatter>][] = [
		["center", { center: [0.8, 0.2] }],
		["spread", { spread: 0 }],
		["spin", { spin: 0 }],
		["gravity", { gravity: 0.8 }],
		["depth", { depth: 1 }],
		["perspective", { perspective: 0 }],
		["refraction", { refraction: 0 }],
		["shading", { shading: 0 }],
		["shadow", { shadow: 0 }],
		["fragments", { fragments: 8 }],
	];
	const sensitivity: Record<string, number> = {};
	for (const [name, override] of variants) {
		const changed = await compare(`Shatter ${name}`, {
			...settings,
			...override,
		});
		const difference = shatterControlDifference(
			middle.expected,
			changed.expected,
		);
		assert(
			difference > 20 && changed.actual.hash !== middle.actual.hash,
			`Shatter ${name} has no visible effect`,
		);
		sensitivity[name] = difference;
	}
	const noRefraction = await capture(make({ ...settings, refraction: 0 }), 12);
	for (let i = 3; i < middle.actual.pixels.length; i += 4)
		assert(
			middle.actual.pixels[i] === noRefraction.pixels[i],
			"Shatter refraction changed source alpha",
		);

	const counterexamples: Record<string, number> = {};
	for (const control of ["rectangles", "noRefraction", "shiftAlpha"] as const) {
		const wrong = await sampleShatter(images.a, settings, 12, width, height, {
			control,
		});
		counterexamples[control] = shatterControlDifference(middle.expected, wrong);
		assert(counterexamples[control] > 20, `Shatter fixture missed ${control}`);
		assertCounterexampleRejected(middle.expected, wrong, control);
	}
	const overlap: MvShatter = {
		...settings,
		fragments: 8,
		spread: 0,
		gravity: 0,
		depth: 1,
		spin: 1.2,
		perspective: 0.8,
		shadow: 0.65,
		opacity: 0.85,
	};
	const depth = await compare("Shatter overlapping depth and shadow", overlap);
	for (const control of [
		"reverseDepth",
		"shadowsAfterColor",
		"affineUv",
	] as ShatterCounterexample[]) {
		const wrong = await sampleShatter(images.a, overlap, 12, width, height, {
			control,
		});
		counterexamples[control] = shatterControlDifference(depth.expected, wrong);
		assert(counterexamples[control] > 20, `Shatter fixture missed ${control}`);
		assertCounterexampleRejected(depth.expected, wrong, control);
	}
	assert(
		middle.expected.stats.nonAxisEdges > 10,
		"Shatter fixture has no nonrectangular Voronoi boundaries",
	);

	const hashes = new Map<number, string>([[12, middle.actual.hash]]);
	for (const frame of [0, 18, 6, 24, 12, 6, 0]) {
		const output = await capture(source, frame);
		if (hashes.has(frame))
			assert(
				hashes.get(frame) === output.hash,
				`Shatter repeated frame ${frame}`,
			);
		else hashes.set(frame, output.hash);
	}
	assert(hashes.get(6) !== hashes.get(18), "Shatter motion is static");
	const seeded = await compare("Shatter seeded partition", settings, 12, {
		seed: 27,
	});
	assert(
		seeded.actual.hash !== middle.actual.hash,
		"Shatter seed did not change raster pixels",
	);
	assert(
		(
			await capture(
				{ ...source, frameRate: { numerator: 30000, denominator: 1001 } },
				12,
			)
		).hash === middle.actual.hash,
		"Shatter rational fps changed the same source frame",
	);
	assert(
		(await capture(source, 0, { trim: 48000 })).hash === middle.actual.hash,
		"Shatter trim mapping",
	);
	assert(
		(await capture(JSON.parse(JSON.stringify(source)), 12)).hash ===
			middle.actual.hash,
		"Shatter JSON restore",
	);
	const reverse: ProgrammaticSource = {
		...source,
		recipe: {
			...source.recipe!,
			root: "reverse",
			nodes: [
				...source.recipe!.nodes,
				{
					id: "reverse",
					scene: {
						kind: "ref",
						input: "scene",
						timeMap: [
							{ atFrame: 0, sourceFrame: 24 },
							{ atFrame: 24, sourceFrame: 0 },
						],
					},
				},
			],
		},
	};
	assert(
		(await capture(reverse, 6)).hash === hashes.get(18),
		"Shatter reverse ref moving frame",
	);
	assert(
		(await capture(reverse, 24)).hash === initial.actual.hash,
		"Shatter reverse ref restores full image",
	);
	for (const active of [
		make({ ...settings, opacity: 0 }),
		{
			...source,
			recipe: { ...source.recipe!, outputRoles: ["background"] as const },
		},
	]) {
		const result = await capture(active, 12);
		assert(
			result.pixels.every((v, i) => i % 4 !== 3 || v === 0),
			"Shatter empty role/opacity drew coverage",
		);
	}
	const controller = new AbortController();
	controller.abort();
	let cancelled = false;
	try {
		await capture(source, 12, { signal: controller.signal });
	} catch (error) {
		cancelled = /abort|cancel/i.test(String(error));
	}
	assert(cancelled, "Shatter accepted cancelled request");
	assert(
		(await capture(source, 12)).hash === middle.actual.hash,
		"Shatter cancellation polluted retry",
	);
	let transparent = 0,
		partial = 0;
	for (let i = 3; i < flat.actual.pixels.length; i += 4) {
		if (flat.actual.pixels[i] === 0) transparent++;
		else if (flat.actual.pixels[i] < 255) partial++;
	}
	assert(
		transparent > 500 && partial > 500,
		"Shatter holes/half alpha not exercised",
	);
	return {
		evidence: {
			comparisons,
			sensitivity,
			counterexamples,
			transparent,
			partial,
			alphaInvariant: true,
			cancelledRetry: true,
			neutralUnmasked: true,
			frameHashes: Object.fromEntries(hashes),
			geometry: middle.expected.stats,
		},
		snapshots,
		exports: [
			{
				name: "shatter",
				source,
				oracle: (frame: number, w: number, h: number) =>
					sampleShatter(images.a, settings, frame, w, h),
			},
		],
	};
}
