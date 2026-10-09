import type {
	MvCloth,
	MvClothScene,
	ProgrammaticSource,
} from "@opencut/editor-contracts";
import type {
	MeshPixelComparison,
	MeshProbeContext,
	MeshProbeResult,
	MeshSnapshot,
} from "./mesh-scenes-contract";
import { assert, comparePixels, sceneSource } from "./mesh-scenes-support.mjs";
import {
	clothDifference,
	rejectClothCounterexample,
	sampleCloth,
	type ClothSampleOptions,
} from "./cloth-oracle-sampling";

const defaults = (): MvCloth => ({
	image: "mesh-a.png",
	rect: [0, 0, 1, 1],
	fit: "stretch",
	columns: 8,
	rows: 6,
	pins: "topCorners",
	gravity: 1.4,
	wind: [0.25, -0.05, 3],
	gust: 0.8,
	gustFrequency: 1.3,
	damping: 0.8,
	stretchCompliance: 0.00001,
	bendCompliance: 0.005,
	solverIterations: 8,
	perspective: 0.8,
	shading: 0.6,
	opacity: 0.82,
	events: [
		{
			atTicks: 8000,
			center: [0.6, 0.65],
			radius: 0.45,
			velocity: [1, -0.4, 2.8],
		},
	],
});
const scene = (
	settings: MvCloth,
	extra: Partial<MvClothScene> = {},
): MvClothScene => ({
	kind: "cloth",
	role: "foreground",
	settings,
	span: { startFrame: 0, durationFrames: 24 },
	...extra,
});

interface ClothEvidence {
	comparisons: MeshPixelComparison[];
	sensitivity: Record<string, number>;
	counterexamples: Record<string, number>;
	transparent: number;
	partial: number;
	frameHashes: Record<string, string>;
	neutralUnmasked: true;
	dynamicEdgeMask: string;
	cancelledRetry: true;
	geometry: Awaited<ReturnType<typeof sampleCloth>>["stats"];
}

export async function checkClothScenes({
	capture,
	resources,
	images,
}: MeshProbeContext): Promise<MeshProbeResult<ClothEvidence>> {
	const width = 192,
		height = 108,
		settings = defaults();
	const make = (
		active: MvCloth,
		seed = 19,
		extra: Partial<MvClothScene> = {},
		frameRate = { numerator: 30, denominator: 1 },
	) =>
		sceneSource(resources, scene(active, extra), {
			seed,
			durationFrames: 90,
			frameRate,
		});
	const source = make(settings),
		comparisons: MeshPixelComparison[] = [],
		snapshots: MeshSnapshot[] = [];
	const compare = async (
		label: string,
		active: MvCloth,
		frame = 12,
		{
			strict = false,
			seed = 19,
			extra = {} as Partial<MvClothScene>,
			frameRate = { numerator: 30, denominator: 1 },
		} = {},
	) => {
		const shot = make(active, seed, extra, frameRate),
			actual = await capture(shot, frame);
		const expected = await sampleCloth(
			active.image === "mesh-b.png" ? images.b : images.a,
			active,
			frame,
			width,
			height,
			{ seed, span: scene(active, extra).span, frameRate },
		);
		const result = comparePixels(actual.pixels, expected.pixels, {
			label,
			mask: expected.mask,
			maxPremul: strict ? 2 : 5,
			maxAlpha: strict ? 1 : 3,
			meanPremul: strict ? 0.4 : 1.5,
			minPixels: width * height * 0.25,
		});
		assert(
			result.coverage > 0.25,
			`${label}: insufficient independent coverage`,
		);
		comparisons.push(result);
		snapshots.push(
			{ label, width, height, pixels: actual.pixels },
			{ label: `${label} CPU`, width, height, pixels: expected.pixels },
		);
		return { actual, expected, source: shot };
	};
	const initial = await compare("Cloth initial full image", settings, 0, {
		strict: true,
	});
	const neutral: MvCloth = {
		...settings,
		gravity: 0,
		wind: [0, 0, 0],
		gust: 0,
		events: [],
		opacity: 1,
	};
	const flat = await compare("Cloth zero-force unmasked seams", neutral, 12, {
		strict: true,
	});
	assert(
		flat.expected.mask.every((value) => value === 1),
		"Cloth neutral edge masking",
	);
	await compare("Cloth opacity once", { ...neutral, opacity: 0.5 }, 12, {
		strict: true,
	});
	for (const fit of ["contain", "cover", "stretch"] as const) {
		const fitted: MvCloth = { ...neutral, fit, rect: [0.125, 0.2, 0.75, 0.5] };
		await compare(`Cloth initial ${fit}`, fitted, 0, { strict: true });
		await compare(`Cloth static ${fit}`, fitted, 12, { strict: true });
	}
	const middle = await compare("Cloth constrained wind and impulse", settings);
	for (const pins of ["topEdge", "leftEdge"] as const) {
		const pinned = await compare(`Cloth pinned ${pins}`, { ...settings, pins });
		assert(
			pinned.actual.hash !== middle.actual.hash,
			`Cloth ${pins} did not change motion`,
		);
	}
	const end = await compare(
		"Cloth persistent simulated endpoint",
		settings,
		24,
	);
	assert(
		end.actual.hash !== initial.actual.hash,
		"Cloth endpoint restored the source image",
	);
	assert(
		(await capture(source, 30)).hash === end.actual.hash,
		"Cloth span end clamp",
	);
	await compare("Cloth explicit delayed span", settings, 12, {
		extra: { span: { startFrame: 4, durationFrames: 24 } },
	});
	await compare("Cloth rational source clock", settings, 12, {
		frameRate: { numerator: 30000, denominator: 1001 },
	});
	const second = await compare("Cloth second PNG identity", {
		...settings,
		image: "mesh-b.png",
	});
	assert(
		second.actual.hash !== middle.actual.hash,
		"Cloth ignored declared image identity",
	);
	await compare("Cloth projected contain", {
		...settings,
		fit: "contain",
		rect: [0.125, 0.15, 0.75, 0.7],
	});
	const sensitivity: Record<string, number> = {};
	for (const [name, override] of [
		["gravity", { gravity: 0 }],
		["wind", { wind: [0, 0, 0] }],
		["gust", { gust: 0 }],
		["gustFrequency", { gustFrequency: 5 }],
		["damping", { damping: 10 }],
		["stretchCompliance", { stretchCompliance: 0.001 }],
		["bendCompliance", { bendCompliance: 0 }],
		["solverIterations", { solverIterations: 2 }],
		["perspective", { perspective: 0 }],
		["shading", { shading: 0 }],
		["events", { events: [] }],
	] as [string, Partial<MvCloth>][]) {
		const changed = await compare(`Cloth ${name}`, {
			...settings,
			...override,
		});
		const difference = clothDifference(middle.expected, changed.expected);
		assert(
			difference > 20 && changed.actual.hash !== middle.actual.hash,
			`Cloth ${name} has no visible effect`,
		);
		sensitivity[name] = difference;
	}
	const seeded = await compare("Cloth seeded gust", settings, 12, { seed: 27 });
	assert(
		seeded.actual.hash !== middle.actual.hash,
		"Cloth seed did not alter gust motion",
	);
	const counterexamples: Record<string, number> = {};
	for (const control of [
		"noConstraints",
		"ignoreEvents",
		"uvRadius",
	] as const) {
		const wrong = await sampleCloth(images.a, settings, 12, width, height, {
			control,
		});
		counterexamples[control] = rejectClothCounterexample(
			middle.expected,
			wrong,
			control,
		);
		assert(counterexamples[control] > 20, `Cloth fixture missed ${control}`);
	}
	const hashes = new Map<number, string>([[12, middle.actual.hash]]);
	for (const frame of [0, 18, 6, 24, 12, 6, 0]) {
		const output = await capture(source, frame);
		if (hashes.has(frame))
			assert(
				hashes.get(frame) === output.hash,
				`Cloth repeated frame ${frame}`,
			);
		else hashes.set(frame, output.hash);
	}
	assert(hashes.get(6) !== hashes.get(18), "Cloth output is static");
	assert(
		(await capture(source, 0, { trim: 48000 })).hash === middle.actual.hash,
		"Cloth trim mapping",
	);
	assert(
		(await capture(JSON.parse(JSON.stringify(source)), 12)).hash ===
			middle.actual.hash,
		"Cloth JSON restore",
	);
	assert(
		(
			await capture(
				{ ...source, recipe: { ...source.recipe, songStartSeconds: 2.25 } },
				12,
			)
		).hash === middle.actual.hash,
		"Cloth song offset changed simulation age",
	);
	const reverse: ProgrammaticSource = {
		...source,
		recipe: {
			...source.recipe,
			root: "reverse",
			nodes: [
				...source.recipe.nodes,
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
		"Cloth reverse ref moving frame",
	);
	assert(
		(await capture(reverse, 24)).hash === initial.actual.hash,
		"Cloth reverse ref initial image",
	);
	for (const active of [
		make({ ...settings, opacity: 0 }),
		{
			...source,
			recipe: { ...source.recipe, outputRoles: ["background"] as const },
		},
	]) {
		assert(
			(await capture(active, 12)).pixels.every(
				(value, i) => i % 4 !== 3 || value === 0,
			),
			"Cloth excluded role or zero opacity drew coverage",
		);
	}
	const subject = make(settings, 19, { role: "subject" });
	assert(
		(
			await capture(
				{ ...subject, recipe: { ...subject.recipe, outputRoles: ["subject"] } },
				12,
			)
		).hash === middle.actual.hash,
		"Cloth included subject role",
	);
	const controller = new AbortController();
	controller.abort();
	let cancelled = false;
	try {
		await capture(source, 12, { signal: controller.signal });
	} catch (error) {
		cancelled = /abort|cancel/i.test(String(error));
	}
	assert(cancelled, "Cloth accepted cancelled request");
	assert(
		(await capture(source, 12)).hash === middle.actual.hash,
		"Cloth cancellation polluted retry",
	);
	let transparent = 0,
		partial = 0;
	for (let i = 3; i < flat.actual.pixels.length; i += 4) {
		if (flat.actual.pixels[i] === 0) transparent++;
		else if (flat.actual.pixels[i] < 255) partial++;
	}
	assert(
		transparent > 500 && partial > 500,
		"Cloth PNG holes/half alpha not exercised",
	);
	const exportSample =
		(active: MvCloth, options: ClothSampleOptions = {}) =>
		(frame: number, w: number, h: number) =>
			sampleCloth(images.a, active, frame, w, h, options);
	const wind: MvCloth = { ...settings, events: [] };
	return {
		evidence: {
			comparisons,
			sensitivity,
			counterexamples,
			transparent,
			partial,
			frameHashes: Object.fromEntries(hashes),
			neutralUnmasked: true,
			dynamicEdgeMask:
				"1.25 px around all triangle edges, including shared diagonals",
			cancelledRetry: true,
			geometry: middle.expected.stats,
		},
		snapshots,
		exports: [
			{ name: "cloth-events", source, oracle: exportSample(settings) },
			{ name: "cloth-wind", source: make(wind), oracle: exportSample(wind) },
		],
	};
}
