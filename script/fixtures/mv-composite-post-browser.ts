import type {
	MvEffect,
	MvRecipe,
	MvRole,
	ProgrammaticSource,
	ResolvedProgrammaticResource,
} from "@opencut/editor-contracts";
import {
	assertPost as assert,
	postAt as at,
	postCapture,
	postHash,
	postPixels,
	postResource,
	postSource,
	spatialEffects,
} from "./mv-post-fixture";
import { runMvExportProbe } from "./mv-recipe-export-probe";

type Post = NonNullable<MvRecipe["post"]>;
const allRoles: readonly MvRole[] = [
	"foreground",
	"graphics",
	"subject",
	"background",
];
const bloom: Extract<MvEffect, { kind: "bloom" }> = {
	kind: "bloom",
	amount: 1,
	threshold: 0.75,
	radius: 3,
	alpha: "expand",
};
const grade = (exposure: number, lift = 0): MvEffect => ({
	kind: "grade",
	exposure,
	contrast: 1,
	saturation: 1,
	lift: [lift, lift, lift],
	gain: [1, 1, 1],
});
function source(
	resources: ResolvedProgrammaticResource[],
	post: Post = [],
	outputRoles = allRoles,
): ProgrammaticSource {
	const base = postSource(resources);
	const pose = { x: 0.5, y: 0.5, height: 1, rotation: 0, opacity: 1 };
	return {
		...base,
		recipe: {
			...base.recipe!,
			outputRoles,
			post,
			nodes: [
				{
					id: "shot",
					scene: {
						kind: "illust",
						motion: { startFrame: 0, durationFrames: 24 },
						easing: "linear",
						sprites: resources.map((r, index) => ({
							image: r.resource.id,
							role: index === 0 ? "background" : "foreground",
							from: pose,
							to: pose,
							anchor: [0.5, 0.5],
						})),
					},
				},
			],
		},
	};
}

async function run() {
	const checks: string[] = [],
		observations: Record<string, unknown> = {};
	const sheet = document.createElement("canvas");
	sheet.width = 640;
	sheet.height = 320;
	const sheetContext = sheet.getContext("2d")!;
	sheetContext.fillStyle = "#ddd";
	sheetContext.fillRect(0, 0, 640, 320);
	document.body.append(sheet);
	let captures = 0,
		cells = 0;
	const capture = async (
		s: ProgrammaticSource,
		resources: ResolvedProgrammaticResource[],
		index = 0,
		label?: string,
	) => {
		const bitmap = await postCapture(s, resources, index);
		captures++;
		try {
			if (label) {
				const x = (cells % 5) * 128,
					y = Math.floor(cells / 5) * 160;
				cells++;
				sheetContext.fillStyle = "#ddd";
				sheetContext.fillRect(x, y, 128, 160);
				sheetContext.fillStyle = "black";
				sheetContext.font = "10px sans-serif";
				sheetContext.fillText(label, x + 2, y + 13);
				sheetContext.drawImage(bitmap, x, y + 20, 128, 128);
			}
			return postPixels(bitmap);
		} finally {
			bitmap.close();
		}
	};
	const square = (color: string, x = 24, width = 16) =>
		postResource(`square-${color.replace(/\W/g, "")}-${x}.png`, (c) => {
			c.fillStyle = color;
			c.fillRect(x, 24, width, 16);
		});
	const white = await square("white"),
		black = await square("black"),
		translucent = await square("rgba(0,0,0,0.5)");
	const roleBloom: Post = [{ roles: allRoles, effects: [bloom] }];
	const compositeBloom: Post = [{ stage: "composite", effects: [bloom] }];

	// Independent occlusion oracle: an entirely covered white emitter contributes
	// no visible bright pixels. Bloom after compositing must therefore emit zero.
	const covered = [white, black];
	const coveredRaw = await capture(
		source(covered),
		covered,
		0,
		"opaque cover: raw",
	);
	const coveredRole = await capture(
		source(covered, roleBloom),
		covered,
		0,
		"role bloom: leaks halo",
	);
	const coveredComposite = await capture(
		source(covered, compositeBloom),
		covered,
		0,
		"composite: no emitter",
	);
	assert(
		at(coveredRaw, 32, 32).join() === "0,0,0,255",
		"Independent black occluder baseline is wrong",
	);
	assert(
		at(coveredRaw, 21, 32)[3] === 0 && at(coveredRole, 21, 32)[3] > 0,
		"Role bloom did not expose hidden emitter halo",
	);
	assert(
		(await postHash(coveredComposite)) === (await postHash(coveredRaw)),
		"Composite bloom sees an occluded role before compositing",
	);
	observations.covered = {
		raw: at(coveredRaw, 21, 32),
		role: at(coveredRole, 21, 32),
		composite: at(coveredComposite, 21, 32),
	};
	checks.push(
		"opaque foreground hides background emitter before composite bloom; all-role bloom remains observably different",
	);

	// White source-over by 50% black produces 127..128 gray, below 0.75. This
	// expectation uses source-over arithmetic, not the implementation shader.
	const dimmed = [white, translucent];
	const dimRaw = await capture(source(dimmed), dimmed);
	const dimRole = await capture(source(dimmed, roleBloom), dimmed);
	const dimComposite = await capture(source(dimmed, compositeBloom), dimmed);
	assert(
		at(dimRaw, 32, 32)
			.slice(0, 3)
			.every((v) => v >= 127 && v <= 128),
		"Independent half-black source-over threshold baseline failed",
	);
	assert(
		at(dimRole, 21, 32)[3] > 0,
		"Role bloom unexpectedly uses composite brightness",
	);
	assert(
		(await postHash(dimComposite)) === (await postHash(dimRaw)),
		"Composite threshold did not use blended brightness",
	);
	observations.threshold = {
		blended: at(dimRaw, 32, 32),
		roleHalo: at(dimRole, 21, 32),
		compositeHalo: at(dimComposite, 21, 32),
	};
	checks.push(
		"composite brightness threshold uses visible blended gray, not per-role white brightness",
	);

	// An exposed emitter on the left must cast a halo over an opaque foreground
	// on the right. Role bloom is occluded there; final composite bloom is not.
	const half = await square("black", 32, 8),
		shared = [white, half];
	const sharedRaw = await capture(source(shared), shared);
	const sharedRole = await capture(
		source(shared, roleBloom),
		shared,
		0,
		"role: black foreground",
	);
	const sharedComposite = await capture(
		source(shared, compositeBloom),
		shared,
		0,
		"composite: shared halo",
	);
	assert(
		at(sharedRole, 35, 32).join() === "0,0,0,255",
		"Foreground occlusion did not cover role-local halo",
	);
	assert(
		at(sharedComposite, 35, 32)
			.slice(0, 3)
			.every((v) => v > 3) && at(sharedComposite, 35, 32)[3] === 255,
		"Composite bloom failed to spread visible light across role boundary",
	);
	const preserve = await capture(
		source(shared, [
			{ stage: "composite", effects: [{ ...bloom, alpha: "preserve" }] },
		]),
		shared,
	);
	for (let i = 3; i < sharedRaw.length; i += 4)
		assert(
			preserve[i] === sharedRaw[i],
			"Composite preserve mode changed blended alpha",
		);
	observations.sharedHalo = {
		role: at(sharedRole, 35, 32),
		composite: at(sharedComposite, 35, 32),
	};
	checks.push(
		"composite halo spreads onto opaque foreground after role occlusion; preserve mode retains composed alpha",
	);

	const selectedForeground = await capture(
		source(covered, compositeBloom, ["foreground"]),
		covered,
	);
	const selectedBackground = await capture(
		source(covered, compositeBloom, ["background"]),
		covered,
	);
	assert(
		at(selectedForeground, 21, 32)[3] === 0 &&
			at(selectedBackground, 21, 32)[3] > 0,
		"Composite stage included a role excluded by outputRoles",
	);
	checks.push(
		"output-role selection is applied before composite post; no implicit hidden-role contribution",
	);

	const gray = await postResource("gray.png", (c) => {
		c.fillStyle = "#333333";
		c.fillRect(0, 0, 64, 64);
	});
	const green = await square("#006600"),
		colors = [gray, green];
	const staged: Post = [
		{ stage: "composite", effects: [grade(-1)] },
		{ roles: ["background"], effects: [grade(0, 0.25)] },
	];
	const ordered = await capture(
		source(colors, staged),
		colors,
		0,
		"role then composite",
	);
	// Background: 0.2 -> 0.25 + 0.2*0.75 = 0.4 -> 0.2. Foreground bypasses
	// role grading, then halves its 0.4 green. Reversed staging yields 0.325 gray.
	assert(
		at(ordered, 4, 4).join() === "51,51,51,255",
		`Role/composite order: ${at(ordered, 4, 4)}`,
	);
	assert(
		at(ordered, 32, 32).join() === "0,51,0,255",
		"Role grading leaked into the foreground",
	);
	const consecutive: Post = [
		{ stage: "composite", effects: [grade(0, 0.25), grade(-1)] },
	];
	const split: Post = [
		{ stage: "composite", effects: [grade(0, 0.25)] },
		{ roles: ["subject"], effects: [grade(2)] },
		{ stage: "composite", effects: [grade(-1)] },
	];
	assert(
		(await postHash(await capture(source(colors, consecutive), colors))) ===
			(await postHash(await capture(source(colors, split), colors))),
		"Composite group relative order changed across interleaved role groups",
	);
	const explicit: Post = [{ stage: "role", roles: allRoles, effects: [bloom] }];
	assert(
		(await postHash(await capture(source(shared, explicit), shared))) ===
			(await postHash(sharedRole)),
		"Omitted stage changed legacy role semantics",
	);
	checks.push(
		"role post precedes composite post regardless of array interleaving; same-stage order and omitted role defaults preserved",
	);

	const palette: MvEffect = {
		kind: "palette",
		colors: [
			[0.1, 0.05, 0.2, 1],
			[0.9, 0.85, 1, 1],
		],
		mix: 0.2,
	};
	const fullPost: Post = [
		{ roles: ["foreground"], effects: [grade(-0.25)] },
		{ stage: "composite", effects: spatialEffects },
		{
			stage: "composite",
			effects: [
				grade(0.1),
				palette,
				{ kind: "vignette", amount: 0.2 },
				{ kind: "grain", amount: 0.2, fps: 12 },
			],
		},
	];
	const fullSource = source(colors, fullPost);
	const frame0 = await capture(fullSource, colors, 0, "all nine effects");
	const frame8 = await capture(fullSource, colors, 8);
	assert(
		(await postHash(frame0)) !== (await postHash(frame8)),
		"Composite sampled effects ignored the frame clock",
	);
	assert(
		(await postHash(frame0)) ===
			(await postHash(
				await capture(JSON.parse(JSON.stringify(fullSource)), colors, 0),
			)),
		"Composite serialization/reverse seek changed exact pixels",
	);
	assert(
		document.querySelectorAll("iframe").length === 0,
		"Composite capture left a sandbox behind",
	);
	checks.push(
		"all nine existing effects execute through real mixed CPU/WebGL composite pipeline; serialization and reverse seek exact",
	);
	const exported = await runMvExportProbe(fullSource, colors);
	return {
		passed: true,
		captures,
		observations,
		checks: [...checks, ...exported.checks],
		encodedBytes: exported.encodedBytes,
		sheet: sheet.toDataURL("image/png"),
		scope:
			"Recipe-internal selected roles only; no external JIZURA or other timeline graphics",
	};
}
void run().then(
	(result) => Reflect.set(globalThis, "__mvCompositePost", result),
	(error) =>
		Reflect.set(globalThis, "__mvCompositePost", {
			error: String(error?.stack ?? error),
		}),
);
