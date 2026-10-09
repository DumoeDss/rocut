import type {
	ProgrammaticResource,
	ProgrammaticSource,
} from "@opencut/editor-contracts";
import type { FontAdvanceRequest } from "../../packages/editor-classic/src/services/renderer/programmatic/font-metrics-contract";
import type { ProgrammaticFrame } from "../../packages/editor-classic/src/services/renderer/programmatic/frame";
import { runProgrammaticSandbox } from "../../packages/editor-classic/src/services/renderer/programmatic/sandbox-runtime";
import {
	assertFontAdvanceOracle as check,
	inspectFontAdvanceOracle,
} from "./programmatic-font-advance-oracle";

/** Independent main-thread Canvas oracle; neither expected widths nor prefixes
 * come from the Rust bridge/worker. Uses the probe's actual OFL variable font.
 */
export async function runFontAdvanceBrowserOracle(bytes: ArrayBuffer) {
	const sha256 = [
		...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
	]
		.map((v) => v.toString(16).padStart(2, "0"))
		.join("");
	const scalars = [..."残光 / ZANKO"],
		prefixes = scalars.map((_, n) => scalars.slice(0, n + 1).join(""));
	const advance = (
		text: string,
		fontSizePx: number,
		letterSpacingPx = 0,
	): FontAdvanceRequest => ({ text, fontSizePx, letterSpacingPx });
	const candidates = [
		"AV",
		"VA",
		"To",
		"Ta",
		"WA",
		"Yo",
		"office",
		"ffi",
		"fi",
	];
	const requests = [
		advance("", 22),
		...prefixes.map((text) => advance(text, 22)),
		advance("O", 22),
		advance("17:42:03", 18),
		advance("A\u0301V", 22),
		advance("静", 22),
		...["𠮷", "𠮷A", "𠮷A\u0301"].map((text) => advance(text, 22)),
		advance(" ", 22),
		advance("AV", 18),
		advance("AV", 22, 1.25),
		advance("AV", 22, -0.5),
		...candidates.map((text) => advance(text, 72)),
	];
	const iframeCount = document.querySelectorAll("iframe").length;
	const observations: {
		axis: number;
		widths: number[];
		shaped: { text: string; width: number; sum: number }[];
	}[] = [];
	for (const axis of [100, 900, 100]) {
		const makeResource = (id: string, value: number): ProgrammaticResource => ({
			id,
			kind: "font",
			attachmentKey: "fixtures/advance.ttf",
			mimeType: "font/ttf",
			byteLength: bytes.byteLength,
			sha256,
			font: { family: id, weight: 400, style: "normal", axes: { TEST: value } },
		});
		const resources = [
			makeResource("AdvanceFixture", axis),
			makeResource("LegacyAfterAdvance", 100),
		];
		const source: ProgrammaticSource = {
			version: 1,
			runtime: "canvas-worker",
			code: "throw Error('Measurement executed author code')",
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
			timelineTime: 0,
			sourceTime: 0,
			frameRate: source.frameRate,
			durationFrames: 30,
			seed: 0,
			fontMetricRequests: [
				{ resource: resources[0]!, glyphs: ["A", " "], advances: requests },
				{ resource: resources[1]!, glyphs: ["A", "f", "静", " "] },
			],
		};
		const actual = await runProgrammaticSandbox({
			source,
			frame,
			resources: resources.map((resource) => ({ resource, body: bytes })),
			operation: "measure-fonts",
		});
		observations.push({
			axis,
			...(await inspectFontAdvanceOracle({
				bytes,
				resources,
				requests: frame.fontMetricRequests!,
				actual,
				candidates,
			})),
		});
	}
	check(
		JSON.stringify(observations[0]) === JSON.stringify(observations[2]),
		"Advance repeat inherited earlier face/axis state",
	);
	check(
		JSON.stringify(observations[0]!.widths) !==
			JSON.stringify(observations[1]!.widths),
		"Advance measurement ignored custom font axis",
	);
	check(
		document.querySelectorAll("iframe").length === iframeCount,
		"Advance probe leaked a sandbox iframe",
	);
	return {
		passed: true,
		observations,
		checks: [
			"real whole/prefix Canvas advances",
			"kerning rejects character-sum implementation",
			"explicit size and tracking",
			"empty prefix zero",
			"full font identity/custom axes",
			"legacy glyph reset/shape",
			"reverse-repeat isolation",
			"no author code or leaked iframe",
		],
	};
}
