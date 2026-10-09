import type {
	ProgrammaticSource,
	ResolvedProgrammaticResource,
} from "@opencut/editor-contracts";
import { resolveProgrammaticFrame } from "../../packages/editor-classic/src/services/renderer/programmatic/frame";
import { resolveMvResourceFrame } from "../../packages/editor-classic/src/services/renderer/programmatic/mv-resource-frame";
import { makeSequenceAssets } from "./image-sequence-browser-assets";
import { emberAudioFacts } from "./mv-ember-audio";
import { emberCase, emberSource } from "./mv-ember-source";
import { emberResources, check } from "./mv-ember-capture";

/** Real font advances, decoded cover and reviewed synthetic audio complete
 * together with an actual numbered PNG sequence manifest in the browser. */
export async function verifyEmberResourceFrame(
	resources: readonly ResolvedProgrammaticResource[],
) {
	const sequence = await makeSequenceAssets();
	const all = [...resources, sequence.sequence],
		audio = emberAudioFacts();
	const base = emberSource(
		emberCase("breathe", audio),
		all.map((r) => r.resource),
		{ numerator: 30000, denominator: 1001 },
	);
	const collapse = emberCase("collapse", audio, "oriented.jpeg", true);
	const panel = (input: string, left: number, right: number) => ({
		input,
		polygon: [
			[left, 0],
			[right, 0],
			[right, 1],
			[left, 1],
		] as const,
		opening: {
			span: { startFrame: 0, durationFrames: 1 },
			angle: 0,
			easing: "linear" as const,
		},
		camera: {
			motion: { startFrame: 0, durationFrames: 300 },
			from: { x: 0, y: 0, zoom: 1 },
			to: { x: 0, y: 0, zoom: 1 },
			easing: "linear" as const,
		},
	});
	const source: ProgrammaticSource = {
		...base,
		durationFrames: 301,
		resources: all
			.filter((r) =>
				[
					"ember-dot.ttf",
					"ember-analysis.json",
					"oriented.jpeg",
					sequence.sequence.resource.id,
				].includes(r.resource.id),
			)
			.map((r) => r.resource),
		recipe: {
			...base.recipe!,
			root: "mix",
			outputRoles: ["foreground", "graphics", "background"],
			nodes: [
				{
					id: "ember",
					scene: {
						kind: "ember",
						role: "foreground",
						span: { startFrame: 0, durationFrames: 300 },
						settings: emberCase("breathe", audio).settings,
					},
				},
				{
					id: "collapse",
					scene: {
						kind: "ember",
						role: "graphics",
						span: { startFrame: 0, durationFrames: 300 },
						settings: collapse.settings,
					},
				},
				{
					id: "sequence",
					scene: {
						kind: "imageSequence",
						sequence: sequence.sequence.resource.id,
						originSourceTicks: 0,
						rate: { numerator: 1, denominator: 1 },
						role: "background",
						view: { x: 0, y: 0, zoom: 1 },
					},
				},
				{
					id: "mix",
					scene: {
						kind: "panels",
						panels: [
							panel("ember", 0, 0.32),
							panel("collapse", 0.34, 0.65),
							panel("sequence", 0.67, 1),
						],
					},
				},
			],
			post: [
				{
					roles: ["foreground"],
					effects: [{ kind: "fade", amount: 0 }],
					audio: [
						{
							effect: 0,
							amount: 0.5,
							signal: {
								kind: "envelope",
								channel: "mix_rms",
								clock: "song",
								missing: "error",
							},
						},
					],
				},
			],
		},
	};
	const attached = emberResources(source, all);
	const complete = async (input: ProgrammaticSource, sampleTime: number) => {
		const initial = resolveProgrammaticFrame({
			source: input,
			clipStart: 0,
			clipDuration: 1,
			trimStart: sampleTime,
			timelineTime: 0,
		});
		check(
			initial && !initial.recipePlan && !initial.sequenceImages,
			"Joint discovery must defer complete plan and sequence selection",
		);
		check(
			initial.fontMetricRequests?.length === 1 &&
				initial.imageDimensionRequests?.length === 1,
			"Joint discovery lost font or image request",
		);
		const resolved = await resolveMvResourceFrame({
			source: input,
			frame: initial,
			resources: attached,
		});
		check(
			resolved.sampleTime === sampleTime &&
				resolved.sourceTime === Math.floor(sampleTime / 4004) * 4004,
			"Original fractional sampleTime was quantized away",
		);
		check(
			resolved.fontMetrics?.[0].advances?.length &&
				resolved.imageDimensions?.[0].width === 140 &&
				resolved.imageDimensions[0].height === 360,
			"Actual font advances or orientation-aware decoded dimensions missing",
		);
		check(
			resolved.recipePlan && resolved.sequenceImages?.length === 1,
			"Incomplete joint resource plan",
		);
		return resolved;
	};
	const direct = await complete(source, 5005);
	check(
		direct.sequenceImages![0].ordinal === 1,
		"Sequence ordinal changed at fractional trim",
	);
	const reversed = structuredClone(source);
	Reflect.set(reversed.recipe!, "root", "reverse");
	(reversed.recipe!.nodes as unknown[]).push({
		id: "reverse",
		scene: {
			kind: "ref",
			input: "mix",
			timeMap: [
				{ atFrame: 0, sourceFrame: 100 },
				{ atFrame: 100, sourceFrame: 0 },
			],
		},
	});
	const reverse = await complete(reversed, 5005),
		mapped = await complete(source, 99 * 4004);
	check(
		reverse.recipePlan!.root.kind === "ref" &&
			reverse.recipePlan!.root.sampledFrame === 99,
		"Wrong reverse child frame",
	);
	check(
		JSON.stringify(reverse.recipePlan!.root.input) ===
			JSON.stringify(mapped.recipePlan!.root),
		"Child clocks disagree with mapped standalone frame",
	);
	check(
		JSON.stringify(reverse.recipePlan!.post) ===
			JSON.stringify(direct.recipePlan!.post),
		"Ref incorrectly changed root audio post clock",
	);
	check(
		JSON.stringify(reverse.recipePlan!.post) !==
			JSON.stringify(mapped.recipePlan!.post),
		"Root audio clock negative control did not differ",
	);
	check(
		reverse.sequenceImages![0].ordinal === 79,
		"Ref changed the wrong sequence clock",
	);
	return {
		directOrdinal: 1,
		reversedOrdinal: 79,
		sampleTime: 5005,
		sourceTime: 4004,
		imageDimensions: direct.imageDimensions,
		advanceCount: direct.fontMetrics![0].advances!.length,
		fullResolution: [source.width, source.height],
		note: "Controlled authored numbered PNG sequence; not a Blender subprocess or native audio analyzer test",
	};
}
