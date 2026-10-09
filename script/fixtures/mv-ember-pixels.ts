import type {
	ProgrammaticSource,
	ResolvedProgrammaticResource,
} from "@opencut/editor-contracts";
import type { MvEmberPlan } from "../../packages/editor-contracts/src/mv-ember-plan";
import type { EmberReference } from "./mv-ember-reference-contract";
import { createEmberReference } from "./mv-ember-reference-browser";
import { emberAssets } from "./mv-ember-assets";
import { emberAnalysis, emberAudioFacts } from "./mv-ember-audio";
import { emberCase, emberSource, emberOriginalFrame } from "./mv-ember-source";
import {
	captureEmber,
	originalEmberPixels,
	check,
	difference,
} from "./mv-ember-capture";
import { emberNegativeControls } from "./mv-ember-controls";
import { emberDiagnostics } from "./mv-ember-diagnostics";
import { display } from "./mv-type-card-pixels";

export async function verifyEmberPixels(
	reference: EmberReference,
	assets: Awaited<ReturnType<typeof emberAssets>>,
	diagnosticOnly = false,
) {
	const observations: Record<string, unknown> = {},
		provenance: unknown[] = [],
		violations: string[] = [];
	const progress = {
		stage: "pixels",
		current: "start",
		observations,
		provenance,
		violations,
	};
	Reflect.set(globalThis, "__mvEmberProgress", progress);
	const diagnostic = emberDiagnostics();
	const compare = async (
		label: string,
		source: ProgrammaticSource,
		resources: readonly ResolvedProgrammaticResource[],
		oracle: Awaited<ReturnType<typeof createEmberReference>>,
		test: ReturnType<typeof emberCase>,
		index: number,
		show = false,
	) => {
		progress.current = label;
		let plan: MvEmberPlan | undefined;
		const actual = await captureEmber(source, resources, index, {
			observe: (value) => {
				plan = value;
			},
		});
		const expected = await originalEmberPixels(
			oracle,
			emberOriginalFrame(test, source, index),
		);
		const error = difference(actual, expected.pixels);
		observations[label] = error;
		if (error.max > 2 || error.mae >= 0.025) {
			if (!violations.includes(label)) violations.push(label);
			observations[label] = {
				...error,
				diagnostic: await diagnostic(
					label,
					actual,
					expected.pixels,
					source,
					plan,
					expected.provenance,
				),
			};
		}
		if (show) {
			display(actual, expected.pixels, `ember ${label}`);
			provenance.push(expected.provenance);
		}
		return actual;
	};
	const baseAudio = emberAudioFacts(),
		analysis = await emberAnalysis(baseAudio);
	const resources = [
		assets.font.resolved,
		...assets.images.map((image) => image.resolved),
		analysis,
	];
	const oracle = await createEmberReference({
		reference,
		audio: baseAudio,
		font: assets.font.asset,
		images: assets.images.map((image) => image.asset),
	});
	try {
		for (const mode of ["breathe", "ignite", "collapse"] as const) {
			const test = emberCase(mode, baseAudio),
				source = emberSource(
					test,
					resources.map((r) => r.resource),
				);
			const indices =
				mode === "breathe"
					? [57, 0, 1, 3, 12, 34, 35, 38, 39, 58, 64, 95, 96, 110, 130, 57]
					: mode === "ignite"
						? [90, 0, 1, 4, 18, 60, 70, 71, 75, 120, 135, 140, 150, 90]
						: [75, 0, 1, 15, 30, 54, 60, 66, 75, 90, 114, 115, 119, 120, 75];
			let first: Uint8ClampedArray | undefined;
			for (const index of diagnosticOnly
				? [indices[0], 0, indices[indices.length - 3]]
				: indices) {
				const actual = await compare(
					`${mode}-${index}`,
					source,
					resources,
					oracle,
					test,
					index,
					index === indices[0] && !first,
				);
				if (index === indices[0]) {
					if (first)
						check(
							difference(first, actual).max === 0,
							`${mode} nonmonotonic repeat changed`,
						);
					first = actual;
				}
			}
			if (diagnosticOnly) continue;
			const index = indices[0];
			check(
				difference(
					first!,
					await captureEmber(source, resources, index, {
						trim: 1,
						fractionalTrim: 17,
					}),
				).max === 0,
				`${mode} trim changed source frame`,
			);
			const reverse = structuredClone(source);
			Reflect.set(reverse.recipe!, "root", "reverse");
			(reverse.recipe!.nodes as unknown[]).push({
				id: "reverse",
				scene: {
					kind: "ref",
					input: "ember",
					timeMap: [
						{ atFrame: 0, sourceFrame: source.durationFrames - 1 },
						{ atFrame: source.durationFrames - 1, sourceFrame: 0 },
					],
				},
			});
			check(
				difference(
					first!,
					await captureEmber(
						reverse,
						resources,
						source.durationFrames - 1 - index,
					),
				).max === 0,
				`${mode} ref clock mismatch`,
			);
			observations[`${mode}-negative`] = await emberNegativeControls(
				source,
				resources,
				index,
			);
			const boundary = emberSource(
				test,
				resources.map((r) => r.resource),
				{ numerator: 100, denominator: 1 },
			);
			const boundaryIndices =
				mode === "breathe"
					? [
							39, 40, 41, 114, 115, 116, 129, 130, 131, 194, 195, 196, 212, 213,
							214, 222, 223, 224,
						]
					: mode === "ignite"
						? [233, 234, 235, 493, 494, 495]
						: [379, 380, 381, 382, 383, 384, 399, 400];
			for (const at of boundaryIndices)
				await compare(
					`${mode}-boundary-${at}`,
					boundary,
					resources,
					oracle,
					test,
					at,
				);
			const fractional = emberSource(
				test,
				resources.map((r) => r.resource),
				{ numerator: 30000, denominator: 1001 },
			);
			await compare(
				`${mode}-fractional`,
				fractional,
				resources,
				oracle,
				test,
				index,
			);
		}
		if (!diagnosticOnly) {
			for (const image of assets.images) {
				const test = emberCase("collapse", baseAudio, image.asset.id, true),
					source = emberSource(
						test,
						resources.map((r) => r.resource),
					);
				for (const index of [15, 60, 75, 110, 120])
					await compare(
						`manual-${image.asset.id.split(".")[0]}-${index}`,
						source,
						resources,
						oracle,
						test,
						index,
						index === 75,
					);
			}
			for (const [label, options] of [
				["vocal", { vocal: true }],
				["fallback-order", { fallback: true }],
				["sparse", { sparse: true }],
			] as const) {
				const audio = emberAudioFacts(options),
					variantResources = [
						...resources.slice(0, -1),
						await emberAnalysis(audio),
					];
				const variantOracle = await createEmberReference({
					reference,
					audio,
					font: assets.font.asset,
					images: assets.images.map((image) => image.asset),
				});
				try {
					for (const mode of (label === "vocal"
						? ["breathe"]
						: label === "fallback-order"
							? ["collapse"]
							: ["ignite", "collapse"]) as (
						| "breathe"
						| "ignite"
						| "collapse"
					)[]) {
						const test = emberCase(mode, audio),
							source = emberSource(
								test,
								variantResources.map((r) => r.resource),
							);
						for (const index of [60, 90])
							await compare(
								`${label}-${mode}-${index}`,
								source,
								variantResources,
								variantOracle,
								test,
								index,
							);
					}
				} finally {
					variantOracle.dispose();
				}
			}
		}
		return {
			passed: violations.length === 0,
			violations,
			observations,
			provenance,
			diagnosticOnly,
			thresholds: { maxChannel: 2, rgbaMaeLessThan: 0.025 },
			checks: diagnosticOnly
				? [
						"Diagnostic only: nine 1920x1080 frame comparisons at 30fps against the unmodified original Ember scene",
						"Breathe frames 57/0/110; ignite frames 90/0/140; collapse frames 75/0/119",
						"Base reviewed synthetic audio, explicit HUD font, landscape image and automatic collapse keys",
					]
				: [
						"Unmodified full original Ember three-mode pixel oracle",
						"Positive t0, stops/blackFrom/crack/land/end boundaries, nonmonotonic repeats, ref/trim/rational fps",
						"Explicit HUD/font/macron, reviewed synthetic envelope fixtures, auto/manual unsorted keys, landscape/portrait/EXIF cover",
						"Omitted-grain/shimmer/HUD/crack/image/path and wrong-clock negative controls",
					],
		};
	} finally {
		oracle.dispose();
	}
}
