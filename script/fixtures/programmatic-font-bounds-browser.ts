import type {
	ProgrammaticResource,
	ProgrammaticSource,
} from "@opencut/editor-contracts";
import type {
	FontBoundsRequest,
	FontMetricRequest,
} from "../../packages/editor-classic/src/services/renderer/programmatic/font-metrics-contract";
import type { ProgrammaticFrame } from "../../packages/editor-classic/src/services/renderer/programmatic/frame";
import { runProgrammaticSandbox } from "../../packages/editor-classic/src/services/renderer/programmatic/sandbox-runtime";
import { assertFontAdvanceOracle as check } from "./programmatic-font-advance-oracle";
import { inspectFontBoundsOracle } from "./programmatic-font-bounds-oracle";

export async function runFontBoundsBrowserOracle(bytes: ArrayBuffer) {
	const sha256 = [
		...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
	]
		.map((v) => v.toString(16).padStart(2, "0"))
		.join("");
	const bound = (
		change: Partial<FontBoundsRequest> = {},
	): FontBoundsRequest => ({
		version: 1,
		text: "AV残",
		fontSizePx: 1000,
		letterSpacingPx: 0,
		align: "left",
		baseline: "alphabetic",
		...change,
	});
	const bounds = [
		bound({ text: "残" }),
		bound({ text: "光" }),
		...(["left", "center", "right"] as const).flatMap((align) =>
			(
				[
					"top",
					"hanging",
					"middle",
					"alphabetic",
					"ideographic",
					"bottom",
				] as const
			).map((baseline) => bound({ align, baseline })),
		),
		bound({ letterSpacingPx: 12.3 }),
		bound({ letterSpacingPx: -4.6 }),
		bound({
			text: "A\u0301",
			fontSizePx: 34,
			letterSpacingPx: 1.3,
			align: "center",
			baseline: "middle",
		}),
		bound({ text: "", fontSizePx: 18 }),
		bound({ text: " ", fontSizePx: 18 }),
	];
	const iframeCount = document.querySelectorAll("iframe").length;
	const observations = [];
	for (const axis of [100, 900, 100]) {
		const makeResource = (id: string, value: number): ProgrammaticResource => ({
			id,
			kind: "font",
			attachmentKey: "fixtures/bounds.ttf",
			mimeType: "font/ttf",
			byteLength: bytes.byteLength,
			sha256,
			font: { family: id, weight: 900, style: "normal", axes: { TEST: value } },
		});
		const resources = [
			makeResource("BoundsFixture", axis),
			makeResource("LegacyAfterBounds", 100),
		];
		const source: ProgrammaticSource = {
			version: 1,
			runtime: "canvas-worker",
			code: "throw Error('Bounds measurement executed author code')",
			width: 32,
			height: 32,
			frameRate: { numerator: 30, denominator: 1 },
			durationFrames: 30,
			seed: 0,
			resources,
		};
		const frame: ProgrammaticFrame = {
			index: 0,
			time: 0,
			sourceTime: 0,
			timelineTime: 0,
			frameRate: source.frameRate,
			durationFrames: 30,
			seed: 0,
			fontMetricRequests: [
				{
					resource: resources[0]!,
					glyphs: ["残", "光", "A", " "],
					advances: [{ text: "AV残", fontSizePx: 22, letterSpacingPx: 4 }],
					bounds,
				},
				{ resource: resources[1]!, glyphs: ["残", "光", "A", " "] },
			],
		};
		const request = {
			source,
			frame,
			resources: resources.map((resource) => ({ resource, body: bytes })),
			operation: "measure-fonts" as const,
		};
		const actual = await runProgrammaticSandbox(request);
		observations.push({
			axis,
			...(await inspectFontBoundsOracle({
				bytes,
				resources,
				requests: frame.fontMetricRequests!,
				actual,
			})),
		});
		const reversed = frame.fontMetricRequests!.map((r) => ({
			...r,
			bounds: r.bounds ? [...r.bounds].reverse() : undefined,
		}));
		const repeated = await runProgrammaticSandbox({
			...request,
			frame: { ...frame, fontMetricRequests: reversed },
		});
		check(
			JSON.stringify(repeated[0]!.bounds) ===
				JSON.stringify([...actual[0]!.bounds!].reverse()),
			"Bounds inherited ordering or prior measurement state",
		);
		if (axis !== 100 || observations.length !== 1) continue;
		const rejects = async (
			requests: readonly FontMetricRequest[],
			pattern: RegExp,
		) => {
			try {
				await runProgrammaticSandbox({
					...request,
					frame: { ...frame, fontMetricRequests: requests },
				});
			} catch (error) {
				check(
					pattern.test(String(error)),
					`Wrong bounds rejection: ${String(error)}`,
				);
				return;
			}
			throw Error(`Bounds should reject ${pattern}`);
		};
		const first = frame.fontMetricRequests![0]!;
		await rejects(
			[
				{
					...first,
					bounds: [bound({ align: "start" as FontBoundsRequest["align"] })],
				},
			],
			/Invalid font bounds request/,
		);
		await rejects(
			[{ ...first, bounds: [bound(), bound({ letterSpacingPx: -0 })] }],
			/Duplicate requested font bounds/,
		);
		await rejects(
			[
				{
					...first,
					resource: {
						...first.resource,
						font: { ...first.resource.font!, axes: { TEST: 900 } },
					},
				},
			],
			/identical declared loaded font/,
		);
	}
	check(
		JSON.stringify(observations[0]) === JSON.stringify(observations[2]),
		"Bounds repeat inherited earlier custom axis",
	);
	check(
		JSON.stringify(observations[0]!.bounds) !==
			JSON.stringify(observations[1]!.bounds),
		"Bounds ignored the declared custom variation axis",
	);
	check(
		document.querySelectorAll("iframe").length === iframeCount,
		"Bounds measurement leaked sandbox iframe",
	);
	return {
		passed: true,
		observations,
		checks: [
			"real native 1000px alphabetic ink bounds",
			"independent HTMLCanvas and OffscreenCanvas oracles",
			"all physical alignments and Canvas baselines",
			"positive/negative fractional tracking",
			"legacy 100px glyph/advance reset",
			"full identity and custom axis sensitivity",
			"reverse/repeat isolation",
			"invalid context/duplicate/axis rejection",
			"no author execution or leaked iframe",
		],
	};
}
