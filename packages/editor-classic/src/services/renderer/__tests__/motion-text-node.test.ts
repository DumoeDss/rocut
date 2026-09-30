import { describe, expect, test } from "bun:test";
import {
	assetId,
	mediaTime,
	motionTextCueId,
	motionTextCutId,
	motionTextFontId,
	motionTextSequenceId,
	type MotionTextPresetGroup,
	type MotionTextPresetSelection,
	type MotionTextSequence,
} from "@opencut/editor-contracts";

import type { SceneTracks } from "../../../timeline";
import { buildFrameDescriptor } from "../compositor/frame-descriptor";
import { signedRandom, unitRandom } from "../motion-text/deterministic-random";
import {
	createMotionTextRenderRuntime,
	drawMotionTextFrame,
	type MotionTextCanvasContext,
	resolveMotionTextRenderFrame,
} from "../motion-text/jizura-adapter";
import {
	MotionTextFontRuntime,
	type MotionTextFontEnvironment,
} from "../motion-text/font-runtime";
import { MOTION_TEXT_RENDERER_SUPPORT } from "../motion-text/support-manifest";
import { MotionTextNode } from "../nodes/motion-text-node";
import { resolveRenderTree } from "../resolve";
import { buildScene } from "../scene-builder";

function sequenceFixture({
	compositionMode = "overlay",
	seed = 7,
}: {
	compositionMode?: MotionTextSequence["compositionMode"];
	seed?: number;
} = {}): MotionTextSequence {
	const firstCueId = motionTextCueId("cue:first");
	const secondCueId = motionTextCueId("cue:second");
	const preset = {
		style: "noir",
		layout: "center",
		enter: "blur",
		hold: "jitter",
		exit: "drift",
		decor: [],
		treat: "none",
		bg: "none",
		cam: "push",
		fx: [],
		trans: null,
	} as const;
	return {
		id: motionTextSequenceId(`sequence:${seed}`),
		schemaVersion: 1,
		revision: 3,
		source: { format: "plain", text: "First line\n第二行" },
		language: "en",
		duration: mediaTime({ ticks: 120_000 }),
		compositionMode,
		seed,
		engine: {
			id: "jizura",
			version: "0.9.0",
			catalogHash: "fixture-catalog",
			plannerVersion: 1,
			tokenizerVersion: "unicode-v1",
		},
		fonts: [],
		defaults: {
			preset,
			colors: {},
			parameters: {},
		},
		cues: [
			{
				id: firstCueId,
				text: "First line",
				startTime: mediaTime({ ticks: 0 }),
				duration: mediaTime({ ticks: 60_000 }),
				interlude: false,
				gapBefore: false,
				impact: false,
				emphasis: [],
				segments: ["First line"],
				locks: [],
				overrides: {},
			},
			{
				id: secondCueId,
				text: "第二行",
				startTime: mediaTime({ ticks: 60_000 }),
				duration: mediaTime({ ticks: 60_000 }),
				interlude: false,
				gapBefore: false,
				impact: false,
				emphasis: [],
				segments: ["第二行"],
				locks: [],
				overrides: {},
			},
		],
		resolvedPlan: {
			version: 1,
			sequenceRevision: 3,
			cuts: [
				{
					id: motionTextCutId("cut:first"),
					cueId: firstCueId,
					text: "First line",
					startTime: mediaTime({ ticks: 0 }),
					duration: mediaTime({ ticks: 60_000 }),
					seed,
					preset,
					parameters: {},
				},
				{
					id: motionTextCutId("cut:second"),
					cueId: secondCueId,
					text: "第二行",
					startTime: mediaTime({ ticks: 60_000 }),
					duration: mediaTime({ ticks: 60_000 }),
					seed: seed + 1,
					preset: { ...preset, layout: "vcols", hold: "still" },
					parameters: {},
				},
			],
		},
	};
}

function withPresetGroup({
	preset,
	group,
	id,
}: {
	readonly preset: MotionTextPresetSelection;
	readonly group: MotionTextPresetGroup;
	readonly id: string;
}): MotionTextPresetSelection {
	switch (group) {
		case "style":
		case "layout":
		case "enter":
		case "hold":
		case "exit":
		case "treat":
		case "bg":
		case "cam":
			return { ...preset, [group]: id };
		case "decor":
			return { ...preset, decor: [id] };
		case "fx":
			return { ...preset, fx: [id] };
		case "trans":
			return { ...preset, trans: id };
	}
}

function withProjectFont(sequence: MotionTextSequence): MotionTextSequence {
	const fontId = motionTextFontId("font:missing-project");
	return {
		...sequence,
		fonts: [
			{
				id: fontId,
				source: "project",
				family: "Missing Project Font",
				style: "normal",
				weight: 700,
				assetId: assetId("asset:missing-font"),
				contentDigest: "sha256:missing",
			},
		],
		defaults: { ...sequence.defaults, fontId },
		resolvedPlan: sequence.resolvedPlan
			? {
					...sequence.resolvedPlan,
					cuts: sequence.resolvedPlan.cuts.map((cut) => ({
						...cut,
						fontId,
					})),
				}
			: undefined,
	};
}

function missingProjectFontRuntime() {
	return new MotionTextFontRuntime({
		inspectFont: () => ({ inspection: null, error: "not reached" }),
		loadBuiltinFont: async () => new ArrayBuffer(0),
		loadProjectFont: async () => null,
	});
}

function reloadableProjectFontRuntime({
	deferFirstLoad = false,
}: {
	deferFirstLoad?: boolean;
} = {}) {
	let loads = 0;
	let resolveFirstLoad: ((value: ArrayBuffer | null) => void) | null = null;
	const firstLoad = new Promise<ArrayBuffer | null>((resolve) => {
		resolveFirstLoad = resolve;
	});
	const environment: MotionTextFontEnvironment = {
		async loadSystemFont() {},
		async loadFontFace({ family }) {
			return { family, native: null };
		},
		addFontFace() {},
		deleteFontFace() {},
	};
	const runtime = new MotionTextFontRuntime({
		environment,
		inspectFont: () => ({
			error: null,
			inspection: {
				contentDigest: "sha256:missing",
				faceIndex: 0,
				glyphCount: 10,
				missingCodePoints: [],
			},
		}),
		loadBuiltinFont: async () => new Uint8Array([1]).buffer,
		loadProjectFont: async () => {
			loads += 1;
			if (deferFirstLoad && loads === 1) return firstLoad;
			return new Uint8Array([1, 2, 3]).buffer;
		},
	});
	return {
		runtime,
		loads: () => loads,
		resolveFirstLoad: () =>
			resolveFirstLoad?.(new Uint8Array([1, 2, 3]).buffer),
	};
}

function tracksFixture({ sequenceId }: { sequenceId: string }): SceneTracks {
	return {
		main: {
			id: "main",
			name: "Main",
			type: "video",
			elements: [],
			muted: false,
			hidden: false,
		},
		overlay: [
			{
				id: "motion-track",
				name: "Motion text",
				type: "graphic",
				hidden: false,
				elements: [
					{
						id: "motion-clip",
						name: "Motion clip",
						type: "motion-text",
						sequenceId,
						startTime: mediaTime({ ticks: 10_000 }),
						duration: mediaTime({ ticks: 100_000 }),
						trimStart: mediaTime({ ticks: 10_000 }),
						trimEnd: mediaTime({ ticks: 10_000 }),
						params: {
							"transform.positionX": 12,
							"transform.scaleX": 0.9,
							"transform.scaleY": 0.9,
							opacity: 0.75,
						},
					},
				],
			},
		],
		audio: [],
	};
}

function rendererFixture() {
	return { width: 640, height: 360 };
}

function videoCacheFixture() {
	return { getFrameAt: async () => null };
}

function recordingContext() {
	const drawEvents: Array<
		{ readonly kind: "rect" } | { readonly kind: "text"; readonly text: string }
	> = [];
	const fillRects: Array<readonly [number, number, number, number]> = [];
	const fillRectDraws: Array<{
		readonly alpha: number;
		readonly fillStyle: string;
	}> = [];
	const rects: Array<readonly [number, number, number, number]> = [];
	const rotations: number[] = [];
	const scales: Array<readonly [number, number]> = [];
	const transforms: Array<
		readonly [number, number, number, number, number, number]
	> = [];
	const text: string[] = [];
	const textDraws: Array<{
		readonly alpha: number;
		readonly fillStyle: string;
		readonly font: string;
		readonly kind: "fill" | "stroke";
		readonly text: string;
		readonly textAlign: string;
		readonly x: number;
		readonly y: number;
	}> = [];
	const translations: Array<readonly [number, number]> = [];
	const context: MotionTextCanvasContext = {
		filter: "none",
		fillStyle: "#000000",
		font: "",
		globalAlpha: 1,
		lineWidth: 1,
		shadowBlur: 0,
		shadowColor: "transparent",
		strokeStyle: "#000000",
		textAlign: "start",
		textBaseline: "alphabetic",
		beginPath() {},
		clip() {},
		fillRect: (...args: [number, number, number, number]) => {
			drawEvents.push({ kind: "rect" });
			fillRects.push(args);
			fillRectDraws.push({
				alpha: context.globalAlpha,
				fillStyle: String(context.fillStyle),
			});
		},
		fillText: (...args: [string, number, number, number?]) => {
			drawEvents.push({ kind: "text", text: args[0] });
			text.push(args[0]);
			textDraws.push({
				alpha: context.globalAlpha,
				fillStyle: String(context.fillStyle),
				font: context.font,
				kind: "fill",
				text: args[0],
				textAlign: context.textAlign,
				x: args[1],
				y: args[2],
			});
		},
		rect: (...args: [number, number, number, number]) => {
			rects.push(args);
		},
		restore() {},
		rotate: (radians: number) => {
			rotations.push(radians);
		},
		save() {},
		scale: (...args: [number, number]) => {
			scales.push(args);
		},
		setTransform() {},
		strokeText: (...args: [string, number, number, number?]) => {
			drawEvents.push({ kind: "text", text: args[0] });
			text.push(args[0]);
			textDraws.push({
				alpha: context.globalAlpha,
				fillStyle: String(context.fillStyle),
				font: context.font,
				kind: "stroke",
				text: args[0],
				textAlign: context.textAlign,
				x: args[1],
				y: args[2],
			});
		},
		transform: (...args: [number, number, number, number, number, number]) => {
			transforms.push(args);
		},
		translate: (...args: [number, number]) => {
			translations.push(args);
		},
	};
	return {
		context,
		drawEvents,
		fillRectDraws,
		fillRects,
		rects,
		rotations,
		scales,
		text,
		textDraws,
		transforms,
		translations,
	};
}

function renderTypographyLayout({
	bg,
	cam,
	decor,
	enter,
	exit,
	fx,
	hold,
	layout,
	seed = 7,
	sequenceTime = 30_000,
	style,
	text,
	treat,
}: {
	readonly bg?: string;
	readonly cam?: string;
	readonly decor?: string;
	readonly enter?: string;
	readonly exit?: string;
	readonly fx?: readonly string[];
	readonly hold?: string;
	readonly layout: string;
	readonly seed?: number;
	readonly sequenceTime?: number;
	readonly style?: string;
	readonly text: string;
	readonly treat?: string;
}) {
	const base = sequenceFixture({ seed });
	const preset = {
		...base.defaults.preset,
		bg: bg ?? base.defaults.preset.bg,
		cam: cam ?? "static",
		decor: decor ? [decor] : base.defaults.preset.decor,
		enter: enter ?? base.defaults.preset.enter,
		exit: exit ?? base.defaults.preset.exit,
		fx: fx ?? base.defaults.preset.fx,
		hold: hold ?? "still",
		layout,
		style: style ?? base.defaults.preset.style,
		treat: treat ?? base.defaults.preset.treat,
	};
	const sequence: MotionTextSequence = {
		...base,
		defaults: { ...base.defaults, preset },
		resolvedPlan: base.resolvedPlan
			? {
					...base.resolvedPlan,
					cuts: base.resolvedPlan.cuts.map((cut, index) => ({
						...cut,
						preset,
						text: index === 0 ? text : cut.text,
					})),
				}
			: undefined,
	};
	const frame = resolveMotionTextRenderFrame({
		runtime: createMotionTextRenderRuntime({ sequence }),
		sequenceTime,
	});
	if (!frame) throw new Error(`Expected a frame for layout:${layout}`);
	const recorded = recordingContext();
	drawMotionTextFrame({
		ctx: recorded.context,
		frame,
		width: 640,
		height: 360,
		compositionMode: "overlay",
	});
	return recorded;
}

function typographyRecordingSignature(
	recorded: ReturnType<typeof renderTypographyLayout>,
): string {
	return JSON.stringify({
		fillRects: recorded.fillRects.map((rect, index) => ({
			alpha: Number(recorded.fillRectDraws[index]!.alpha.toFixed(3)),
			fillStyle: recorded.fillRectDraws[index]!.fillStyle,
			rect: rect.map((value) => Number(value.toFixed(2))),
		})),
		rotations: recorded.rotations.map((value) => Number(value.toFixed(3))),
		rects: recorded.rects.map((rect) =>
			rect.map((value) => Number(value.toFixed(2))),
		),
		scales: recorded.scales.map(([x, y]) => [
			Number(x.toFixed(3)),
			Number(y.toFixed(3)),
		]),
		translations: recorded.translations.map(([x, y]) => [
			Number(x.toFixed(2)),
			Number(y.toFixed(2)),
		]),
		transforms: recorded.transforms.map((transform) =>
			transform.map((value) => Number(value.toFixed(3))),
		),
		text: recorded.textDraws.map((draw) => [
			draw.text,
			Number(draw.x.toFixed(2)),
			Number(draw.y.toFixed(2)),
			Number(draw.alpha.toFixed(3)),
			draw.fillStyle,
		]),
	});
}

function renderTypographyTransition({
	trans,
	sequenceTime = 70_000,
}: {
	readonly trans: string;
	readonly sequenceTime?: number;
}) {
	const base = sequenceFixture();
	const plan = base.resolvedPlan;
	const firstCut = plan?.cuts[0];
	const secondCut = plan?.cuts[1];
	if (!plan || !firstCut || !secondCut) {
		throw new Error("Transition fixture needs two cuts");
	}
	const stablePreset = {
		...base.defaults.preset,
		cam: "static",
		enter: "cut",
		exit: "cut",
		hold: "still",
	};
	const sequence: MotionTextSequence = {
		...base,
		defaults: {
			...base.defaults,
			preset: { ...stablePreset, trans },
		},
		resolvedPlan: {
			...plan,
			cuts: [
				{
					...firstCut,
					text: "BEFORE",
					preset: { ...stablePreset, trans: null },
				},
				{ ...secondCut, text: "AFTER", preset: { ...stablePreset, trans } },
			],
		},
	};
	const frame = resolveMotionTextRenderFrame({
		runtime: createMotionTextRenderRuntime({ sequence }),
		sequenceTime,
	});
	if (!frame) throw new Error(`Expected a frame for trans:${trans}`);
	const recorded = recordingContext();
	drawMotionTextFrame({
		ctx: recorded.context,
		frame,
		width: 640,
		height: 360,
		compositionMode: "overlay",
	});
	return recorded;
}

const testTimeMapper = ({
	clipStartTime,
	clipDuration,
	trimStart,
	timelineTime,
	sequenceDuration,
}: {
	clipStartTime: number;
	clipDuration: number;
	trimStart: number;
	timelineTime: number;
	sequenceDuration: number;
}) => {
	const sequenceTime = trimStart + timelineTime - clipStartTime;
	const active =
		timelineTime >= clipStartTime &&
		timelineTime < clipStartTime + clipDuration &&
		sequenceTime >= 0 &&
		sequenceTime < sequenceDuration;
	return { active, sequenceTime: active ? sequenceTime : null };
};

function motionTextNodeFrom(
	scene: ReturnType<typeof buildScene>,
): MotionTextNode {
	const node = scene.children[0];
	if (!(node instanceof MotionTextNode)) {
		throw new TypeError("Expected scene-builder to create a MotionTextNode");
	}
	return node;
}

describe("MotionTextNode", () => {
	test("deterministic random values stay inside their documented ranges", () => {
		for (let seed = -32; seed <= 32; seed += 1) {
			for (let salt = 0; salt < 64; salt += 1) {
				const unit = unitRandom({ seed, salt });
				const signed = signedRandom({ seed, salt });
				expect(unit).toBeGreaterThanOrEqual(0);
				expect(unit).toBeLessThan(1);
				expect(signed).toBeGreaterThanOrEqual(-1);
				expect(signed).toBeLessThan(1);
			}
		}
	});

	test("every advertised renderer preset resolves and draws without unsupported diagnostics", () => {
		for (const supported of MOTION_TEXT_RENDERER_SUPPORT) {
			const base = sequenceFixture();
			const preset = withPresetGroup({
				preset: base.defaults.preset,
				group: supported.group,
				id: supported.id,
			});
			const sequence: MotionTextSequence = {
				...base,
				defaults: { ...base.defaults, preset },
				resolvedPlan: base.resolvedPlan
					? {
							...base.resolvedPlan,
							cuts: base.resolvedPlan.cuts.map((cut) => ({
								...cut,
								preset,
							})),
						}
					: undefined,
			};
			const frame = resolveMotionTextRenderFrame({
				runtime: createMotionTextRenderRuntime({ sequence }),
				sequenceTime: 30_000,
			});
			expect(frame, `${supported.group}:${supported.id}`).not.toBeNull();
			expect(
				frame?.diagnostics.some(
					(diagnostic) => diagnostic.code === "unsupported-preset",
				),
				`${supported.group}:${supported.id}`,
			).toBe(false);
			if (!frame) continue;
			const recorded = recordingContext();
			drawMotionTextFrame({
				ctx: recorded.context,
				frame,
				width: 640,
				height: 360,
				compositionMode: "overlay",
			});
			expect(
				recorded.text.length,
				`${supported.group}:${supported.id}`,
			).toBeGreaterThan(0);
		}
	});

	test("typography layouts retain their distinct editorial geometry", () => {
		const baseline = renderTypographyLayout({
			layout: "tyBaseline",
			text: "ALPHA BETA GAMMA",
		});
		const baselineRows = new Set(
			baseline.textDraws
				.filter((draw) => draw.kind === "fill")
				.map((draw) => draw.y),
		);
		expect(baselineRows.size).toBeGreaterThanOrEqual(2);
		expect(baseline.fillRects.length).toBeGreaterThanOrEqual(3);

		const fullTrack = renderTypographyLayout({
			layout: "tyFullTrack",
			text: "TRACKING",
		});
		const trackedGlyphs = fullTrack.textDraws.filter(
			(draw) => draw.kind === "fill",
		);
		expect(trackedGlyphs).toHaveLength(8);
		expect(
			Math.max(...trackedGlyphs.map((draw) => draw.x)) -
				Math.min(...trackedGlyphs.map((draw) => draw.x)),
		).toBeGreaterThan(400);

		const margin = renderTypographyLayout({
			layout: "tyMargin",
			text: "QUIET SPACE",
		});
		const marginText = margin.textDraws.find((draw) => draw.kind === "fill");
		expect(marginText).toBeDefined();
		expect(Math.abs((marginText?.x ?? 320) - 320)).toBeGreaterThan(240);
		expect(Math.abs((marginText?.y ?? 180) - 180)).toBeGreaterThan(90);
		expect(margin.fillRects.length).toBeGreaterThanOrEqual(2);

		const square = renderTypographyLayout({
			layout: "tySquare",
			text: "GRIDPLAY",
		});
		const squareGlyphs = square.textDraws.filter(
			(draw) => draw.kind === "fill",
		);
		expect(squareGlyphs).toHaveLength(8);
		expect(new Set(squareGlyphs.map((draw) => draw.x)).size).toBe(3);
		expect(new Set(squareGlyphs.map((draw) => draw.y)).size).toBe(3);
		expect(square.fillRects.length).toBeGreaterThanOrEqual(8);
	});

	test("editorial typography adapters preserve their JIZURA layout signatures", () => {
		const keySplit = renderTypographyLayout({
			layout: "tyKeySplit",
			text: "small EMPHASIS tail",
		});
		expect(keySplit.text).toEqual(
			expect.arrayContaining(["small", "EMPHASIS", "tail"]),
		);
		expect(keySplit.fillRects.length).toBeGreaterThanOrEqual(1);

		const cropGiant = renderTypographyLayout({
			layout: "tyCropGiant",
			text: "CROPPED TYPE",
		});
		expect(cropGiant.textDraws.some((draw) => draw.y < 0 || draw.y > 360)).toBe(
			true,
		);
		expect(cropGiant.textDraws.some((draw) => draw.y > 0 && draw.y < 360)).toBe(
			true,
		);

		const cross = renderTypographyLayout({
			layout: "tyCross",
			text: "ABCDE",
		});
		expect(cross.text).toEqual(expect.arrayContaining(["AB", "C", "DE"]));
		expect(new Set(cross.textDraws.map((draw) => draw.y)).size).toBeGreaterThan(
			3,
		);
		expect(cross.fillRects.length).toBeGreaterThanOrEqual(2);

		const scaleSteps = renderTypographyLayout({
			layout: "tyScaleSteps",
			text: "SCALE",
		});
		const scaleGlyphs = scaleSteps.textDraws.filter(
			(draw) => draw.kind === "fill",
		);
		expect(scaleGlyphs).toHaveLength(5);
		expect(new Set(scaleGlyphs.map((draw) => draw.font)).size).toBe(5);

		const justify = renderTypographyLayout({
			layout: "tyJustify",
			text: "JUSTIFIED LAYOUT BLOCK",
		});
		expect(new Set(justify.textDraws.map((draw) => draw.y)).size).toBe(3);
		expect(justify.fillRects.length).toBeGreaterThanOrEqual(2);

		const indexTable = renderTypographyLayout({
			layout: "tyIndexTable",
			text: "INDEX",
		});
		expect(indexTable.text).toEqual(
			expect.arrayContaining(["01", "I", "U+0049"]),
		);
		expect(indexTable.fillRects.length).toBeGreaterThanOrEqual(6);

		const statCount = renderTypographyLayout({
			layout: "tyStatCount",
			text: "COUNT ME",
		});
		expect(statCount.text).toEqual(
			expect.arrayContaining(["07", "CHARACTERS"]),
		);
		expect(statCount.fillRects.length).toBeGreaterThanOrEqual(1);

		const lineFocus = renderTypographyLayout({
			layout: "tyLineFocus",
			text: "A VERY IMPORTANT LINE",
		});
		const focusAlpha = new Set(lineFocus.textDraws.map((draw) => draw.alpha));
		expect(focusAlpha.size).toBeGreaterThanOrEqual(2);
		expect(lineFocus.fillRects.length).toBeGreaterThanOrEqual(1);
	});

	test("graphic typography adapters preserve clipping, annotation, and axis signatures", () => {
		const bandHide = renderTypographyLayout({
			layout: "tyBandHide",
			text: "BAND HIDES",
		});
		expect(bandHide.text.some((text) => text.includes("BAND HIDES /"))).toBe(
			true,
		);
		expect(bandHide.fillRects.length).toBeGreaterThanOrEqual(2);

		const ruby = renderTypographyLayout({
			layout: "tyRuby",
			text: "未来かな",
		});
		expect(ruby.text).toEqual(
			expect.arrayContaining(["未", "来", "KA", "NA", "01"]),
		);
		expect(ruby.fillRects.length).toBeGreaterThanOrEqual(6);

		const splitType = renderTypographyLayout({
			layout: "tySplitType",
			text: "SPLIT TYPE",
		});
		const splitCopies = splitType.textDraws.filter(
			(draw) => draw.text === "SPLIT TYPE",
		);
		expect(splitCopies).toHaveLength(2);
		expect(new Set(splitCopies.map((draw) => draw.x)).size).toBe(2);
		expect(splitType.fillRects.length).toBeGreaterThanOrEqual(1);

		const erode = renderTypographyLayout({
			layout: "tyErode",
			text: "EROSION",
		});
		expect(erode.text).toEqual(expect.arrayContaining(["E", "ERO", "EROSION"]));
		expect(
			new Set(erode.textDraws.map((draw) => draw.alpha)).size,
		).toBeGreaterThan(1);

		const ruler = renderTypographyLayout({
			layout: "tyVRuler",
			text: "RULER",
		});
		expect(ruler.text).toEqual(expect.arrayContaining(["R", "01", "05"]));
		expect(new Set(ruler.textDraws.map((draw) => draw.y)).size).toBe(5);
		expect(ruler.fillRects.length).toBeGreaterThanOrEqual(7);

		const rotated = renderTypographyLayout({
			layout: "tyRotBlock",
			text: "SIDE MAIN BLOCK",
		});
		expect(rotated.text).toEqual(
			expect.arrayContaining(["SIDE", "MAIN BLOCK"]),
		);
		const localRotations = rotated.rotations.filter(
			(radians) => Math.abs(radians) > Number.EPSILON,
		);
		expect(localRotations).toHaveLength(1);
		expect(Math.abs(localRotations[0])).toBeCloseTo(Math.PI / 2);
		expect(rotated.fillRects.length).toBeGreaterThanOrEqual(1);
	});

	test("core layout family preserves twelve distinct composition signatures", () => {
		const layouts = [
			"tile",
			"scatter",
			"ring",
			"wave",
			"labels",
			"condensed",
			"gloss",
			"diag",
			"circle",
			"pill",
			"title",
			"interlude",
		] as const;
		const renderAt = ({
			layout,
			sequenceTime,
		}: {
			readonly layout: string;
			readonly sequenceTime: number;
		}) =>
			renderTypographyLayout({
				cam: "static",
				enter: "cut",
				exit: "cut",
				hold: "still",
				layout,
				seed: 107,
				sequenceTime,
				text: "LAYOUT SIGNAL",
			});
		const phaseA = new Map(
			layouts.map((layout) => [
				layout,
				renderAt({ layout, sequenceTime: 18_000 }),
			]),
		);
		const phaseB = new Map(
			layouts.map((layout) => [
				layout,
				renderAt({ layout, sequenceTime: 42_000 }),
			]),
		);
		expect(
			new Set([...phaseA.values()].map(typographyRecordingSignature)).size,
		).toBe(layouts.length);
		for (const layout of layouts.filter(
			(layout) => layout !== "condensed" && layout !== "scatter",
		)) {
			expect(
				typographyRecordingSignature(phaseA.get(layout)!),
				layout,
			).not.toBe(typographyRecordingSignature(phaseB.get(layout)!));
		}
		expect(phaseA.get("tile")!.textDraws.length).toBeGreaterThan(10);
		expect(phaseA.get("ring")!.rotations.length).toBeGreaterThan(20);
		expect(phaseA.get("labels")!.fillRects.length).toBeGreaterThan(8);
		expect(
			phaseA.get("condensed")!.scales.some(([scaleX, scaleY]) => {
				return scaleX < 0.7 && scaleY > 1;
			}),
		).toBe(true);
		expect(phaseA.get("interlude")!.fillRects.length).toBeGreaterThan(40);
	});

	test("layoutsA family preserves twenty-eight distinct source compositions", () => {
		const layouts = [
			"lowerThird",
			"corners",
			"staircase",
			"zigzag",
			"arcTop",
			"spiral",
			"gridCells",
			"dropCap",
			"justified",
			"frameBox",
			"bubble",
			"subtitleBar",
			"ticker",
			"splitScreen",
			"mirror",
			"sideways",
			"edgeFrame",
			"perspective",
			"hanko",
			"genkou",
			"panels",
			"filmstrip",
			"quote",
			"ruler",
			"searchBar",
			"chat",
			"notification",
			"ticket",
		] as const;
		const renderAt = ({
			layout,
			sequenceTime,
		}: {
			readonly layout: string;
			readonly sequenceTime: number;
		}) =>
			renderTypographyLayout({
				cam: "static",
				enter: "cut",
				exit: "cut",
				hold: "still",
				layout,
				seed: 113,
				sequenceTime,
				text: "LAYOUT ALPHA SIGNAL",
			});
		const phaseA = new Map(
			layouts.map((layout) => [
				layout,
				renderAt({ layout, sequenceTime: 18_000 }),
			]),
		);
		const phaseB = new Map(
			layouts.map((layout) => [
				layout,
				renderAt({ layout, sequenceTime: 42_000 }),
			]),
		);
		expect(
			new Set([...phaseA.values()].map(typographyRecordingSignature)).size,
		).toBe(layouts.length);
		for (const layout of layouts) {
			expect(
				typographyRecordingSignature(phaseA.get(layout)!),
				layout,
			).not.toBe(typographyRecordingSignature(phaseB.get(layout)!));
		}
		expect(phaseA.get("arcTop")!.rotations.length).toBeGreaterThan(10);
		expect(phaseA.get("perspective")!.transforms.length).toBeGreaterThan(2);
		expect(phaseA.get("genkou")!.fillRects.length).toBeGreaterThan(40);
		expect(phaseA.get("filmstrip")!.fillRects.length).toBeGreaterThan(40);
		expect(phaseA.get("chat")!.textDraws.length).toBeGreaterThanOrEqual(4);
		expect(phaseA.get("ticket")!.fillRects.length).toBeGreaterThan(20);
		expect(phaseA.get("searchBar")!.text).toEqual(
			expect.arrayContaining(["LAYOUT ALPHA SIGNAL lyrics"]),
		);
	});

	test("layoutsB family preserves twenty-seven kinetic composition signatures", () => {
		const layouts = [
			"rain",
			"hanging",
			"orbit",
			"tunnel",
			"wordCloud",
			"bounceLine",
			"elastic",
			"crossBands",
			"stickerBomb",
			"neon",
			"keycaps",
			"bubbles",
			"slotMachine",
			"flipBoard",
			"credits",
			"zoomRepeat",
			"splitHalves",
			"columnsBig",
			"circleWords",
			"dotMatrix",
			"depthStack",
			"typeSpecimen",
			"kanjiFocus",
			"halfVertical",
			"curtain",
			"equalizer",
			"tape",
		] as const;
		const renderAt = ({
			layout,
			sequenceTime,
		}: {
			readonly layout: string;
			readonly sequenceTime: number;
		}) =>
			renderTypographyLayout({
				cam: "static",
				enter: "cut",
				exit: "cut",
				hold: "still",
				layout,
				seed: 127,
				sequenceTime,
				text: "KINETIC LAYOUT SIGNAL",
			});
		const phaseA = new Map(
			layouts.map((layout) => [
				layout,
				renderAt({ layout, sequenceTime: 18_000 }),
			]),
		);
		const phaseB = new Map(
			layouts.map((layout) => [
				layout,
				renderAt({ layout, sequenceTime: 42_000 }),
			]),
		);
		expect(
			new Set([...phaseA.values()].map(typographyRecordingSignature)).size,
		).toBe(layouts.length);
		for (const layout of layouts) {
			expect(
				typographyRecordingSignature(phaseA.get(layout)!),
				layout,
			).not.toBe(typographyRecordingSignature(phaseB.get(layout)!));
		}
		expect(phaseA.get("rain")!.textDraws.length).toBeGreaterThan(40);
		expect(phaseA.get("hanging")!.rotations.length).toBeGreaterThan(10);
		expect(phaseA.get("tunnel")!.scales.length).toBeGreaterThan(5);
		expect(phaseA.get("keycaps")!.fillRects.length).toBeGreaterThan(10);
		expect(phaseA.get("slotMachine")!.textDraws.length).toBeGreaterThan(20);
		expect(phaseA.get("dotMatrix")!.fillRects.length).toBeGreaterThan(100);
		expect(
			phaseA.get("typeSpecimen")!.text.some((text) => text.endsWith(" PX")),
		).toBe(true);
		expect(phaseA.get("equalizer")!.fillRects.length).toBeGreaterThan(10);
	});

	test("layoutsC family preserves thirty-four editorial object signatures", () => {
		const layouts = [
			"magazine",
			"headlineDeck",
			"contents",
			"footnote",
			"proofread",
			"numbered",
			"poster",
			"swissGrid",
			"dictionary",
			"ema",
			"ransom",
			"newspaper",
			"vinyl",
			"cassette",
			"bookSpine",
			"polaroid",
			"stampSheet",
			"postcard",
			"letterPaper",
			"calendar",
			"chochin",
			"routeMap",
			"stationSign",
			"noren",
			"tanzaku",
			"omikuji",
			"kakejiku",
			"shoji",
			"clapper",
			"warningLabel",
			"priceTag",
			"nameTag",
			"stickyNotes",
			"karuta",
		] as const;
		const renderAt = ({
			layout,
			sequenceTime,
		}: {
			readonly layout: string;
			readonly sequenceTime: number;
		}) =>
			renderTypographyLayout({
				cam: "static",
				enter: "cut",
				exit: "cut",
				hold: "still",
				layout,
				seed: 139,
				sequenceTime,
				text: "EDITORIAL PAPER SIGNAL",
			});
		const phaseA = new Map(
			layouts.map((layout) => [
				layout,
				renderAt({ layout, sequenceTime: 18_000 }),
			]),
		);
		const phaseB = new Map(
			layouts.map((layout) => [
				layout,
				renderAt({ layout, sequenceTime: 42_000 }),
			]),
		);
		expect(
			new Set([...phaseA.values()].map(typographyRecordingSignature)).size,
		).toBe(layouts.length);
		for (const layout of layouts) {
			expect(
				typographyRecordingSignature(phaseA.get(layout)!),
				layout,
			).not.toBe(typographyRecordingSignature(phaseB.get(layout)!));
		}
		expect(phaseA.get("magazine")!.fillRects.length).toBeGreaterThan(40);
		expect(phaseA.get("ransom")!.rotations.length).toBeGreaterThan(10);
		expect(phaseA.get("routeMap")!.textDraws.length).toBeGreaterThan(7);
		expect(phaseA.get("stampSheet")!.fillRects.length).toBeGreaterThan(100);
		expect(phaseA.get("shoji")!.fillRects.length).toBeGreaterThan(30);
		expect(phaseA.get("clapper")!.rotations.length).toBeGreaterThan(1);
		expect(phaseA.get("calendar")!.text).toContain("SEPTEMBER / 2026");
		expect(phaseA.get("warningLabel")!.text).toContain("WARNING  /  警告");
	});

	test("layoutsD family preserves thirty-four physical and optical signatures", () => {
		const layouts = [
			"cube",
			"cylinder",
			"flipCards",
			"accordion",
			"flag",
			"ribbon",
			"pendulum",
			"pile",
			"blocks",
			"balloons",
			"magnets",
			"tiles",
			"bulbs",
			"ledScroll",
			"billboard",
			"crowdBubbles",
			"crossword",
			"wordSearch",
			"puzzle",
			"shadowPlay",
			"kaleido",
			"dominoes",
			"burst",
			"fisheye",
			"wall",
			"origami",
			"zipper",
			"sliceStack",
			"glitchGrid",
			"mosaicTiles",
			"maskReveal",
			"contour",
			"halftoneBig",
			"stencil",
		] as const;
		const renderAt = ({
			layout,
			sequenceTime,
		}: {
			readonly layout: string;
			readonly sequenceTime: number;
		}) =>
			renderTypographyLayout({
				cam: "static",
				enter: "cut",
				exit: "cut",
				hold: "still",
				layout,
				seed: 151,
				sequenceTime,
				text: "PHYSICAL POP SIGNAL",
			});
		const phaseA = new Map(
			layouts.map((layout) => [
				layout,
				renderAt({ layout, sequenceTime: 18_000 }),
			]),
		);
		const phaseB = new Map(
			layouts.map((layout) => [
				layout,
				renderAt({ layout, sequenceTime: 42_000 }),
			]),
		);
		expect(
			new Set([...phaseA.values()].map(typographyRecordingSignature)).size,
		).toBe(layouts.length);
		for (const layout of layouts) {
			expect(
				typographyRecordingSignature(phaseA.get(layout)!),
				layout,
			).not.toBe(typographyRecordingSignature(phaseB.get(layout)!));
		}
		expect(phaseA.get("cube")!.rotations.length).toBeGreaterThan(0);
		expect(phaseA.get("flipCards")!.scales.length).toBeGreaterThan(5);
		expect(phaseA.get("pendulum")!.rotations.length).toBeGreaterThan(10);
		expect(phaseA.get("bulbs")!.fillRects.length).toBeGreaterThan(35);
		expect(phaseA.get("crossword")!.fillRects.length).toBeGreaterThan(250);
		expect(phaseA.get("wordSearch")!.textDraws.length).toBeGreaterThan(80);
		expect(phaseA.get("kaleido")!.rotations.length).toBeGreaterThan(9);
		expect(phaseA.get("glitchGrid")!.rects.length).toBeGreaterThan(10);
		expect(
			phaseA.get("contour")!.textDraws.filter((draw) => draw.kind === "stroke")
				.length,
		).toBeGreaterThanOrEqual(6);
		expect(phaseA.get("halftoneBig")!.fillRects.length).toBeGreaterThan(100);
		expect(phaseA.get("stencil")!.fillRects.length).toBeGreaterThan(80);
	});

	test("kinetic layouts preserve fourteen distinct composition signatures", () => {
		const renderLayout = ({
			layout,
			sequenceTime = 30_000,
			text = "ONE TWO THREE FOUR",
		}: {
			readonly layout: string;
			readonly sequenceTime?: number;
			readonly text?: string;
		}) =>
			renderTypographyLayout({
				enter: "cut",
				exit: "cut",
				hold: "still",
				layout,
				sequenceTime,
				text,
			});

		const stack = renderLayout({
			layout: "knSlamStack",
			sequenceTime: 25_000,
			text: "A WIDE EXTRAORDINARY",
		});
		expect(stack.text).toEqual(
			expect.arrayContaining(["A", "WIDE", "EXTRAORDINARY"]),
		);
		expect(
			new Set(stack.textDraws.map((draw) => draw.font)).size,
		).toBeGreaterThan(1);
		expect(stack.fillRects.length).toBeGreaterThanOrEqual(2);

		const quarter = renderLayout({
			layout: "knQuarterTurn",
			sequenceTime: 24_000,
		});
		expect(
			quarter.rotations.some(
				(value) => Math.abs(Math.abs(value) - Math.PI / 2) < 0.01,
			),
		).toBe(true);
		expect(quarter.fillRects.length).toBeGreaterThanOrEqual(3);

		const swapEarly = renderLayout({
			layout: "knSwapCenter",
			sequenceTime: 15_000,
		});
		const swapResolved = renderLayout({
			layout: "knSwapCenter",
			sequenceTime: 45_000,
		});
		expect(swapEarly.text.length).toBeLessThanOrEqual(2);
		expect(swapResolved.text.length).toBeGreaterThanOrEqual(4);
		expect(swapEarly.fillRects.length).toBeGreaterThanOrEqual(4);

		const zoom = renderLayout({ layout: "knZoomDive", sequenceTime: 23_000 });
		expect(zoom.text.length).toBeGreaterThanOrEqual(2);
		expect(zoom.scales.some(([x]) => x > 2)).toBe(true);

		const flow = renderLayout({
			layout: "knFlowSnap",
			text: "FLOW SNAP NOW",
		});
		expect(flow.text.length).toBe(11);
		expect(flow.rotations.some((value) => Math.abs(value) > 0.01)).toBe(true);
		expect(flow.fillRects.length).toBeGreaterThan(1);

		const seesaw = renderLayout({ layout: "knSeesaw", sequenceTime: 24_000 });
		expect(seesaw.fillRects.length).toBeGreaterThanOrEqual(2);
		expect(seesaw.rotations.some((value) => Math.abs(value) > 0.01)).toBe(true);

		const typeSlam = renderLayout({ layout: "knTypeSlam" });
		expect(typeSlam.text.length).toBeGreaterThanOrEqual(2);
		expect(new Set(typeSlam.textDraws.map((draw) => draw.font)).size).toBe(2);
		expect(typeSlam.fillRects.length).toBeGreaterThanOrEqual(8);

		const rhythmShot = renderLayout({
			layout: "knRhythmCuts",
			sequenceTime: 20_000,
		});
		const rhythmFinal = renderLayout({
			layout: "knRhythmCuts",
			sequenceTime: 50_000,
		});
		expect(rhythmShot.text).toHaveLength(1);
		expect(rhythmShot.fillRects.length).toBeGreaterThanOrEqual(4);
		expect(rhythmFinal.text.length).toBeGreaterThanOrEqual(4);

		const path = renderLayout({ layout: "knPathRide", sequenceTime: 20_000 });
		expect(path.fillRects.length).toBe(28);
		expect(path.rotations.length).toBeGreaterThanOrEqual(10);
		expect(
			new Set(path.rotations.map((value) => value.toFixed(3))).size,
		).toBeGreaterThan(4);

		const gears = renderLayout({ layout: "knGearWords" });
		expect(gears.fillRects.length).toBeGreaterThanOrEqual(40);
		expect(gears.rotations.some((value) => value > 0.1)).toBe(true);
		expect(gears.rotations.some((value) => value < -0.1)).toBe(true);

		const collide = renderLayout({ layout: "knCollide", sequenceTime: 24_000 });
		expect(collide.text).toEqual(
			expect.arrayContaining(["ONE TWO", "THREE FOUR"]),
		);
		expect(collide.scales.some(([x, y]) => Math.abs(x - y) > 0.05)).toBe(true);
		expect(collide.fillRects.length).toBeGreaterThanOrEqual(12);

		const tumble = renderLayout({ layout: "knTumble", sequenceTime: 24_000 });
		expect(tumble.fillRects.length).toBeGreaterThanOrEqual(3);
		expect(tumble.rotations.some((value) => Math.abs(value) > Math.PI)).toBe(
			true,
		);

		const reflow = renderLayout({ layout: "knReflow" });
		expect(reflow.text).toHaveLength(15);
		expect(reflow.rotations.some((value) => Math.abs(value) > 0.1)).toBe(true);
		expect(reflow.translations.length).toBeGreaterThanOrEqual(15);

		const pads = renderLayout({ layout: "knPadGrid", sequenceTime: 24_000 });
		expect(pads.text).toEqual(
			expect.arrayContaining(["ONE", "TWO", "THREE", "FOUR"]),
		);
		expect(pads.fillRects.length).toBeGreaterThanOrEqual(8);
	});

	test("horror layouts preserve twelve distinct found-footage signatures", () => {
		const fixtures = [
			["hrFlashlight", "SEARCH THE DARK"],
			["hrDoorGap", "DO NOT OPEN"],
			["hrWallScrawl", "IT KNOWS"],
			["hrCctv", "CAMERA SEES YOU"],
			["hrOuija", "OPEN THE DOOR"],
			["hrMissing", "MISSING NAME"],
			["hrWrongOne", "ONE WRONG GLYPH"],
			["hrRisingDark", "RISE FROM BELOW"],
			["hrRedacted", "HIDDEN RECORD"],
			["hrStaticTv", "NO SIGNAL"],
			["hrSpiritPhoto", "LOOK BEHIND"],
			["hrWrongShadow", "SHADOW MOVES"],
		] as const;
		const early = new Map(
			fixtures.map(([layout, text]) => [
				layout,
				renderTypographyLayout({
					enter: "cut",
					exit: "cut",
					hold: "still",
					layout,
					sequenceTime: 18_000,
					style: "hrNightRec",
					text,
				}),
			]),
		);
		const later = new Map(
			fixtures.map(([layout, text]) => [
				layout,
				renderTypographyLayout({
					enter: "cut",
					exit: "cut",
					hold: "still",
					layout,
					sequenceTime: 45_000,
					style: "hrNightRec",
					text,
				}),
			]),
		);
		const earlySignatures = [...early.values()].map(
			typographyRecordingSignature,
		);
		expect(new Set(earlySignatures).size).toBe(fixtures.length);
		for (const [layout] of fixtures) {
			const first = early.get(layout);
			const second = later.get(layout);
			expect(first).toBeDefined();
			expect(second).toBeDefined();
			expect(first!.textDraws.length + first!.fillRects.length).toBeGreaterThan(
				0,
			);
			expect(typographyRecordingSignature(first!)).not.toBe(
				typographyRecordingSignature(second!),
			);
		}

		expect(early.get("hrWallScrawl")?.text.length).toBeGreaterThan(10);
		expect(early.get("hrCctv")?.text).toEqual(expect.arrayContaining(["REC"]));
		expect(early.get("hrOuija")?.text).toEqual(
			expect.arrayContaining(["YES", "NO", "GOOD BYE"]),
		);
		expect(early.get("hrMissing")?.text).toEqual(
			expect.arrayContaining(["MISSING", "?"]),
		);
		expect(later.get("hrWrongOne")?.text).toContain("??");
		expect(later.get("hrRedacted")?.text).toContain("CLASSIFIED");
		expect(early.get("hrStaticTv")?.fillRects.length).toBeGreaterThan(45);
		expect(
			later.get("hrWrongShadow")?.scales.some(([scaleX]) => scaleX < 0),
		).toBe(true);
	});

	test("horror styles expose distinct palettes", () => {
		const palettes = ["hrRuin", "hrNightRec", "hrCurse"].map((style) => {
			const rendered = renderTypographyLayout({
				enter: "cut",
				exit: "cut",
				hold: "still",
				layout: "center",
				style,
				text: "HORROR STYLE",
			});
			return rendered.textDraws[0]?.fillStyle;
		});
		expect(palettes).toEqual(["#d3dacf", "#ededed", "#2a2017"]);
		expect(new Set(palettes).size).toBe(3);
	});

	test("remaining catalog styles expose 19 distinct native palette signatures", () => {
		const styles = [
			"magenta",
			"hud",
			"mint",
			"specimen",
			"transit",
			"blueprint",
			"rouge",
			"sakura",
			"ocean",
			"sunset",
			"forest",
			"vapor",
			"newsprint",
			"synth80",
			"kraft",
			"candy",
			"acid",
			"sumi",
			"gold",
		] as const;
		const rendered = new Map(
			styles.map((style) => [
				style,
				renderTypographyLayout({
					cam: "static",
					decor: "leaders",
					enter: "cut",
					exit: "cut",
					hold: "still",
					layout: "center",
					sequenceTime: 45_000,
					style,
					text: "STYLE SIGNAL",
					treat: "underline",
				}),
			]),
		);
		expect(
			new Set([...rendered.values()].map(typographyRecordingSignature)).size,
		).toBe(styles.length);
		expect(
			rendered
				.get("acid")
				?.textDraws.find((draw) => draw.text === "STYLE SIGNAL")?.fillStyle,
		).toBe("#c6ff00");
		expect(
			rendered
				.get("gold")
				?.textDraws.find((draw) => draw.text === "STYLE SIGNAL")?.fillStyle,
		).toBe("#f3e7c4");
	});

	test("core entrances preserve nine distinct source animation signatures", () => {
		const entrances = [
			"assemble",
			"slice",
			"type",
			"drop",
			"stretch",
			"spin",
			"flicker",
			"scramble",
			"zoom",
		] as const;
		const renderAt = ({
			enter,
			sequenceTime,
		}: {
			readonly enter: string;
			readonly sequenceTime: number;
		}) =>
			renderTypographyLayout({
				cam: "static",
				enter,
				exit: "cut",
				hold: "still",
				layout: "center",
				seed: 97,
				sequenceTime,
				text: "CORE ARRIVAL",
			});
		const phaseA = new Map(
			entrances.map((enter) => [
				enter,
				renderAt({ enter, sequenceTime: 12_000 }),
			]),
		);
		const phaseB = new Map(
			entrances.map((enter) => [
				enter,
				renderAt({ enter, sequenceTime: 26_000 }),
			]),
		);
		expect(
			new Set([...phaseA.values()].map(typographyRecordingSignature)).size,
		).toBe(entrances.length);
		for (const enter of entrances) {
			expect(typographyRecordingSignature(phaseA.get(enter)!), enter).not.toBe(
				typographyRecordingSignature(phaseB.get(enter)!),
			);
		}
		expect(phaseA.get("assemble")!.textDraws.length).toBeGreaterThan(20);
		expect(phaseA.get("type")!.fillRects.length).toBeGreaterThan(0);
		expect(phaseA.get("slice")!.rects.length).toBeGreaterThanOrEqual(7);
	});

	test("core holds preserve wave and glitch-tick signatures", () => {
		const holds = ["wave", "glitchtick"] as const;
		const renderAt = ({
			hold,
			sequenceTime,
		}: {
			readonly hold: string;
			readonly sequenceTime: number;
		}) =>
			renderTypographyLayout({
				cam: "static",
				enter: "cut",
				exit: "cut",
				hold,
				layout: "center",
				seed: 101,
				sequenceTime,
				text: "CORE HOLD",
			});
		const phaseA = new Map(
			holds.map((hold) => [hold, renderAt({ hold, sequenceTime: 18_000 })]),
		);
		const phaseB = new Map(
			holds.map((hold) => [hold, renderAt({ hold, sequenceTime: 42_000 })]),
		);
		expect(
			new Set([...phaseA.values()].map(typographyRecordingSignature)).size,
		).toBe(holds.length);
		for (const hold of holds) {
			expect(typographyRecordingSignature(phaseA.get(hold)!), hold).not.toBe(
				typographyRecordingSignature(phaseB.get(hold)!),
			);
		}
		expect(phaseA.get("wave")!.rotations.length).toBeGreaterThan(0);
		expect(phaseA.get("glitchtick")!.rects.length).toBeGreaterThan(0);
	});

	test("core exits preserve six distinct source disappearance signatures", () => {
		const exits = [
			"explode",
			"fall",
			"slice",
			"stretch",
			"scatter",
			"glitch",
		] as const;
		const renderAt = ({
			exit,
			sequenceTime,
		}: {
			readonly exit: string;
			readonly sequenceTime: number;
		}) =>
			renderTypographyLayout({
				cam: "static",
				enter: "cut",
				exit,
				hold: "still",
				layout: "center",
				seed: 103,
				sequenceTime,
				text: "CORE DEPARTURE",
			});
		const phaseA = new Map(
			exits.map((exit) => [exit, renderAt({ exit, sequenceTime: 46_000 })]),
		);
		const phaseB = new Map(
			exits.map((exit) => [exit, renderAt({ exit, sequenceTime: 52_000 })]),
		);
		expect(
			new Set([...phaseA.values()].map(typographyRecordingSignature)).size,
		).toBe(exits.length);
		for (const exit of exits) {
			expect(typographyRecordingSignature(phaseA.get(exit)!), exit).not.toBe(
				typographyRecordingSignature(phaseB.get(exit)!),
			);
		}
		expect(phaseA.get("explode")!.textDraws.length).toBeGreaterThan(20);
		expect(phaseA.get("slice")!.rects.length).toBeGreaterThanOrEqual(7);
		expect(phaseA.get("glitch")!.rects.length).toBeGreaterThanOrEqual(9);
	});

	test("horror entrances preserve seven distinct reveal signatures", () => {
		const fixtures = [
			["hrBlinkCreep", "BLINK CREEP"],
			["hrJumpScare", "JUMP SCARE"],
			["hrUneasy", "UNEASY ARRIVAL"],
			["hrVhold", "VERTICAL HOLD"],
			["hrMirrorSnap", "MIRROR SNAP"],
			["hrManifest", "MANIFEST"],
			["hrClawReveal", "CLAW REVEAL"],
		] as const;
		const early = new Map(
			fixtures.map(([enter, text]) => [
				enter,
				renderTypographyLayout({
					enter,
					exit: "cut",
					hold: "still",
					layout: "center",
					sequenceTime: 8_000,
					style: "hrNightRec",
					text,
				}),
			]),
		);
		const later = new Map(
			fixtures.map(([enter, text]) => [
				enter,
				renderTypographyLayout({
					enter,
					exit: "cut",
					hold: "still",
					layout: "center",
					sequenceTime: 30_000,
					style: "hrNightRec",
					text,
				}),
			]),
		);
		expect(
			new Set([...early.values()].map(typographyRecordingSignature)).size,
		).toBe(fixtures.length);
		for (const [enter] of fixtures) {
			const first = early.get(enter)!;
			const second = later.get(enter)!;
			expect(first.textDraws.length + first.fillRects.length).toBeGreaterThan(
				0,
			);
			expect(typographyRecordingSignature(first)).not.toBe(
				typographyRecordingSignature(second),
			);
		}
		expect(early.get("hrJumpScare")?.scales.some(([x]) => x < 0.6)).toBe(true);
		expect(early.get("hrVhold")?.textDraws.length).toBeGreaterThanOrEqual(2);
		expect(early.get("hrMirrorSnap")?.scales.some(([x]) => x < 0)).toBe(true);
		expect(
			early.get("hrManifest")?.textDraws.some((draw) => draw.alpha < 1),
		).toBe(true);
		expect(early.get("hrClawReveal")?.fillRects.length).toBeGreaterThan(0);
	});

	test("horror holds preserve four distinct disturbances", () => {
		const holds = [
			"hrTwitch",
			"hrStare",
			"hrLagOne",
			"hrFlickerLight",
		] as const;
		const phaseA = new Map(
			holds.map((hold) => [
				hold,
				renderTypographyLayout({
					enter: "cut",
					exit: "cut",
					hold,
					layout: "center",
					sequenceTime: 6_000,
					style: "hrNightRec",
					text: "STARE INTO DARK",
				}),
			]),
		);
		const phaseB = new Map(
			holds.map((hold) => [
				hold,
				renderTypographyLayout({
					enter: "cut",
					exit: "cut",
					hold,
					layout: "center",
					sequenceTime: 42_000,
					style: "hrNightRec",
					text: "STARE INTO DARK",
				}),
			]),
		);
		expect(
			new Set([...phaseA.values()].map(typographyRecordingSignature)).size,
		).toBe(holds.length);
		for (const hold of holds) {
			expect(typographyRecordingSignature(phaseA.get(hold)!), hold).not.toBe(
				typographyRecordingSignature(phaseB.get(hold)!),
			);
		}
		expect(phaseA.get("hrTwitch")?.translations.length).toBeGreaterThan(10);
		expect(phaseA.get("hrStare")?.rotations.some((value) => value !== 0)).toBe(
			true,
		);
		expect(phaseA.get("hrLagOne")?.translations.length).toBeGreaterThan(10);
		expect(
			phaseA.get("hrFlickerLight")?.textDraws.some((draw) => draw.alpha < 1),
		).toBe(true);
	});

	test("horror exits preserve seven distinct disappearance signatures", () => {
		const exits = [
			"hrPulledDown",
			"hrLookBack",
			"hrTurnAway",
			"hrShiver",
			"hrSwallow",
			"hrFlickerDie",
			"hrDrain",
		] as const;
		const phaseA = new Map(
			exits.map((exit) => [
				exit,
				renderTypographyLayout({
					enter: "cut",
					exit,
					hold: "still",
					layout: "center",
					sequenceTime: 48_000,
					style: "hrNightRec",
					text: "DO NOT LOOK BACK",
				}),
			]),
		);
		const phaseB = new Map(
			exits.map((exit) => [
				exit,
				renderTypographyLayout({
					enter: "cut",
					exit,
					hold: "still",
					layout: "center",
					sequenceTime: 54_000,
					style: "hrNightRec",
					text: "DO NOT LOOK BACK",
				}),
			]),
		);
		expect(
			new Set([...phaseA.values()].map(typographyRecordingSignature)).size,
		).toBe(exits.length);
		for (const exit of exits) {
			expect(typographyRecordingSignature(phaseA.get(exit)!), exit).not.toBe(
				typographyRecordingSignature(phaseB.get(exit)!),
			);
		}
		expect(phaseB.get("hrPulledDown")?.scales.some(([, y]) => y > 1)).toBe(
			true,
		);
		expect(phaseB.get("hrLookBack")?.textDraws).toHaveLength(1);
		expect(phaseB.get("hrTurnAway")?.scales.some(([x]) => x < 0)).toBe(true);
		expect(phaseB.get("hrSwallow")?.fillRects.length).toBeGreaterThan(0);
		expect(phaseB.get("hrDrain")?.fillRects.length).toBeGreaterThan(0);
	});

	test("horror treatments preserve four distinct material signatures", () => {
		const treatments = [
			"hrInkBleed",
			"hrEroded",
			"hrRedact",
			"hrDoubleExp",
		] as const;
		const rendered = new Map(
			treatments.map((treat) => [
				treat,
				renderTypographyLayout({
					enter: "cut",
					exit: "cut",
					hold: "still",
					layout: "center",
					sequenceTime: 30_000,
					style: "hrCurse",
					text: "CURSED RECORD",
					treat,
				}),
			]),
		);
		expect(
			new Set([...rendered.values()].map(typographyRecordingSignature)).size,
		).toBe(treatments.length);
		expect(rendered.get("hrInkBleed")?.fillRects.length).toBeGreaterThan(0);
		expect(rendered.get("hrEroded")?.fillRects.length).toBeGreaterThan(10);
		expect(rendered.get("hrRedact")?.fillRects.length).toBeGreaterThanOrEqual(
			5,
		);
		expect(rendered.get("hrDoubleExp")?.scales.length).toBeGreaterThan(0);
	});

	test("horror decorations preserve seven distinct environmental signatures", () => {
		const decors = [
			"hrScratches",
			"hrSigil",
			"hrWatchEye",
			"hrStaticPatch",
			"hrDustBeam",
			"hrDrips",
			"hrCracks",
		] as const;
		const renderAt = ({
			decor,
			sequenceTime,
		}: {
			readonly decor: string;
			readonly sequenceTime: number;
		}) =>
			renderTypographyLayout({
				decor,
				enter: "cut",
				exit: "cut",
				hold: "still",
				layout: "center",
				sequenceTime,
				style: "hrNightRec",
				text: "WATCH THE CORNER",
			});
		const phaseA = new Map(
			decors.map((decor) => [decor, renderAt({ decor, sequenceTime: 24_000 })]),
		);
		const phaseB = new Map(
			decors.map((decor) => [decor, renderAt({ decor, sequenceTime: 54_000 })]),
		);
		expect(
			new Set([...phaseA.values()].map(typographyRecordingSignature)).size,
		).toBe(decors.length);
		for (const decor of decors) {
			expect(phaseA.get(decor)!.fillRects.length).toBeGreaterThan(0);
			expect(typographyRecordingSignature(phaseA.get(decor)!)).not.toBe(
				typographyRecordingSignature(phaseB.get(decor)!),
			);
		}
		expect(phaseA.get("hrSigil")!.rotations.length).toBeGreaterThan(10);
		expect(phaseA.get("hrStaticPatch")!.fillRects.length).toBeGreaterThan(20);
		expect(phaseB.get("hrDrips")!.fillRects.length).toBeGreaterThan(1);
	});

	test("horror backgrounds preserve lamp, corridor, stain, and forest signatures", () => {
		const backgrounds = [
			"hrFailingLamp",
			"hrCorridor",
			"hrMold",
			"hrDeadTrees",
		] as const;
		const renderAt = ({
			bg,
			sequenceTime,
		}: {
			readonly bg: string;
			readonly sequenceTime: number;
		}) =>
			renderTypographyLayout({
				bg,
				enter: "cut",
				exit: "cut",
				hold: "still",
				layout: "center",
				sequenceTime,
				style: "hrRuin",
				text: "EMPTY CORRIDOR",
			});
		const phaseA = new Map(
			backgrounds.map((background) => [
				background,
				renderAt({ bg: background, sequenceTime: 24_000 }),
			]),
		);
		const phaseB = new Map(
			backgrounds.map((background) => [
				background,
				renderAt({ bg: background, sequenceTime: 54_000 }),
			]),
		);
		expect(
			new Set([...phaseA.values()].map(typographyRecordingSignature)).size,
		).toBe(backgrounds.length);
		for (const background of backgrounds) {
			expect(phaseA.get(background)!.fillRects.length).toBeGreaterThan(5);
			expect(typographyRecordingSignature(phaseA.get(background)!)).not.toBe(
				typographyRecordingSignature(phaseB.get(background)!),
			);
		}
		expect(phaseA.get("hrCorridor")!.rotations.length).toBeGreaterThan(20);
		expect(phaseA.get("hrDeadTrees")!.rotations.length).toBeGreaterThan(100);
	});

	test("bgcam backgrounds preserve 37 distinct animated visual signatures", () => {
		const backgrounds = [
			"auroraRibbons",
			"meshBlobs",
			"duotoneSweep",
			"horizonGlow",
			"seigaiha",
			"asanoha",
			"houndstooth",
			"herringbone",
			"argyle",
			"tartan",
			"chevron",
			"isoCubes",
			"hexGrid",
			"triTess",
			"moire",
			"squareTunnel",
			"spiralArms",
			"topoLines",
			"ridgePlot",
			"starfield",
			"nightMoon",
			"skyline",
			"sunsetSun",
			"oceanWaves",
			"rainWindow",
			"snowLayers",
			"fireworks",
			"cloudLayers",
			"mountains",
			"filmStrip",
			"vhsBand",
			"tornPaper",
			"godRays",
			"vignettePulse",
			"kaleidoscope",
			"marble",
			"paperCut",
		] as const;
		const renderAt = ({
			bg,
			sequenceTime,
		}: {
			readonly bg: string;
			readonly sequenceTime: number;
		}) =>
			renderTypographyLayout({
				bg,
				cam: "static",
				enter: "cut",
				exit: "cut",
				hold: "still",
				layout: "center",
				sequenceTime,
				text: "BACKGROUND FIELD",
			});
		const phaseA = new Map(
			backgrounds.map((background) => [
				background,
				renderAt({ bg: background, sequenceTime: 18_000 }),
			]),
		);
		const phaseB = new Map(
			backgrounds.map((background) => [
				background,
				renderAt({ bg: background, sequenceTime: 48_000 }),
			]),
		);
		expect(
			new Set([...phaseA.values()].map(typographyRecordingSignature)).size,
		).toBe(backgrounds.length);
		for (const background of backgrounds) {
			expect(phaseA.get(background)!.fillRects.length).toBeGreaterThan(4);
			expect(typographyRecordingSignature(phaseA.get(background)!)).not.toBe(
				typographyRecordingSignature(phaseB.get(background)!),
			);
		}
	});

	test("bgcam cameras preserve 12 distinct deterministic motion signatures", () => {
		const cameras = [
			"orbitDrift",
			"barrelRoll",
			"pendulumSway",
			"focusIn",
			"rackFocus",
			"earthquake",
			"floatNoise",
			"vertigo",
			"tiltDown",
			"spiralIn",
			"snapPan",
			"jelly",
		] as const;
		const renderAt = ({
			cam,
			sequenceTime,
		}: {
			readonly cam: string;
			readonly sequenceTime: number;
		}) =>
			renderTypographyLayout({
				cam,
				enter: "cut",
				exit: "cut",
				hold: "still",
				layout: "center",
				sequenceTime,
				text: "CAMERA FIELD",
			});
		const phaseA = new Map(
			cameras.map((camera) => [
				camera,
				renderAt({ cam: camera, sequenceTime: 18_000 }),
			]),
		);
		const phaseB = new Map(
			cameras.map((camera) => [
				camera,
				renderAt({ cam: camera, sequenceTime: 48_000 }),
			]),
		);
		expect(
			new Set([...phaseA.values()].map(typographyRecordingSignature)).size,
		).toBe(cameras.length);
		for (const camera of cameras) {
			expect(typographyRecordingSignature(phaseA.get(camera)!)).not.toBe(
				typographyRecordingSignature(phaseB.get(camera)!),
			);
		}
		expect(phaseA.get("vertigo")!.transforms).toHaveLength(1);
		expect(phaseA.get("jelly")!.scales[0]?.[0]).not.toBe(
			phaseA.get("jelly")!.scales[0]?.[1],
		);
	});

	test("looks treatments preserve twenty source signatures and dynamic phases", () => {
		const treatments = [
			"doubleOutline",
			"extrude",
			"longShadow",
			"hardShadow",
			"softShadow",
			"marker",
			"strike",
			"boxed",
			"gradientV",
			"splitColor",
			"halftone",
			"stripes",
			"hatch",
			"dotted",
			"alternate",
			"italic",
			"wide",
			"tall",
			"echoOutline",
			"emphasisDots",
		] as const;
		const dynamicTreatments = [
			"extrude",
			"longShadow",
			"marker",
			"strike",
			"boxed",
			"halftone",
			"dotted",
			"echoOutline",
			"emphasisDots",
		] as const;
		const renderAt = ({
			sequenceTime,
			treat,
		}: {
			readonly sequenceTime: number;
			readonly treat: string;
		}) =>
			renderTypographyLayout({
				cam: "static",
				enter: "cut",
				exit: "cut",
				hold: "still",
				layout: "center",
				seed: 211,
				sequenceTime,
				text: "LOOKS TREATMENT",
				treat,
			});
		const phaseA = new Map(
			treatments.map((treat) => [
				treat,
				renderAt({ sequenceTime: 18_000, treat }),
			]),
		);
		const phaseB = new Map(
			treatments.map((treat) => [
				treat,
				renderAt({ sequenceTime: 36_000, treat }),
			]),
		);
		expect(
			new Set([...phaseA.values()].map(typographyRecordingSignature)).size,
		).toBe(treatments.length);
		for (const treat of dynamicTreatments) {
			expect(typographyRecordingSignature(phaseA.get(treat)!), treat).not.toBe(
				typographyRecordingSignature(phaseB.get(treat)!),
			);
		}
	});

	test("treattrans treatments preserve twenty-seven source signatures", () => {
		const treatments = [
			"neonOutline",
			"chrome",
			"rainbow",
			"glitchSplit",
			"shadowStack",
			"stencilGap",
			"waterline",
			"karaoke",
			"sizeWave",
			"rotateAlt",
			"baselineShift",
			"fauxBold",
			"circled",
			"bracketsQuote",
			"reflection",
			"inline",
			"sticker",
			"gradientSweep",
			"kerningWide",
			"monoGrid",
			"outlineOffset",
			"toneShadow",
			"fadeChars",
			"cutShift",
			"focusPull",
			"spotChar",
			"ransom",
		] as const;
		const dynamicTreatments = [
			"neonOutline",
			"rainbow",
			"glitchSplit",
			"stencilGap",
			"waterline",
			"karaoke",
			"sizeWave",
			"gradientSweep",
			"cutShift",
			"focusPull",
		] as const;
		const renderAt = ({
			sequenceTime,
			treat,
		}: {
			readonly sequenceTime: number;
			readonly treat: string;
		}) =>
			renderTypographyLayout({
				cam: "static",
				enter: "cut",
				exit: "cut",
				hold: "still",
				layout: "center",
				seed: 109,
				sequenceTime,
				text: "TREAT TRANS",
				treat,
			});
		const phaseA = new Map(
			treatments.map((treat) => [
				treat,
				renderAt({ sequenceTime: 18_000, treat }),
			]),
		);
		const phaseB = new Map(
			treatments.map((treat) => [
				treat,
				renderAt({ sequenceTime: 42_000, treat }),
			]),
		);
		expect(
			new Set([...phaseA.values()].map(typographyRecordingSignature)).size,
		).toBe(treatments.length);
		for (const treat of dynamicTreatments) {
			expect(typographyRecordingSignature(phaseA.get(treat)!), treat).not.toBe(
				typographyRecordingSignature(phaseB.get(treat)!),
			);
		}
		expect(
			phaseA
				.get("neonOutline")!
				.textDraws.filter((draw) => draw.kind === "stroke").length,
		).toBeGreaterThanOrEqual(2);
		expect(phaseA.get("chrome")!.rects.length).toBeGreaterThan(0);
		expect(phaseA.get("karaoke")!.rects.length).toBeGreaterThan(0);
		expect(phaseA.get("reflection")!.scales.some(([, y]) => y < 0)).toBe(true);
		expect(phaseA.get("ransom")!.fillRects.length).toBeGreaterThan(5);
		expect(phaseA.get("ransom")!.rotations.length).toBeGreaterThan(5);
	});

	test("looks backgrounds preserve twenty-four distinct animated signatures", () => {
		const backgrounds = [
			"sunburst",
			"concentric",
			"halftoneFade",
			"bigStripes",
			"splitV",
			"splitH",
			"splitDiag",
			"gradientSweep",
			"spotlight",
			"tvBars",
			"checker",
			"bigChar",
			"speedLines",
			"scanBars",
			"dotGrid",
			"retroGrid",
			"bokehBg",
			"particlesBg",
			"ripples",
			"polka",
			"eqBars",
			"borderFrame",
			"letterbox",
			"noiseField",
		] as const;
		const renderAt = ({
			bg,
			sequenceTime,
		}: {
			readonly bg: string;
			readonly sequenceTime: number;
		}) =>
			renderTypographyLayout({
				bg,
				cam: "static",
				enter: "cut",
				exit: "cut",
				hold: "still",
				layout: "center",
				seed: 223,
				sequenceTime,
				text: "LOOKS BACKGROUND",
			});
		const phaseA = new Map(
			backgrounds.map((bg) => [bg, renderAt({ bg, sequenceTime: 18_000 })]),
		);
		const phaseB = new Map(
			backgrounds.map((bg) => [bg, renderAt({ bg, sequenceTime: 42_000 })]),
		);
		expect(
			new Set([...phaseA.values()].map(typographyRecordingSignature)).size,
		).toBe(backgrounds.length);
		for (const bg of backgrounds) {
			expect(typographyRecordingSignature(phaseA.get(bg)!), bg).not.toBe(
				typographyRecordingSignature(phaseB.get(bg)!),
			);
		}
	});

	test("looks cameras preserve fifteen distinct absolute-time signatures", () => {
		const cameras = [
			"pullOut",
			"panL",
			"panR",
			"tiltUp",
			"dutch",
			"handheld",
			"beatPunch",
			"whipIn",
			"crashZoom",
			"bounce",
			"roll",
			"driftDiag",
			"shakeHard",
			"dollyIn",
			"stepZoom",
		] as const;
		const renderAt = ({
			cam,
			sequenceTime,
		}: {
			readonly cam: string;
			readonly sequenceTime: number;
		}) =>
			renderTypographyLayout({
				cam,
				enter: "cut",
				exit: "cut",
				hold: "still",
				layout: "center",
				seed: 227,
				sequenceTime,
				text: "LOOKS CAMERA",
			});
		const phaseA = new Map(
			cameras.map((cam) => [cam, renderAt({ cam, sequenceTime: 18_000 })]),
		);
		const phaseB = new Map(
			cameras.map((cam) => [cam, renderAt({ cam, sequenceTime: 42_000 })]),
		);
		expect(
			new Set([...phaseA.values()].map(typographyRecordingSignature)).size,
		).toBe(cameras.length);
		for (const cam of cameras) {
			expect(typographyRecordingSignature(phaseA.get(cam)!), cam).not.toBe(
				typographyRecordingSignature(phaseB.get(cam)!),
			);
		}
	});

	test("exitHold holds preserve 17 distinct absolute-time signatures", () => {
		const fixtures = [
			["shimmer", 18_000, 32_000],
			["colorRun", 18_000, 32_000],
			["rotateSlow", 18_000, 32_000],
			["trackBreathe", 18_000, 32_000],
			["skewWobble", 18_000, 32_000],
			["beatHop", 18_000, 32_000],
			["hWave", 18_000, 32_000],
			["heartbeat", 18_000, 32_000],
			["orbitSmall", 18_000, 32_000],
			["jelly", 18_000, 32_000],
			["scanBand", 18_000, 32_000],
			["noiseDrift", 18_000, 32_000],
			["tilt", 18_000, 32_000],
			["zoomSlow", 18_000, 32_000],
			["stretchPulse", 18_000, 32_000],
			["glitchJump", 1_000, 6_000],
			["echoTrail", 18_000, 32_000],
		] as const;
		const renderAt = ({
			hold,
			sequenceTime,
		}: {
			readonly hold: string;
			readonly sequenceTime: number;
		}) =>
			renderTypographyLayout({
				cam: "static",
				enter: "cut",
				exit: "cut",
				hold,
				layout: "center",
				seed: 77,
				sequenceTime,
				text: "MOTION SIGNAL",
			});
		const phaseA = new Map(
			fixtures.map(([hold, phaseATime]) => [
				hold,
				renderAt({ hold, sequenceTime: phaseATime }),
			]),
		);
		const phaseB = new Map(
			fixtures.map(([hold, , phaseBTime]) => [
				hold,
				renderAt({ hold, sequenceTime: phaseBTime }),
			]),
		);
		expect(
			new Set([...phaseA.values()].map(typographyRecordingSignature)).size,
		).toBe(fixtures.length);
		for (const [hold] of fixtures) {
			expect(typographyRecordingSignature(phaseA.get(hold)!), hold).not.toBe(
				typographyRecordingSignature(phaseB.get(hold)!),
			);
		}
		expect(phaseA.get("scanBand")!.fillRects.length).toBeGreaterThan(0);
		expect(phaseA.get("hWave")!.transforms.length).toBeGreaterThan(0);
	});

	test("exitHold exits preserve 34 distinct disappearance signatures", () => {
		const exits = [
			"sinkMask",
			"riseOut",
			"flipOutX",
			"flipOutY",
			"foldOut",
			"squash",
			"trackOutWide",
			"collapse",
			"zoomThrough",
			"zoomFar",
			"spinOut",
			"twist",
			"waveOut",
			"blurOutStagger",
			"undraw",
			"outlineOut",
			"irisClose",
			"diagWipeOut",
			"blindsClose",
			"checkerOut",
			"splitApart",
			"vSliceDrop",
			"melt",
			"dissolve",
			"backspace",
			"scrambleOut",
			"glitchDissolve",
			"echoOut",
			"whipOut",
			"gravity",
			"popOut",
			"burn",
			"sweepCover",
			"shatterLite",
		] as const;
		const renderAt = ({
			exit,
			sequenceTime,
		}: {
			readonly exit: string;
			readonly sequenceTime: number;
		}) =>
			renderTypographyLayout({
				cam: "static",
				enter: "cut",
				exit,
				hold: "still",
				layout: "center",
				seed: 83,
				sequenceTime,
				text: "EXIT SIGNAL",
			});
		const phaseA = new Map(
			exits.map((exit) => [exit, renderAt({ exit, sequenceTime: 46_000 })]),
		);
		const phaseB = new Map(
			exits.map((exit) => [exit, renderAt({ exit, sequenceTime: 52_000 })]),
		);
		expect(
			new Set([...phaseA.values()].map(typographyRecordingSignature)).size,
		).toBe(exits.length);
		for (const exit of exits) {
			expect(typographyRecordingSignature(phaseA.get(exit)!), exit).not.toBe(
				typographyRecordingSignature(phaseB.get(exit)!),
			);
		}
		expect(phaseA.get("shatterLite")!.textDraws.length).toBeGreaterThan(20);
		expect(phaseB.get("backspace")!.textDraws.length).toBeLessThan(
			phaseA.get("backspace")!.textDraws.length,
		);
		expect(phaseA.get("diagWipeOut")!.rotations.length).toBeGreaterThan(0);
	});

	test("exitB holds preserve twelve distinct absolute-time signatures", () => {
		const fixtures = [
			["glowFlicker", 18_000, 42_000],
			["windGust", 18_000, 42_000],
			["dangle", 18_000, 42_000],
			["eqBounce", 18_000, 42_000],
			["flashBox", 18_000, 6_000],
			["glintSweep", 56_000, 59_000],
			["flipSwap", 56_000, 59_000],
			["shadowSway", 18_000, 42_000],
			["magnetJiggle", 18_000, 42_000],
			["typeRattle", 18_000, 58_000],
			["focusRack", 18_000, 42_000],
			["pluckString", 56_000, 59_000],
		] as const;
		const renderAt = ({
			hold,
			sequenceTime,
		}: {
			readonly hold: string;
			readonly sequenceTime: number;
		}) =>
			renderTypographyLayout({
				cam: "static",
				enter: "cut",
				exit: "cut",
				hold,
				layout: "center",
				seed: 97,
				sequenceTime,
				text: "EXIT B HOLD",
			});
		const phaseA = new Map(
			fixtures.map(([hold, phaseATime]) => [
				hold,
				renderAt({ hold, sequenceTime: phaseATime }),
			]),
		);
		const phaseB = new Map(
			fixtures.map(([hold, , phaseBTime]) => [
				hold,
				renderAt({ hold, sequenceTime: phaseBTime }),
			]),
		);
		expect(
			new Set([...phaseA.values()].map(typographyRecordingSignature)).size,
		).toBe(fixtures.length);
		for (const [hold] of fixtures) {
			expect(typographyRecordingSignature(phaseA.get(hold)!), hold).not.toBe(
				typographyRecordingSignature(phaseB.get(hold)!),
			);
		}
		expect(phaseA.get("flashBox")!.fillRects.length).toBeGreaterThan(0);
		expect(phaseA.get("glintSweep")!.rects.length).toBeGreaterThan(0);
		expect(phaseA.get("shadowSway")!.textDraws.length).toBeGreaterThan(10);
	});

	test("exitB exits preserve thirty-nine distinct source signatures", () => {
		const exits = [
			"peelOff",
			"crumpleOut",
			"tearOut",
			"scorchOut",
			"overexposeOut",
			"scanOut",
			"stripesOut",
			"halftoneOut",
			"eraserOut",
			"vacuumOut",
			"sandOut",
			"shredOut",
			"dominoOut",
			"hingeOut",
			"rocketOff",
			"bounceOff",
			"balloonOff",
			"deflateOut",
			"hazeOut",
			"glassBreak",
			"zipOut",
			"clapShut",
			"lampOff",
			"slotOut",
			"clockOut",
			"matrixOut",
			"tornadoOut",
			"rollUpOut",
			"snakeOut",
			"flutterOut",
			"rollOff",
			"fanClose",
			"rgbSplitOut",
			"shockOut",
			"floodOut",
			"slashOut",
			"mosaicOut",
			"scribbleOut",
			"candleOut",
		] as const;
		const renderAt = ({
			exit,
			sequenceTime,
		}: {
			readonly exit: string;
			readonly sequenceTime: number;
		}) =>
			renderTypographyLayout({
				cam: "static",
				enter: "cut",
				exit,
				hold: "still",
				layout: "center",
				seed: 101,
				sequenceTime,
				text: "EXIT B SIGNAL",
			});
		const phaseA = new Map(
			exits.map((exit) => [exit, renderAt({ exit, sequenceTime: 46_000 })]),
		);
		const phaseB = new Map(
			exits.map((exit) => [exit, renderAt({ exit, sequenceTime: 52_000 })]),
		);
		expect(
			new Set([...phaseA.values()].map(typographyRecordingSignature)).size,
		).toBe(exits.length);
		for (const exit of exits) {
			expect(typographyRecordingSignature(phaseA.get(exit)!), exit).not.toBe(
				typographyRecordingSignature(phaseB.get(exit)!),
			);
		}
		expect(phaseA.get("glassBreak")!.textDraws.length).toBeGreaterThan(10);
		expect(phaseA.get("matrixOut")!.text.length).toBeGreaterThan(10);
		expect(phaseA.get("mosaicOut")!.rects.length).toBeGreaterThan(12);
		expect(phaseA.get("scribbleOut")!.fillRects.length).toBeGreaterThan(4);
	});

	test("core decors preserve 15 distinct animated signatures and source layers", () => {
		const decors = [
			"grid",
			"stripes",
			"blobs",
			"bars",
			"shapes",
			"counter",
			"brackets",
			"rings",
			"dots",
			"arrows",
			"slash",
			"sparks",
			"leaders",
			"waveform",
			"barcode",
		] as const;
		const renderAt = ({
			decor,
			sequenceTime,
		}: {
			readonly decor: string;
			readonly sequenceTime: number;
		}) =>
			renderTypographyLayout({
				cam: "static",
				decor,
				enter: "cut",
				exit: "cut",
				hold: "still",
				layout: "center",
				seed: 89,
				sequenceTime,
				text: "DECOR SIGNAL",
			});
		const phaseA = new Map(
			decors.map((decor) => [decor, renderAt({ decor, sequenceTime: 18_000 })]),
		);
		const phaseB = new Map(
			decors.map((decor) => [decor, renderAt({ decor, sequenceTime: 42_000 })]),
		);
		expect(
			new Set([...phaseA.values()].map(typographyRecordingSignature)).size,
		).toBe(decors.length);
		for (const decor of decors) {
			expect(typographyRecordingSignature(phaseA.get(decor)!), decor).not.toBe(
				typographyRecordingSignature(phaseB.get(decor)!),
			);
		}
		const gridEvents = phaseA.get("grid")!.drawEvents;
		const barcodeEvents = phaseA.get("barcode")!.drawEvents;
		const gridRect = gridEvents.findIndex((event) => event.kind === "rect");
		const gridText = gridEvents.findIndex(
			(event) => event.kind === "text" && event.text === "DECOR SIGNAL",
		);
		const barcodeRect = barcodeEvents.findIndex(
			(event) => event.kind === "rect",
		);
		const barcodeText = barcodeEvents.findIndex(
			(event) => event.kind === "text" && event.text === "DECOR SIGNAL",
		);
		expect(gridRect).toBeGreaterThanOrEqual(0);
		expect(gridRect).toBeLessThan(gridText);
		expect(barcodeText).toBeGreaterThanOrEqual(0);
		expect(barcodeText).toBeLessThan(barcodeRect);
	});

	test("extended decors preserve forty-five source signatures and layer ownership", () => {
		const decors = [
			"crosshair",
			"cropMarks",
			"reticle",
			"radar",
			"progressRing",
			"timecodeBar",
			"rulerEdge",
			"dimension",
			"indexNum",
			"dateStamp",
			"qrBlock",
			"glitchRects",
			"concentricSquares",
			"triangleSpin",
			"lineBurst",
			"plusGrid",
			"guides",
			"waveLine",
			"spiralLine",
			"halftonePatch",
			"checkerStrip",
			"beatRing",
			"orbitDots",
			"constellation",
			"confetti",
			"petals",
			"rainStreaks",
			"snow",
			"lightLeak",
			"bokeh",
			"speedCorner",
			"risingParticles",
			"twinkle",
			"brushStroke",
			"tapePieces",
			"scribbleCircle",
			"scribbleUnder",
			"crossOut",
			"highlightMark",
			"heartsStars",
			"watermarkKanji",
			"verticalStrip",
			"romajiLine",
			"bracketsJP",
			"seal",
		] as const;
		const renderAt = ({
			decor,
			sequenceTime,
		}: {
			readonly decor: string;
			readonly sequenceTime: number;
		}) =>
			renderTypographyLayout({
				cam: "static",
				decor,
				enter: "cut",
				exit: "cut",
				hold: "still",
				layout: "center",
				seed: 163,
				sequenceTime,
				text: "装飾 DECOR SIGNAL",
			});
		const phaseA = new Map(
			decors.map((decor) => [decor, renderAt({ decor, sequenceTime: 18_000 })]),
		);
		const phaseB = new Map(
			decors.map((decor) => [decor, renderAt({ decor, sequenceTime: 42_000 })]),
		);
		expect(
			new Set([...phaseA.values()].map(typographyRecordingSignature)).size,
		).toBe(decors.length);
		for (const decor of decors) {
			expect(typographyRecordingSignature(phaseA.get(decor)!), decor).not.toBe(
				typographyRecordingSignature(phaseB.get(decor)!),
			);
		}
		expect(phaseA.get("qrBlock")!.fillRects.length).toBeGreaterThan(30);
		expect(phaseA.get("lineBurst")!.rotations.length).toBeGreaterThan(25);
		expect(phaseA.get("plusGrid")!.rotations.length).toBeGreaterThan(50);
		expect(phaseA.get("rainStreaks")!.rotations.length).toBeGreaterThan(30);
		expect(phaseA.get("bokeh")!.fillRects.length).toBeGreaterThan(35);
		expect(phaseA.get("scribbleCircle")!.rotations.length).toBeGreaterThan(100);
		expect(phaseA.get("verticalStrip")!.textDraws.length).toBeGreaterThan(5);

		const halftoneEvents = phaseA.get("halftonePatch")!.drawEvents;
		const qrEvents = phaseA.get("qrBlock")!.drawEvents;
		const halftoneRect = halftoneEvents.findIndex(
			(event) => event.kind === "rect",
		);
		const halftoneText = halftoneEvents.findIndex(
			(event) => event.kind === "text" && event.text === "装飾 DECOR SIGNAL",
		);
		const qrRect = qrEvents.findIndex((event) => event.kind === "rect");
		const qrText = qrEvents.findIndex(
			(event) => event.kind === "text" && event.text === "装飾 DECOR SIGNAL",
		);
		expect(halftoneRect).toBeGreaterThanOrEqual(0);
		expect(halftoneRect).toBeLessThan(halftoneText);
		expect(qrText).toBeGreaterThanOrEqual(0);
		expect(qrText).toBeLessThan(qrRect);
	});

	test("decorB preserves fifty-five source signatures and layer ownership", () => {
		const decors = [
			"kamon",
			"seigaiha",
			"asanoha",
			"hanabi",
			"chochin",
			"shimenawa",
			"sensu",
			"tsukiKumo",
			"momiji",
			"namiGashira",
			"kasumi",
			"hexGrid",
			"spectrumRing",
			"dataColumns",
			"spinner",
			"headingTape",
			"glyphLock",
			"atomOrbit",
			"sonarArcs",
			"circuit",
			"swatches",
			"ruledLines",
			"registration",
			"punchHoles",
			"staple",
			"paperClip",
			"indexTabs",
			"vines",
			"cloudPuffs",
			"starField",
			"moonPhases",
			"sunRays",
			"rainRipples",
			"bubbles",
			"smoke",
			"dandelion",
			"fireflies",
			"memphis",
			"zigzagRibbon",
			"polkaPatch",
			"stripeCircle",
			"decoCorners",
			"halfCircles",
			"loopArrows",
			"starburst",
			"tally",
			"cursorClick",
			"windowChrome",
			"progressBar",
			"toggleSwitch",
			"notifBell",
			"likeCounter",
			"mediaControls",
			"volumeBars",
			"musicNotes",
		] as const;
		const renderAt = ({
			decor,
			sequenceTime,
		}: {
			readonly decor: string;
			readonly sequenceTime: number;
		}) =>
			renderTypographyLayout({
				cam: "static",
				decor,
				enter: "cut",
				exit: "cut",
				hold: "still",
				layout: "center",
				seed: 191,
				sequenceTime,
				text: "装飾 GRAPHIC SIGNAL",
			});
		const phaseA = new Map(
			decors.map((decor) => [decor, renderAt({ decor, sequenceTime: 18_000 })]),
		);
		const phaseB = new Map(
			decors.map((decor) => [decor, renderAt({ decor, sequenceTime: 66_000 })]),
		);
		expect(
			new Set([...phaseA.values()].map(typographyRecordingSignature)).size,
		).toBe(decors.length);
		for (const decor of decors) {
			expect(typographyRecordingSignature(phaseA.get(decor)!), decor).not.toBe(
				typographyRecordingSignature(phaseB.get(decor)!),
			);
		}
		expect(phaseA.get("asanoha")!.rotations.length).toBeGreaterThan(0);
		expect(phaseA.get("spectrumRing")!.rotations.length).toBeGreaterThan(30);
		expect(phaseA.get("starField")!.fillRects.length).toBeGreaterThan(40);
		expect(phaseA.get("volumeBars")!.fillRects.length).toBeGreaterThan(15);
		expect(phaseA.get("musicNotes")!.rotations.length).toBeGreaterThan(15);

		const backEvents = phaseA.get("ruledLines")!.drawEvents;
		const frontEvents = phaseA.get("windowChrome")!.drawEvents;
		const backRect = backEvents.findIndex((event) => event.kind === "rect");
		const backText = backEvents.findIndex(
			(event) => event.kind === "text" && event.text === "装飾 GRAPHIC SIGNAL",
		);
		const frontRect = frontEvents.findIndex((event) => event.kind === "rect");
		const frontText = frontEvents.findIndex(
			(event) => event.kind === "text" && event.text === "装飾 GRAPHIC SIGNAL",
		);
		expect(backRect).toBeGreaterThanOrEqual(0);
		expect(backRect).toBeLessThan(backText);
		expect(frontText).toBeGreaterThanOrEqual(0);
		expect(frontText).toBeLessThan(frontRect);
	});

	test("horror cameras preserve handheld flinch and dutch-snap motion", () => {
		const cameras = ["hrNervous", "hrDutchSnap"] as const;
		const renderAt = ({
			cam,
			sequenceTime,
		}: {
			readonly cam: string;
			readonly sequenceTime: number;
		}) =>
			renderTypographyLayout({
				cam,
				enter: "cut",
				exit: "cut",
				hold: "still",
				layout: "center",
				sequenceTime,
				style: "hrNightRec",
				text: "CAMERA MOVES",
			});
		const phaseA = new Map(
			cameras.map((camera) => [
				camera,
				renderAt({ cam: camera, sequenceTime: 18_000 }),
			]),
		);
		const phaseB = new Map(
			cameras.map((camera) => [
				camera,
				renderAt({ cam: camera, sequenceTime: 48_000 }),
			]),
		);
		expect(
			new Set([...phaseB.values()].map(typographyRecordingSignature)).size,
		).toBe(cameras.length);
		for (const camera of cameras) {
			expect(typographyRecordingSignature(phaseA.get(camera)!)).not.toBe(
				typographyRecordingSignature(phaseB.get(camera)!),
			);
		}
		expect(
			phaseB
				.get("hrNervous")!
				.translations.some(([x, y]) => x !== 0 || y !== 0),
		).toBe(true);
		expect(
			phaseB
				.get("hrDutchSnap")!
				.rotations.some((angle) => Math.abs(angle) > 0.02),
		).toBe(true);
	});

	test("horror screen effects preserve subliminal, signal-loss, and shadow signatures", () => {
		const effects = [
			"hrSubliminal",
			"hrSignalLoss",
			"hrPassingShadow",
		] as const;
		const renderAt = ({
			effect,
			sequenceTime,
		}: {
			readonly effect: string;
			readonly sequenceTime: number;
		}) =>
			renderTypographyLayout({
				enter: "cut",
				exit: "cut",
				fx: [effect],
				hold: "still",
				layout: "center",
				sequenceTime,
				style: "hrNightRec",
				text: "NO SIGNAL",
			});
		const phaseA = new Map(
			effects.map((effect) => [
				effect,
				renderAt({ effect, sequenceTime: 12_000 }),
			]),
		);
		const phaseB = new Map(
			effects.map((effect) => [
				effect,
				renderAt({ effect, sequenceTime: 30_000 }),
			]),
		);
		expect(
			new Set([...phaseA.values()].map(typographyRecordingSignature)).size,
		).toBe(effects.length);
		for (const effect of effects) {
			expect(typographyRecordingSignature(phaseA.get(effect)!)).not.toBe(
				typographyRecordingSignature(phaseB.get(effect)!),
			);
		}
		expect(phaseA.get("hrSubliminal")!.scales.some(([x]) => x > 1.2)).toBe(
			true,
		);
		expect(phaseB.get("hrSignalLoss")!.text).toContain("NO SIGNAL");
		expect(
			phaseA.get("hrPassingShadow")!.fillRects.length,
		).toBeGreaterThanOrEqual(3);
	});

	test("core screen effects preserve eight distinct deterministic post-process signatures", () => {
		const effects = [
			"chroma",
			"shake",
			"slice",
			"block",
			"invert",
			"flash",
			"zoom",
			"mosaic",
		] as const;
		const renderAt = ({
			effect,
			sequenceTime,
		}: {
			readonly effect: string;
			readonly sequenceTime: number;
		}) =>
			renderTypographyLayout({
				cam: "static",
				enter: "cut",
				exit: "cut",
				fx: [effect],
				hold: "still",
				layout: "center",
				sequenceTime,
				text: "GLITCH SIGNAL",
			});
		const phaseA = new Map(
			effects.map((effect) => [
				effect,
				renderAt({ effect, sequenceTime: 24_000 }),
			]),
		);
		const phaseB = new Map(
			effects.map((effect) => [
				effect,
				renderAt({ effect, sequenceTime: 84_000 }),
			]),
		);
		expect(
			new Set([...phaseA.values()].map(typographyRecordingSignature)).size,
		).toBe(effects.length);
		for (const effect of effects) {
			expect(typographyRecordingSignature(phaseA.get(effect)!)).not.toBe(
				typographyRecordingSignature(phaseB.get(effect)!),
			);
		}
		expect(
			phaseA
				.get("shake")!
				.translations.some(
					([x, y]) => Math.abs(x - 320) > 1 || Math.abs(y - 180) > 1,
				),
		).toBe(true);
		expect(phaseA.get("mosaic")!.fillRects.length).toBeGreaterThan(
			phaseA.get("chroma")!.fillRects.length,
		);
	});

	test("looks screen effects preserve twenty-four fallback signatures", () => {
		const effects = [
			"panelWipe",
			"irisTrans",
			"doors",
			"blindsTrans",
			"rgbSplit",
			"smear",
			"vhsRoll",
			"trackingNoise",
			"mirrorFlash",
			"strobe",
			"posterize",
			"hueShift",
			"tileShift",
			"filmBurn",
			"whipBlur",
			"blackFrame",
			"whiteFrame",
			"gridRepeat",
			"waveWarp",
			"pixelDrift",
			"zoomPunch",
			"lightSweep",
			"crtOff",
			"splitSlide",
		] as const;
		const renderAt = ({
			effect,
			sequenceTime,
		}: {
			readonly effect: string;
			readonly sequenceTime: number;
		}) =>
			renderTypographyLayout({
				cam: "static",
				enter: "cut",
				exit: "cut",
				fx: [effect],
				hold: "still",
				layout: "center",
				seed: 229,
				sequenceTime,
				text: "LOOKS EFFECT",
			});
		const phaseA = new Map(
			effects.map((effect) => [
				effect,
				renderAt({ effect, sequenceTime: 18_000 }),
			]),
		);
		const phaseB = new Map(
			effects.map((effect) => [
				effect,
				renderAt({ effect, sequenceTime: 42_000 }),
			]),
		);
		expect(
			new Set([...phaseA.values()].map(typographyRecordingSignature)).size,
		).toBe(effects.length);
		for (const effect of effects) {
			expect(
				typographyRecordingSignature(phaseA.get(effect)!),
				effect,
			).not.toBe(typographyRecordingSignature(phaseB.get(effect)!));
		}
	});

	test("fxB screen effects preserve thirty-four source-family signatures", () => {
		const effects = [
			"radialChroma",
			"bloomFlash",
			"bulge",
			"pixelSort",
			"interlace",
			"macroBlock",
			"halftone",
			"duotone",
			"ditherBit",
			"rotateSnap",
			"echoFrames",
			"kaleido",
			"bandInvert",
			"lightRays",
			"anamorphic",
			"heartbeat",
			"tvStatic",
			"dustScratches",
			"filmAdvance",
			"perspectiveTilt",
			"ripple",
			"focusLines",
			"speedLines",
			"starGlint",
			"colorBars",
			"zoomStutter",
			"negativeRing",
			"edgeDetect",
			"shatter",
			"defocus",
			"snapshot",
			"squash",
			"scanBar",
			"loopScroll",
		] as const;
		const renderAt = ({
			effect,
			sequenceTime,
		}: {
			readonly effect: string;
			readonly sequenceTime: number;
		}) =>
			renderTypographyLayout({
				cam: "static",
				enter: "cut",
				exit: "cut",
				fx: [effect],
				hold: "still",
				layout: "center",
				seed: 311,
				sequenceTime,
				text: "FX B SIGNAL",
			});
		const phaseA = new Map(
			effects.map((effect) => [
				effect,
				renderAt({ effect, sequenceTime: 24_000 }),
			]),
		);
		const phaseB = new Map(
			effects.map((effect) => [
				effect,
				renderAt({ effect, sequenceTime: 84_000 }),
			]),
		);
		expect(
			new Set([...phaseA.values()].map(typographyRecordingSignature)).size,
		).toBe(effects.length);
		for (const effect of effects) {
			expect(
				typographyRecordingSignature(phaseA.get(effect)!),
				effect,
			).not.toBe(typographyRecordingSignature(phaseB.get(effect)!));
		}
		expect(phaseA.get("negativeRing")!.fillRects.length).toBeGreaterThan(
			phaseA.get("radialChroma")!.fillRects.length,
		);
		expect(
			phaseA.get("perspectiveTilt")!.rotations.some((angle) => angle !== 0),
		).toBe(true);
	});

	test("horror transitions preserve static drowning and eyelid closure", () => {
		const staticPhaseA = renderTypographyTransition({
			trans: "hrStaticCut",
			sequenceTime: 68_000,
		});
		const staticPhaseB = renderTypographyTransition({
			trans: "hrStaticCut",
			sequenceTime: 74_000,
		});
		const blinkPhaseA = renderTypographyTransition({
			trans: "hrBlink",
			sequenceTime: 68_000,
		});
		const blinkPhaseB = renderTypographyTransition({
			trans: "hrBlink",
			sequenceTime: 74_000,
		});
		expect(staticPhaseA.fillRects.length).toBeGreaterThan(20);
		expect(blinkPhaseA.fillRects.length).toBeGreaterThanOrEqual(24);
		expect(typographyRecordingSignature(staticPhaseA)).not.toBe(
			typographyRecordingSignature(staticPhaseB),
		);
		expect(typographyRecordingSignature(blinkPhaseA)).not.toBe(
			typographyRecordingSignature(blinkPhaseB),
		);
		expect(typographyRecordingSignature(staticPhaseA)).not.toBe(
			typographyRecordingSignature(blinkPhaseA),
		);
	});

	test("typography entrances stage distinct glyph behavior before settling", () => {
		const renderEntrance = ({
			enter,
			sequenceTime,
			text,
		}: {
			readonly enter: string;
			readonly sequenceTime: number;
			readonly text: string;
		}) =>
			renderTypographyLayout({
				enter,
				layout: "center",
				sequenceTime,
				text,
			});
		const assertSettles = ({
			early,
			enter,
			text,
		}: {
			readonly early: ReturnType<typeof renderTypographyLayout>;
			readonly enter: string;
			readonly text: string;
		}) => {
			const settled = renderEntrance({ enter, sequenceTime: 30_000, text });
			expect(settled.text, enter).toContain(text);
			expect(early.text, enter).not.toEqual(settled.text);
			return settled;
		};

		const keyFirst = renderEntrance({
			enter: "tyKeyFirst",
			sequenceTime: 4_000,
			text: "small EMPHASIS tail",
		});
		expect(keyFirst.text).toEqual(["E"]);
		expect(keyFirst.scales.some(([x, y]) => x > 1 && y > 1)).toBe(true);
		assertSettles({
			early: keyFirst,
			enter: "tyKeyFirst",
			text: "small EMPHASIS tail",
		});

		const lineWipe = renderEntrance({
			enter: "tyLineWipe",
			sequenceTime: 9_000,
			text: "LINE WIPE",
		});
		expect(lineWipe.rects.length).toBeGreaterThan(0);
		expect(lineWipe.fillRects.length).toBeGreaterThan(0);
		assertSettles({ early: lineWipe, enter: "tyLineWipe", text: "LINE WIPE" });

		const zoomOne = renderEntrance({
			enter: "tyZoomOne",
			sequenceTime: 9_000,
			text: "ZOOM IN",
		});
		expect(zoomOne.scales.some(([x, y]) => x > 1 && y > 1)).toBe(true);
		expect(
			zoomOne.translations.some(([x, y]) => Math.abs(x) > 1 || Math.abs(y) > 1),
		).toBe(true);
		assertSettles({ early: zoomOne, enter: "tyZoomOne", text: "ZOOM IN" });

		const underLift = renderEntrance({
			enter: "tyUnderLift",
			sequenceTime: 9_000,
			text: "UNDER LIFT",
		});
		expect(underLift.fillRects.length).toBeGreaterThan(0);
		expect(underLift.scales.some(([, y]) => Math.abs(y - 1) > 0.01)).toBe(true);
		assertSettles({
			early: underLift,
			enter: "tyUnderLift",
			text: "UNDER LIFT",
		});

		const dotGrow = renderEntrance({
			enter: "tyDotGrow",
			sequenceTime: 4_500,
			text: "DOTS",
		});
		expect(dotGrow.text).toContain("・");
		expect(dotGrow.scales.length).toBeGreaterThan(0);
		assertSettles({ early: dotGrow, enter: "tyDotGrow", text: "DOTS" });

		const bracketOpen = renderEntrance({
			enter: "tyBracketOpen",
			sequenceTime: 9_000,
			text: "BRACKET",
		});
		expect(bracketOpen.rects).toHaveLength(1);
		expect(bracketOpen.fillRects).toHaveLength(4);
		assertSettles({
			early: bracketOpen,
			enter: "tyBracketOpen",
			text: "BRACKET",
		});

		const retype = renderEntrance({
			enter: "tyRetype",
			sequenceTime: 9_000,
			text: "RETYPE",
		});
		expect(retype.text).toContain("あ");
		expect(retype.fillRects).toHaveLength(1);
		assertSettles({ early: retype, enter: "tyRetype", text: "RETYPE" });

		const rubyDrop = renderEntrance({
			enter: "tyRubyDrop",
			sequenceTime: 4_500,
			text: "RUBY",
		});
		expect(rubyDrop.scales.some(([x, y]) => x < 1 && y < 1)).toBe(true);
		expect(rubyDrop.translations.some(([, y]) => y < 0)).toBe(true);
		const rubySettled = assertSettles({
			early: rubyDrop,
			enter: "tyRubyDrop",
			text: "RUBY",
		});
		expect(rubyDrop.textDraws[0]?.fillStyle).not.toBe(
			rubySettled.textDraws[0]?.fillStyle,
		);
	});

	test("enterB entrances preserve forty-seven source signatures", () => {
		const entrances = [
			"springIn",
			"pendulum",
			"rollIn",
			"slingshot",
			"rockSettle",
			"bounceBall",
			"snapRail",
			"fanOpen",
			"cylinder",
			"shuffle",
			"stopMotion",
			"ripple",
			"zipper",
			"zoomAlt",
			"tiltUp",
			"stickerPeel",
			"crumple",
			"noteUnfold",
			"tornJoin",
			"splitFlap",
			"overexpose",
			"glint",
			"loupe",
			"filmFeed",
			"backlight",
			"lightLeak",
			"heatHaze",
			"crtOn",
			"interlace",
			"loadingBar",
			"dither",
			"odometer",
			"matrixRain",
			"hatchFill",
			"brushReveal",
			"inkDrop",
			"quarters",
			"invertBox",
			"printRegister",
			"echoCount",
			"liquidFill",
			"windBlown",
			"strokeOrder",
			"clockWipe",
			"shadowFirst",
			"bubbles",
			"tokoroten",
		] as const;
		const renderAt = ({
			enter,
			sequenceTime,
		}: {
			readonly enter: string;
			readonly sequenceTime: number;
		}) =>
			renderTypographyLayout({
				cam: "static",
				enter,
				exit: "cut",
				hold: "still",
				layout: "center",
				seed: 131,
				sequenceTime,
				text: "ENTER B SIGNAL",
			});
		const phaseA = new Map(
			entrances.map((enter) => [
				enter,
				renderAt({ enter, sequenceTime: 12_000 }),
			]),
		);
		const phaseB = new Map(
			entrances.map((enter) => [
				enter,
				renderAt({ enter, sequenceTime: 24_000 }),
			]),
		);
		expect(
			new Set([...phaseA.values()].map(typographyRecordingSignature)).size,
		).toBe(entrances.length);
		for (const enter of entrances) {
			expect(typographyRecordingSignature(phaseA.get(enter)!), enter).not.toBe(
				typographyRecordingSignature(phaseB.get(enter)!),
			);
		}
		expect(phaseA.get("pendulum")!.rotations.length).toBeGreaterThan(10);
		expect(phaseA.get("bounceBall")!.fillRects.length).toBeGreaterThan(0);
		expect(phaseA.get("interlace")!.rects.length).toBeGreaterThan(4);
		expect(phaseA.get("dither")!.rects.length).toBeGreaterThan(20);
		expect(phaseA.get("matrixRain")!.textDraws.length).toBeGreaterThan(15);
		expect(phaseA.get("brushReveal")!.rects.length).toBeGreaterThan(4);
		expect(phaseA.get("quarters")!.rects.length).toBeGreaterThanOrEqual(4);
		expect(phaseA.get("clockWipe")!.fillRects.length).toBeGreaterThan(5);
	});

	test("enter source family preserves thirty-eight native signatures", () => {
		const entrances = [
			"riseMask",
			"dropMask",
			"slideWhole",
			"flipX",
			"flipY",
			"domino",
			"fold",
			"unroll",
			"strokeDraw",
			"outlineFill",
			"splitJoin",
			"vSlice",
			"shutter",
			"iris",
			"diagWipe",
			"blinds",
			"checker",
			"randomOrder",
			"bounceBig",
			"squashDrop",
			"rubber",
			"glitchIn",
			"echoIn",
			"whip",
			"skewIn",
			"trackIn",
			"trackOut",
			"blurStagger",
			"fadeStagger",
			"waveIn",
			"spiralIn",
			"zoomOut",
			"resolve",
			"magnet",
			"inkBleed",
			"neonOn",
			"cursorSweep",
			"stamp",
		] as const;
		const renderAt = ({
			enter,
			sequenceTime,
		}: {
			readonly enter: string;
			readonly sequenceTime: number;
		}) =>
			renderTypographyLayout({
				cam: "static",
				enter,
				exit: "cut",
				hold: "still",
				layout: "center",
				seed: 137,
				sequenceTime,
				text: "ENTER A SIGNAL",
			});
		const phaseA = new Map(
			entrances.map((enter) => [
				enter,
				renderAt({ enter, sequenceTime: 12_000 }),
			]),
		);
		const phaseB = new Map(
			entrances.map((enter) => [
				enter,
				renderAt({ enter, sequenceTime: 24_000 }),
			]),
		);
		expect(
			new Set([...phaseA.values()].map(typographyRecordingSignature)).size,
		).toBe(entrances.length);
		for (const enter of entrances) {
			expect(typographyRecordingSignature(phaseA.get(enter)!), enter).not.toBe(
				typographyRecordingSignature(phaseB.get(enter)!),
			);
		}
		expect(phaseA.get("flipX")!.text.some((value) => value === "■")).toBe(true);
		expect(
			phaseA
				.get("strokeDraw")!
				.textDraws.some((draw) => draw.kind === "stroke"),
		).toBe(true);
		expect(phaseA.get("vSlice")!.rects.length).toBeGreaterThan(3);
		expect(phaseA.get("checker")!.rects.length).toBeGreaterThan(8);
		expect(
			phaseA.get("echoIn")!.textDraws.filter((draw) => draw.kind === "stroke")
				.length,
		).toBeGreaterThan(3);
		expect(phaseA.get("resolve")!.fillRects.length).toBeGreaterThan(0);
		expect(phaseA.get("stamp")!.rotations.length).toBeGreaterThan(0);
	});

	test("typography holds animate only their intended glyph signature", () => {
		const renderHold = ({
			hold,
			sequenceTime,
			text,
		}: {
			readonly hold: string;
			readonly sequenceTime: number;
			readonly text: string;
		}) =>
			renderTypographyLayout({
				enter: "cut",
				hold,
				layout: "center",
				sequenceTime,
				text,
			});

		const keyPulseHigh = renderHold({
			hold: "tyKeyPulse",
			sequenceTime: 30_000,
			text: "small EMPHASIS tail",
		});
		const keyPulseLow = renderHold({
			hold: "tyKeyPulse",
			sequenceTime: 59_000,
			text: "small EMPHASIS tail",
		});
		expect(keyPulseHigh.text).toHaveLength(17);
		expect(Math.max(...keyPulseHigh.scales.map(([x]) => x))).toBeGreaterThan(
			Math.max(...keyPulseLow.scales.map(([x]) => x)),
		);

		const readFirst = renderHold({
			hold: "tyReadCursor",
			sequenceTime: 21_000,
			text: "READ",
		});
		const readSecond = renderHold({
			hold: "tyReadCursor",
			sequenceTime: 33_000,
			text: "READ",
		});
		expect(
			new Set(readFirst.textDraws.map((draw) => draw.fillStyle)).size,
		).toBe(2);
		expect(readFirst.textDraws).not.toEqual(readSecond.textDraws);

		const outlineBlink = renderHold({
			hold: "tyOutlineBlink",
			sequenceTime: 24_000,
			text: "OUTLINE",
		});
		const outlineRest = renderHold({
			hold: "tyOutlineBlink",
			sequenceTime: 32_000,
			text: "OUTLINE",
		});
		expect(outlineBlink.textDraws.some((draw) => draw.kind === "stroke")).toBe(
			true,
		);
		expect(outlineRest.text).toEqual(["OUTLINE"]);

		const trackTight = renderHold({
			hold: "tyTrackStep",
			sequenceTime: 30_000,
			text: "TRACK",
		});
		const trackWide = renderHold({
			hold: "tyTrackStep",
			sequenceTime: 59_000,
			text: "TRACK",
		});
		const spread = (draws: typeof trackTight.textDraws) =>
			Math.max(...draws.map((draw) => draw.x)) -
			Math.min(...draws.map((draw) => draw.x));
		expect(spread(trackWide.textDraws)).toBeGreaterThan(
			spread(trackTight.textDraws),
		);
	});

	test("typography exits retain their distinct collapse and replacement signatures", () => {
		const renderExit = ({
			exit,
			sequenceTime,
			text,
		}: {
			readonly exit: string;
			readonly sequenceTime: number;
			readonly text: string;
		}) =>
			renderTypographyLayout({
				enter: "cut",
				exit,
				hold: "still",
				layout: "center",
				sequenceTime,
				text,
			});
		const assertChangesFromRest = ({
			exit,
			phase,
			text,
		}: {
			readonly exit: string;
			readonly phase: ReturnType<typeof renderTypographyLayout>;
			readonly text: string;
		}) => {
			const rest = renderExit({ exit, sequenceTime: 30_000, text });
			expect(rest.text, exit).toContain(text);
			expect(phase.textDraws, exit).not.toEqual(rest.textDraws);
		};

		const strike = renderExit({
			exit: "tyStrike",
			sequenceTime: 53_000,
			text: "STRIKE",
		});
		expect(strike.fillRects.length).toBeGreaterThan(0);
		expect(strike.scales.some(([, y]) => y < 0.99)).toBe(true);
		assertChangesFromRest({ exit: "tyStrike", phase: strike, text: "STRIKE" });

		const toDot = renderExit({
			exit: "tyToDot",
			sequenceTime: 50_000,
			text: "DOTS",
		});
		expect(toDot.text).toContain("・");
		expect(toDot.scales.some(([x, y]) => x < 1 && y < 1)).toBe(true);
		assertChangesFromRest({ exit: "tyToDot", phase: toDot, text: "DOTS" });

		const lineFeed = renderExit({
			exit: "tyLineFeed",
			sequenceTime: 50_000,
			text: "LINE FEED",
		});
		expect(lineFeed.rects).toHaveLength(1);
		expect(lineFeed.translations.some(([, y]) => y < 0)).toBe(true);
		assertChangesFromRest({
			exit: "tyLineFeed",
			phase: lineFeed,
			text: "LINE FEED",
		});

		const bracketClose = renderExit({
			exit: "tyBracketClose",
			sequenceTime: 50_000,
			text: "BRACKET",
		});
		expect(bracketClose.rects).toHaveLength(1);
		expect(bracketClose.fillRects).toHaveLength(4);
		assertChangesFromRest({
			exit: "tyBracketClose",
			phase: bracketClose,
			text: "BRACKET",
		});

		const toIndex = renderExit({
			exit: "tyToIndex",
			sequenceTime: 50_000,
			text: "INDEX",
		});
		expect(toIndex.text.some((value) => /^\d{2}$/u.test(value))).toBe(true);
		assertChangesFromRest({ exit: "tyToIndex", phase: toIndex, text: "INDEX" });

		const keyLast = renderExit({
			exit: "tyKeyLast",
			sequenceTime: 55_000,
			text: "small EMPHASIS tail",
		});
		expect(keyLast.scales.some(([x, y]) => x > 1 && y > 1)).toBe(true);
		expect(
			keyLast.translations.some(([x, y]) => Math.abs(x) > 1 || Math.abs(y) > 1),
		).toBe(true);
		assertChangesFromRest({
			exit: "tyKeyLast",
			phase: keyLast,
			text: "small EMPHASIS tail",
		});

		const underSink = renderExit({
			exit: "tyUnderSink",
			sequenceTime: 51_000,
			text: "UNDER SINK",
		});
		expect(underSink.fillRects.length).toBeGreaterThan(0);
		expect(underSink.rects.length).toBeGreaterThan(0);
		expect(underSink.translations.some(([, y]) => y > 0)).toBe(true);
		assertChangesFromRest({
			exit: "tyUnderSink",
			phase: underSink,
			text: "UNDER SINK",
		});

		const foldVert = renderExit({
			exit: "tyFoldVert",
			sequenceTime: 49_000,
			text: "FOLD",
		});
		expect(
			foldVert.translations.some(
				([x, y]) => Math.abs(x) > 1 && Math.abs(y) > 1,
			),
		).toBe(true);
		expect(foldVert.textDraws.some((draw) => draw.alpha < 1)).toBe(true);
		assertChangesFromRest({
			exit: "tyFoldVert",
			phase: foldVert,
			text: "FOLD",
		});
	});

	test("typography decors preserve their editorial annotation signatures", () => {
		const renderDecor = ({ decor, text }: { decor: string; text: string }) =>
			renderTypographyLayout({
				decor,
				enter: "cut",
				exit: "cut",
				hold: "still",
				layout: "center",
				sequenceTime: 30_000,
				text,
			});

		const colophon = renderDecor({ decor: "tyColophon", text: "COLOPHON" });
		expect(colophon.text).toEqual(
			expect.arrayContaining([
				"COLOPHON",
				"No.01  00:00.00 – 00:00.50",
				"8 CHARS",
			]),
		);
		expect(colophon.fillRects.length).toBeGreaterThanOrEqual(1);

		const runningHead = renderDecor({
			decor: "tyRunningHead",
			text: "RUNNING HEAD",
		});
		expect(runningHead.text).toEqual(
			expect.arrayContaining(["01 / RUNNING HEAD", "001"]),
		);
		expect(runningHead.fillRects.length).toBeGreaterThanOrEqual(2);

		const glyphBody = renderDecor({
			decor: "tyGlyphBody",
			text: "GLYPH",
		});
		expect(glyphBody.fillRects.length).toBeGreaterThan(10);
		expect(glyphBody.text.some((value) => value.startsWith("05 / W"))).toBe(
			true,
		);

		const textRule = renderDecor({
			decor: "tyTextRule",
			text: "TEXT RULE",
		});
		expect(textRule.rects).toHaveLength(2);
		expect(textRule.fillRects).toHaveLength(2);
		expect(
			textRule.text.filter((value) => value.includes("TEXT RULE / ")).length,
		).toBe(2);

		const typeScale = renderDecor({
			decor: "tyTypeScale",
			text: "SCALE TEST",
		});
		expect(typeScale.text.filter((value) => value === "S")).toHaveLength(5);
		expect(typeScale.text.filter((value) => /^\d+$/u.test(value)).length).toBe(
			5,
		);
		expect(typeScale.fillRects).toHaveLength(1);

		const bigPunct = renderDecor({
			decor: "tyBigPunct",
			text: "QUOTED",
		});
		expect(bigPunct.text).toEqual(expect.arrayContaining(["「", "」"]));
		expect(
			bigPunct.textDraws
				.filter((draw) => draw.text === "「" || draw.text === "」")
				.every((draw) => draw.alpha < 0.5),
		).toBe(true);
	});

	test("typography treatments preserve their per-glyph print signatures", () => {
		const renderTreatment = ({
			text,
			treat,
		}: {
			text: string;
			treat: string;
		}) =>
			renderTypographyLayout({
				enter: "cut",
				exit: "cut",
				hold: "still",
				layout: "center",
				sequenceTime: 30_000,
				text,
				treat,
			});

		const hollow = renderTreatment({ text: "HOLLOW", treat: "tyHollowKey" });
		expect(
			hollow.textDraws.filter((draw) => draw.kind === "stroke"),
		).toHaveLength(1);
		expect(
			hollow.textDraws.filter((draw) => draw.kind === "fill"),
		).toHaveLength(5);

		const headRules = renderTreatment({
			text: "HEAD RULES",
			treat: "tyHeadRules",
		});
		expect(headRules.text).toContain("HEAD RULES");
		expect(headRules.fillRects).toHaveLength(2);
		expect(headRules.fillRects[0]?.[3]).toBeGreaterThan(
			headRules.fillRects[1]?.[3] ?? Number.POSITIVE_INFINITY,
		);

		const headBig = renderTreatment({
			text: "INITIAL",
			treat: "tyHeadBig",
		});
		expect(headBig.text).toHaveLength(7);
		expect(headBig.scales.some(([x, y]) => x > 1 && y > 1)).toBe(true);
		expect(headBig.translations.some(([, y]) => y < 0)).toBe(true);

		const indexSup = renderTreatment({
			text: "INDEX",
			treat: "tyIndexSup",
		});
		expect(indexSup.text).toEqual(
			expect.arrayContaining([
				"I",
				"N",
				"D",
				"E",
				"X",
				"1",
				"2",
				"3",
				"4",
				"5",
			]),
		);
		expect(new Set(indexSup.textDraws.map((draw) => draw.font)).size).toBe(2);
	});

	test("typography transitions compose previous and current cuts through distinct masks", () => {
		const ruleWipe = renderTypographyTransition({ trans: "tyRuleWipe" });
		expect(ruleWipe.text).toEqual(expect.arrayContaining(["BEFORE", "AFTER"]));
		expect(ruleWipe.rects.length).toBeGreaterThanOrEqual(4);
		expect(ruleWipe.fillRects.length).toBeGreaterThanOrEqual(8);

		const gridCells = renderTypographyTransition({ trans: "tyGridCells" });
		expect(gridCells.text).toEqual(expect.arrayContaining(["BEFORE", "AFTER"]));
		expect(gridCells.rects.length).toBeGreaterThan(10);
		expect(gridCells.fillRects.length).toBeGreaterThan(10);
		expect(gridCells.rects.length).toBeGreaterThan(ruleWipe.rects.length);
	});

	test("treattrans transitions preserve twenty distinct cut-to-cut signatures", () => {
		const transitions = [
			"wipe",
			"diagonalWipe",
			"clockWipe",
			"irisOpen",
			"pushSlide",
			"cover",
			"uncover",
			"zoomThrough",
			"doorsOpen",
			"blinds",
			"checker",
			"blockDissolve",
			"whipPan",
			"spinOut",
			"inkBlob",
			"shatterTiles",
			"sliceShift",
			"cubeTurn",
			"flashCross",
			"pixelate",
		] as const;
		const phaseA = new Map(
			transitions.map((trans) => [
				trans,
				renderTypographyTransition({ sequenceTime: 66_000, trans }),
			]),
		);
		const phaseB = new Map(
			transitions.map((trans) => [
				trans,
				renderTypographyTransition({ sequenceTime: 70_000, trans }),
			]),
		);
		expect(
			new Set([...phaseA.values()].map(typographyRecordingSignature)).size,
		).toBe(transitions.length);
		for (const transition of transitions) {
			const early = phaseA.get(transition)!;
			expect(early.text, transition).toEqual(
				expect.arrayContaining(["BEFORE", "AFTER"]),
			);
			expect(typographyRecordingSignature(early), transition).not.toBe(
				typographyRecordingSignature(phaseB.get(transition)!),
			);
		}
		expect(phaseA.get("clockWipe")!.rects.length).toBeGreaterThan(5);
		expect(phaseA.get("inkBlob")!.rects.length).toBeGreaterThan(5);
		expect(phaseA.get("shatterTiles")!.rotations.length).toBeGreaterThan(20);
		expect(phaseA.get("pixelate")!.fillRects.length).toBeGreaterThan(10);
	});

	test("kinetic decorations preserve speed trails and word-clock counters", () => {
		const speedTrail = renderTypographyLayout({
			decor: "knSpeedTrail",
			enter: "cut",
			exit: "cut",
			hold: "still",
			layout: "center",
			sequenceTime: 12_000,
			text: "MOVE FAST NOW",
		});
		expect(speedTrail.fillRects.length).toBeGreaterThanOrEqual(8);
		expect(
			speedTrail.fillRects.some(([, , width, height]) => width > height * 4),
		).toBe(true);

		const wordTicks = renderTypographyLayout({
			decor: "knWordTicks",
			enter: "cut",
			exit: "cut",
			hold: "still",
			layout: "center",
			sequenceTime: 12_000,
			text: "ONE TWO THREE FOUR",
		});
		expect(wordTicks.text).toContain("02 / 04");
		expect(wordTicks.fillRects).toHaveLength(6);
	});

	test("kinetic treatments preserve word-scale contrast and alternating plates", () => {
		const wordScale = renderTypographyLayout({
			enter: "cut",
			exit: "cut",
			hold: "still",
			layout: "center",
			text: "SMALL IMPACT END",
			treat: "knWordScale",
		});
		expect(wordScale.text).toEqual(["SMALL", "IMPACT", "END"]);
		expect(
			new Set(wordScale.scales.slice(1).map(([x]) => x.toFixed(4))).size,
		).toBe(2);
		expect(
			new Set(wordScale.translations.slice(-3).map(([x]) => x.toFixed(4))).size,
		).toBe(3);

		const wordPlate = renderTypographyLayout({
			enter: "cut",
			exit: "cut",
			hold: "still",
			layout: "center",
			text: "PLATE WORD CONTRAST",
			treat: "knWordPlate",
		});
		expect(wordPlate.text).toEqual(["PLATE", "WORD", "CONTRAST"]);
		expect(wordPlate.fillRects.length).toBeGreaterThanOrEqual(1);
		expect(
			new Set(wordPlate.textDraws.map((draw) => draw.fillStyle)).size,
		).toBe(2);
	});

	test("kinetic transitions preserve swing, hard-cut, and strip-slam signatures", () => {
		const cornerSwing = renderTypographyTransition({ trans: "knCornerSwing" });
		expect(cornerSwing.text).toEqual(
			expect.arrayContaining(["BEFORE", "AFTER"]),
		);
		expect(
			cornerSwing.rotations.filter((radians) => Math.abs(radians) > 0.1),
		).toHaveLength(3);
		expect(cornerSwing.fillRects.length).toBeGreaterThanOrEqual(1);

		const stutterCurrent = renderTypographyTransition({
			trans: "knStutterCut",
			sequenceTime: 66_000,
		});
		const stutterPrevious = renderTypographyTransition({
			trans: "knStutterCut",
			sequenceTime: 70_000,
		});
		expect(stutterCurrent.text).toEqual(["AFTER"]);
		expect(stutterPrevious.text).toEqual(["BEFORE"]);
		expect(stutterCurrent.scales).not.toEqual(stutterPrevious.scales);

		const stripSlam = renderTypographyTransition({ trans: "knStripSlam" });
		expect(stripSlam.text).toEqual(expect.arrayContaining(["BEFORE", "AFTER"]));
		expect(stripSlam.rects.length).toBeGreaterThanOrEqual(1);
		expect(stripSlam.translations.some(([, y]) => Math.abs(y) > 1)).toBe(true);
	});

	test("kinetic cameras preserve six distinct frame-level motion signatures", () => {
		const renderCamera = ({
			cam,
			sequenceTime,
		}: {
			readonly cam: string;
			readonly sequenceTime: number;
		}) =>
			renderTypographyLayout({
				cam,
				enter: "cut",
				exit: "cut",
				hold: "still",
				layout: "center",
				sequenceTime,
				text: "READ EVERY WORD NOW",
			});

		const readFirst = renderCamera({ cam: "knReadPan", sequenceTime: 12_000 });
		const readLater = renderCamera({ cam: "knReadPan", sequenceTime: 42_000 });
		expect(readFirst.translations[0]?.[0]).not.toBeCloseTo(
			readLater.translations[0]?.[0] ?? 0,
		);

		const tilt = renderCamera({ cam: "knTiltKick", sequenceTime: 24_000 });
		expect(Math.abs(tilt.rotations[0] ?? 0)).toBeGreaterThan(0.005);

		const card = renderCamera({ cam: "knCardFlip", sequenceTime: 12_000 });
		expect(
			Math.abs((card.scales[0]?.[0] ?? 1) - (card.scales[0]?.[1] ?? 1)),
		).toBeGreaterThan(0.02);

		const shear = renderCamera({ cam: "knShearKick", sequenceTime: 22_000 });
		expect(shear.transforms).toHaveLength(1);
		expect(Math.abs(shear.transforms[0]?.[2] ?? 0)).toBeGreaterThan(0.01);

		const jumpFirst = renderCamera({ cam: "knJumpCut", sequenceTime: 12_000 });
		const jumpLater = renderCamera({ cam: "knJumpCut", sequenceTime: 42_000 });
		expect(jumpFirst.scales[0]).not.toEqual(jumpLater.scales[0]);

		const rush = renderCamera({ cam: "knRushIn", sequenceTime: 12_000 });
		expect(rush.scales[0]?.[0]).toBeLessThan(1);
		expect(rush.context.filter).not.toBe("none");
	});

	test("kinetic holds preserve six distinct word-level motion signatures", () => {
		const renderHold = ({
			hold,
			sequenceTime,
		}: {
			readonly hold: string;
			readonly sequenceTime: number;
		}) =>
			renderTypographyLayout({
				enter: "cut",
				exit: "cut",
				hold,
				layout: "center",
				sequenceTime,
				text: "ONE TWO THREE",
			});

		const pulseHigh = renderHold({ hold: "knWordPulse", sequenceTime: 6_000 });
		const pulseLow = renderHold({ hold: "knWordPulse", sequenceTime: 40_000 });
		expect(
			Math.max(...pulseHigh.scales.slice(1).map(([x]) => x)),
		).toBeGreaterThan(Math.max(...pulseLow.scales.slice(1).map(([x]) => x)));

		const counterRock = renderHold({
			hold: "knCounterRock",
			sequenceTime: 30_000,
		});
		expect(counterRock.rotations.some((value) => value > 0.01)).toBe(true);
		expect(counterRock.rotations.some((value) => value < -0.01)).toBe(true);

		const wordRide = renderHold({ hold: "knWordRide", sequenceTime: 30_000 });
		expect(
			wordRide.translations.some(
				([, y], index) => index > 1 && Math.abs(y - 180) > 1,
			),
		).toBe(true);

		const tickStart = renderHold({ hold: "knTickShift", sequenceTime: 1_000 });
		const tickLanded = renderHold({
			hold: "knTickShift",
			sequenceTime: 18_000,
		});
		expect(tickStart.translations.at(-1)).not.toEqual(
			tickLanded.translations.at(-1),
		);

		const beatLean = renderHold({ hold: "knBeatLean", sequenceTime: 4_000 });
		expect(beatLean.transforms.some(([, , shear]) => shear > 0.1)).toBe(true);
		expect(beatLean.transforms.some(([, , shear]) => shear < -0.1)).toBe(true);

		const gapClosed = renderHold({ hold: "knGapBreath", sequenceTime: 1_000 });
		const gapOpen = renderHold({ hold: "knGapBreath", sequenceTime: 40_000 });
		expect(gapClosed.translations).not.toEqual(gapOpen.translations);
	});

	test("kinetic entrances preserve ten distinct word-arrival signatures", () => {
		const renderEntrance = ({
			enter,
			sequenceTime = 8_000,
		}: {
			readonly enter: string;
			readonly sequenceTime?: number;
		}) =>
			renderTypographyLayout({
				enter,
				exit: "cut",
				hold: "still",
				layout: "center",
				sequenceTime,
				text: "ONE TWO THREE",
			});
		const assertSettles = ({
			early,
			enter,
		}: {
			readonly early: ReturnType<typeof renderTypographyLayout>;
			readonly enter: string;
		}) => {
			const settled = renderEntrance({ enter, sequenceTime: 30_000 });
			expect(settled.text, enter).toContain("ONE TWO THREE");
			expect(early.textDraws, enter).not.toEqual(settled.textDraws);
		};

		const slam = renderEntrance({ enter: "knWordSlam", sequenceTime: 1_000 });
		expect(slam.scales.some(([x]) => x > 1.4)).toBe(true);
		expect(slam.rotations.some((value) => Math.abs(value) > 0.02)).toBe(true);
		assertSettles({ early: slam, enter: "knWordSlam" });

		const typeSlam = renderEntrance({ enter: "knTypeToSlam" });
		expect(typeSlam.text.length).toBeGreaterThan(0);
		expect(typeSlam.text.length).toBeLessThan(11);
		assertSettles({ early: typeSlam, enter: "knTypeToSlam" });

		const replace = renderEntrance({ enter: "knReplaceIn" });
		expect(replace.text).toEqual(["T", "W", "O"]);
		expect(replace.scales.some(([x]) => x > 1)).toBe(true);
		assertSettles({ early: replace, enter: "knReplaceIn" });

		const hinge = renderEntrance({ enter: "knHingeDrop" });
		expect(hinge.rotations.some((value) => Math.abs(value) > 0.1)).toBe(true);
		expect(hinge.translations.length).toBeGreaterThan(4);
		assertSettles({ early: hinge, enter: "knHingeDrop" });

		const loop = renderEntrance({ enter: "knLoopIn" });
		expect(
			loop.translations.some(
				([x, y], index) => index > 1 && (Math.abs(x) > 1 || Math.abs(y) > 1),
			),
		).toBe(true);
		assertSettles({ early: loop, enter: "knLoopIn" });

		const push = renderEntrance({ enter: "knPushIn" });
		expect(push.text.length).toBeGreaterThan(3);
		expect(push.text.length).toBeLessThan(11);
		assertSettles({ early: push, enter: "knPushIn" });

		const inertia = renderEntrance({ enter: "knInertia" });
		expect(inertia.scales.some(([x, y]) => Math.abs(x - y) > 0.05)).toBe(true);
		assertSettles({ early: inertia, enter: "knInertia" });

		const spin = renderEntrance({ enter: "knWordSpin", sequenceTime: 1_000 });
		expect(spin.rotations.some((value) => Math.abs(value) > 0.5)).toBe(true);
		expect(spin.scales.some(([x]) => x < 0.8)).toBe(true);
		assertSettles({ early: spin, enter: "knWordSpin" });

		const dive = renderEntrance({ enter: "knDiveIn" });
		expect(dive.scales.some(([x]) => x > 1.5)).toBe(true);
		assertSettles({ early: dive, enter: "knDiveIn" });

		const stretch = renderEntrance({ enter: "knStretchOut" });
		expect(stretch.scales.some(([x, y]) => Math.abs(x - y) > 0.05)).toBe(true);
		assertSettles({ early: stretch, enter: "knStretchOut" });
	});

	test("kinetic exits preserve eight distinct word-departure signatures", () => {
		const renderExit = ({
			exit,
			sequenceTime = 50_000,
		}: {
			readonly exit: string;
			readonly sequenceTime?: number;
		}) =>
			renderTypographyLayout({
				enter: "cut",
				exit,
				hold: "still",
				layout: "center",
				sequenceTime,
				text: "ONE TWO THREE",
			});

		const kick = renderExit({ exit: "knWordKick" });
		expect(kick.rotations.some((value) => value > 0.05)).toBe(true);
		expect(kick.rotations.some((value) => value < -0.05)).toBe(true);

		const push = renderExit({ exit: "knPushOut" });
		expect(push.text.length).toBeGreaterThan(0);
		expect(push.text.length).toBeLessThan(9);

		const dive = renderExit({ exit: "knDiveGlyph" });
		expect(dive.scales.some(([x]) => x > 2)).toBe(true);
		expect(dive.textDraws.some((draw) => draw.alpha < 0.8)).toBe(true);

		const launch = renderExit({ exit: "knLaunch" });
		expect(launch.scales.some(([x, y]) => Math.abs(x - y) > 0.1)).toBe(true);
		expect(
			launch.translations.some(([x], index) => index > 1 && Math.abs(x) > 50),
		).toBe(true);

		const blink = renderExit({ exit: "knWordBlink", sequenceTime: 49_000 });
		expect(blink.text.length).toBeGreaterThan(0);
		expect(blink.text.length).toBeLessThan(9);
		expect(
			blink.textDraws.some(
				(draw) => draw.fillStyle.toLowerCase() === "#f5a50c",
			),
		).toBe(true);

		const closeGap = renderExit({ exit: "knCloseGap", sequenceTime: 49_000 });
		expect(closeGap.text.length).toBeLessThan(9);
		expect(closeGap.scales.some(([x]) => x < 0.9)).toBe(true);

		const jumpA = renderExit({ exit: "knJumpCutOut", sequenceTime: 42_000 });
		const jumpASameStage = renderExit({
			exit: "knJumpCutOut",
			sequenceTime: 44_000,
		});
		const jumpB = renderExit({ exit: "knJumpCutOut", sequenceTime: 46_000 });
		expect(jumpA.scales).toEqual(jumpASameStage.scales);
		expect(jumpA.translations).toEqual(jumpASameStage.translations);
		expect(jumpA.scales).not.toEqual(jumpB.scales);

		const stacked = renderExit({ exit: "knStackAway" });
		const falling = renderExit({ exit: "knStackAway", sequenceTime: 56_000 });
		expect(Math.max(...falling.translations.map(([, y]) => y))).toBeGreaterThan(
			Math.max(...stacked.translations.map(([, y]) => y)),
		);
	});

	test("scene-builder creates one native node from the project sequence", () => {
		const sequence = sequenceFixture();
		const scene = buildScene({
			tracks: tracksFixture({ sequenceId: sequence.id }),
			mediaAssets: [],
			motionTextSequences: [sequence],
			motionTextTimeMapper: testTimeMapper,
			duration: 120_000,
			canvasSize: { width: 640, height: 360 },
			background: { type: "color", color: "transparent" },
			assetResolver: { resolve: ({ ref }) => ref.path },
		});

		expect(scene.children).toHaveLength(1);
		expect(scene.children[0]).toBeInstanceOf(MotionTextNode);
		expect(motionTextNodeFrom(scene).params.sequence).toBe(sequence);
	});

	test("missing sequence references fail closed instead of drawing a fallback", () => {
		const sequence = sequenceFixture();
		const scene = buildScene({
			tracks: tracksFixture({ sequenceId: "sequence:missing" }),
			mediaAssets: [],
			motionTextSequences: [sequence],
			motionTextTimeMapper: testTimeMapper,
			duration: 120_000,
			canvasSize: { width: 640, height: 360 },
			background: { type: "color", color: "transparent" },
			assetResolver: { resolve: ({ ref }) => ref.path },
		});

		expect(scene.children).toEqual([]);
	});

	test("random seek and sequential sampling resolve identical content hashes", async () => {
		const sequence = sequenceFixture();
		const scene = buildScene({
			tracks: tracksFixture({ sequenceId: sequence.id }),
			mediaAssets: [],
			motionTextSequences: [sequence],
			motionTextTimeMapper: testTimeMapper,
			duration: 120_000,
			canvasSize: { width: 640, height: 360 },
			background: { type: "color", color: "transparent" },
			assetResolver: { resolve: ({ ref }) => ref.path },
		});
		const node = motionTextNodeFrom(scene);
		const renderer = rendererFixture();
		const hashes = new Map<number, string>();
		const textureIds = new Set<string>();
		const textureHashes = new Set<string>();

		for (const time of [25_000, 75_000, 50_000, 25_000]) {
			await resolveRenderTree({
				node: scene,
				renderer,
				time,
				videoCache: videoCacheFixture(),
			});
			expect(node.resolved).not.toBeNull();
			const hash = node.resolved?.contentHash;
			expect(hash).toBeString();
			if (hash) {
				const previous = hashes.get(time);
				if (previous) expect(hash).toBe(previous);
				hashes.set(time, hash);
			}
			const descriptor = await buildFrameDescriptor({ node: scene, renderer });
			const texture = descriptor.textures[0];
			expect(texture?.kind).toBe("rendered");
			if (texture?.kind === "rendered") {
				textureIds.add(texture.id);
				textureHashes.add(texture.contentHash);
			}
		}

		expect(hashes.get(25_000)).not.toBe(hashes.get(50_000));
		expect(hashes.get(50_000)).not.toBe(hashes.get(75_000));
		expect(textureIds.size).toBe(1);
		expect(textureHashes.size).toBe(3);
	});

	test("frame descriptor uses a rendered texture and preserves visual opacity", async () => {
		const sequence = sequenceFixture();
		const scene = buildScene({
			tracks: tracksFixture({ sequenceId: sequence.id }),
			mediaAssets: [],
			motionTextSequences: [sequence],
			motionTextTimeMapper: testTimeMapper,
			duration: 120_000,
			canvasSize: { width: 640, height: 360 },
			background: { type: "color", color: "transparent" },
			assetResolver: { resolve: ({ ref }) => ref.path },
		});
		const renderer = rendererFixture();
		await resolveRenderTree({
			node: scene,
			renderer,
			time: 25_000,
			videoCache: videoCacheFixture(),
		});
		const descriptor = await buildFrameDescriptor({ node: scene, renderer });

		expect(descriptor.textures).toHaveLength(1);
		expect(descriptor.textures[0].kind).toBe("rendered");
		expect(descriptor.frame.items).toHaveLength(1);
		expect(descriptor.frame.items[0]).toMatchObject({
			type: "layer",
			opacity: 0.75,
			blendMode: "normal",
		});
	});

	test("overlay stays transparent while scene mode owns its background", () => {
		const overlay = sequenceFixture({ compositionMode: "overlay" });
		const scene = sequenceFixture({ compositionMode: "scene" });
		const overlayFrame = resolveMotionTextRenderFrame({
			runtime: createMotionTextRenderRuntime({ sequence: overlay }),
			sequenceTime: 25_000,
		});
		const sceneFrame = resolveMotionTextRenderFrame({
			runtime: createMotionTextRenderRuntime({ sequence: scene }),
			sequenceTime: 25_000,
		});
		expect(overlayFrame).not.toBeNull();
		expect(sceneFrame).not.toBeNull();
		if (!overlayFrame || !sceneFrame) return;

		const overlayContext = recordingContext();
		drawMotionTextFrame({
			ctx: overlayContext.context,
			frame: overlayFrame,
			width: 640,
			height: 360,
			compositionMode: "overlay",
		});
		const sceneContext = recordingContext();
		drawMotionTextFrame({
			ctx: sceneContext.context,
			frame: sceneFrame,
			width: 640,
			height: 360,
			compositionMode: "scene",
		});

		expect(overlayContext.fillRects).toEqual([]);
		expect(overlayContext.text).toContain("First line");
		expect(sceneContext.fillRects).toContainEqual([0, 0, 640, 360]);
		expect(sceneContext.text).toContain("First line");
	});

	test("center-free parameters draw both lyric halves in deterministic side bands", () => {
		const base = sequenceFixture();
		const sequence: MotionTextSequence = {
			...base,
			resolvedPlan: base.resolvedPlan
				? {
						...base.resolvedPlan,
						cuts: base.resolvedPlan.cuts.map((cut, index) =>
							index === 0
								? {
										...cut,
										parameters: {
											...cut.parameters,
											"jizura.centerFree": {
												enabled: true,
												direction: "lr",
												firstText: "First",
												secondText: "line",
												delayTicks: 4_800,
											},
										},
									}
								: cut,
						),
					}
				: undefined,
		};
		const frame = resolveMotionTextRenderFrame({
			runtime: createMotionTextRenderRuntime({ sequence }),
			sequenceTime: 25_000,
		});
		if (!frame) throw new Error("Expected a center-free render frame");
		const recorded = recordingContext();
		drawMotionTextFrame({
			ctx: recorded.context,
			frame,
			width: 640,
			height: 360,
			compositionMode: "overlay",
		});

		expect(recorded.text).toContain("First");
		expect(recorded.text).toContain("line");
		expect(recorded.rects).toContainEqual([0, 0, 230, 360]);
		expect(recorded.translations).toContainEqual([0, 0]);
		expect(recorded.translations).toContainEqual([410, 0]);
	});

	test("cue colors override sequence defaults only for their resolved cuts", () => {
		const base = sequenceFixture();
		const sequence: MotionTextSequence = {
			...base,
			defaults: {
				...base.defaults,
				colors: { foreground: "#ddeeff", accent: "#224466" },
			},
			cues: base.cues.map((cue, index) =>
				index === 0
					? {
							...cue,
							overrides: {
								...cue.overrides,
								colors: {
									foreground: "#fff4e6",
									accent: "#ff3300",
								},
							},
						}
					: cue,
			),
		};
		const runtime = createMotionTextRenderRuntime({ sequence });
		const first = resolveMotionTextRenderFrame({
			runtime,
			sequenceTime: 25_000,
		});
		const second = resolveMotionTextRenderFrame({
			runtime,
			sequenceTime: 75_000,
		});

		expect(first?.palette.foreground).toBe("#fff4e6");
		expect(first?.palette.accent).toBe("#ff3300");
		expect(second?.palette.foreground).toBe("#ddeeff");
		expect(second?.palette.accent).toBe("#224466");
	});

	test("cross-style transitions retain each adjacent cut font and palette", () => {
		const base = sequenceFixture();
		const plan = base.resolvedPlan;
		const firstCut = plan?.cuts[0];
		const secondCut = plan?.cuts[1];
		if (!plan || !firstCut || !secondCut) {
			throw new Error("Transition fidelity fixture needs two cuts");
		}
		const previousFontId = motionTextFontId("font:previous");
		const currentFontId = motionTextFontId("font:current");
		const sequence: MotionTextSequence = {
			...base,
			fonts: [
				{
					id: previousFontId,
					source: "builtin",
					family: "Previous Face",
					style: "normal",
					weight: 600,
				},
				{
					id: currentFontId,
					source: "builtin",
					family: "Current Face",
					style: "italic",
					weight: 800,
				},
			],
			cues: base.cues.map((cue, index) => ({
				...cue,
				overrides: {
					...cue.overrides,
					colors:
						index === 0
							? { foreground: "#aa1100", accent: "#22aa33" }
							: { foreground: "#0044cc", accent: "#ffee00" },
				},
			})),
			resolvedPlan: {
				...plan,
				cuts: [
					{
						...firstCut,
						text: "BEFORE",
						fontId: previousFontId,
						preset: {
							...firstCut.preset,
							style: "noir",
							enter: "cut",
							hold: "still",
							exit: "cut",
							trans: null,
						},
					},
					{
						...secondCut,
						text: "AFTER",
						fontId: currentFontId,
						preset: {
							...secondCut.preset,
							style: "crimson",
							layout: "center",
							enter: "cut",
							hold: "still",
							exit: "cut",
							trans: "tyRuleWipe",
						},
					},
				],
			},
		};
		const frame = resolveMotionTextRenderFrame({
			runtime: createMotionTextRenderRuntime({
				sequence,
				resolvedFonts: new Map([
					[
						previousFontId,
						{
							family: "Resolved Previous",
							style: "normal",
							weight: 600,
							fingerprint: "previous-font",
						},
					],
					[
						currentFontId,
						{
							family: "Resolved Current",
							style: "italic",
							weight: 800,
							fingerprint: "current-font",
						},
					],
				]),
			}),
			sequenceTime: 70_000,
		});
		expect(frame?.palette.foreground).toBe("#0044cc");
		expect(frame?.previousPalette?.foreground).toBe("#aa1100");
		expect(frame?.font.fingerprint).toBe("current-font");
		expect(frame?.previousFont?.fingerprint).toBe("previous-font");
		if (!frame) return;
		const recorded = recordingContext();
		drawMotionTextFrame({
			ctx: recorded.context,
			frame,
			width: 640,
			height: 360,
			compositionMode: "overlay",
		});
		const previousDraws = recorded.textDraws.filter(
			(draw) => draw.text === "BEFORE",
		);
		const currentDraws = recorded.textDraws.filter(
			(draw) => draw.text === "AFTER",
		);
		expect(previousDraws.length).toBeGreaterThan(0);
		expect(currentDraws.length).toBeGreaterThan(0);
		expect(
			previousDraws.every(
				(draw) =>
					draw.fillStyle === "#aa1100" &&
					draw.font.includes("Resolved Previous"),
			),
		).toBe(true);
		expect(
			currentDraws.every(
				(draw) =>
					draw.fillStyle === "#0044cc" &&
					draw.font.includes("Resolved Current"),
			),
		).toBe(true);
	});

	test("clip and sequence boundaries are half-open", async () => {
		const sequence = sequenceFixture();
		const scene = buildScene({
			tracks: tracksFixture({ sequenceId: sequence.id }),
			mediaAssets: [],
			motionTextSequences: [sequence],
			motionTextTimeMapper: testTimeMapper,
			duration: 120_000,
			canvasSize: { width: 640, height: 360 },
			background: { type: "color", color: "transparent" },
			assetResolver: { resolve: ({ ref }) => ref.path },
		});
		const node = motionTextNodeFrom(scene);
		const renderer = rendererFixture();

		await resolveRenderTree({
			node: scene,
			renderer,
			time: 109_999,
			videoCache: videoCacheFixture(),
		});
		expect(node.resolved?.frame.sequenceTime).toBe(109_999);
		await resolveRenderTree({
			node: scene,
			renderer,
			time: 110_000,
			videoCache: videoCacheFixture(),
		});
		expect(node.resolved).toBeNull();
	});

	test("runtime is instance-local and reports unsupported presets explicitly", () => {
		const first = sequenceFixture({ seed: 1 });
		const second = sequenceFixture({ seed: 2 });
		const unsupported = {
			...second,
			resolvedPlan: {
				...second.resolvedPlan!,
				cuts: second.resolvedPlan!.cuts.map((cut) => ({
					...cut,
					preset: { ...cut.preset, enter: "unsupportedEnterFixture" },
				})),
			},
		};
		const firstFrame = resolveMotionTextRenderFrame({
			runtime: createMotionTextRenderRuntime({ sequence: first }),
			sequenceTime: 25_000,
		});
		const secondFrame = resolveMotionTextRenderFrame({
			runtime: createMotionTextRenderRuntime({ sequence: unsupported }),
			sequenceTime: 25_000,
		});

		expect(firstFrame?.contentFingerprint).not.toBe(
			secondFrame?.contentFingerprint,
		);
		expect(secondFrame?.diagnostics).toContainEqual(
			expect.objectContaining({
				code: "unsupported-preset",
				preset: "enter:unsupportedEnterFixture",
			}),
		);
	});

	test("preview diagnoses a missing project font while export fails closed", async () => {
		const sequence = withProjectFont(sequenceFixture());
		const runtime = missingProjectFontRuntime();
		const common = {
			tracks: tracksFixture({ sequenceId: sequence.id }),
			mediaAssets: [],
			motionTextSequences: [sequence],
			motionTextTimeMapper: testTimeMapper,
			motionTextFontRuntime: runtime,
			motionTextProjectId: "project:font-test",
			duration: 120_000,
			canvasSize: { width: 640, height: 360 },
			background: { type: "color" as const, color: "transparent" },
			assetResolver: {
				resolve: ({ ref }: { ref: { path: string } }) => ref.path,
			},
		};
		const preview = buildScene({ ...common, isPreview: true });
		await resolveRenderTree({
			node: preview,
			renderer: rendererFixture(),
			time: 25_000,
			videoCache: videoCacheFixture(),
		});
		const previewNode = motionTextNodeFrom(preview);
		expect(previewNode.resolved).not.toBeNull();
		expect(previewNode.diagnostics).toContainEqual(
			expect.objectContaining({
				severity: "warning",
				code: "font-load-failed",
			}),
		);

		const exported = buildScene(common);
		await expect(
			resolveRenderTree({
				node: exported,
				renderer: rendererFixture(),
				time: 25_000,
				videoCache: videoCacheFixture(),
			}),
		).rejects.toThrow(/export resources are not ready/i);
		expect(motionTextNodeFrom(exported).diagnostics).toContainEqual(
			expect.objectContaining({
				severity: "error",
				code: "font-load-failed",
			}),
		);
		runtime.dispose();
	});

	test("re-prepares fonts after the runtime generation changes", async () => {
		const sequence = withProjectFont(sequenceFixture());
		const fixture = reloadableProjectFontRuntime();
		const node = new MotionTextNode({
			elementId: "motion-font-generation",
			sequence,
			fontRuntime: fixture.runtime,
			projectId: "project:generation",
			duration: 120_000,
			timeOffset: 0,
			trimStart: 0,
			trimEnd: 0,
			transform: {
				scaleX: 1,
				scaleY: 1,
				position: { x: 0, y: 0 },
				rotate: 0,
			},
			opacity: 1,
		});

		const first = await node.getRenderRuntime();
		fixture.runtime.invalidate();
		const second = await node.getRenderRuntime();

		expect(second).not.toBe(first);
		expect(fixture.loads()).toBe(2);
		fixture.runtime.dispose();
	});

	test("retries after a stale font preparation rejects", async () => {
		const sequence = withProjectFont(sequenceFixture());
		const fixture = reloadableProjectFontRuntime({ deferFirstLoad: true });
		const node = new MotionTextNode({
			elementId: "motion-font-retry",
			sequence,
			fontRuntime: fixture.runtime,
			projectId: "project:retry",
			duration: 120_000,
			timeOffset: 0,
			trimStart: 0,
			trimEnd: 0,
			transform: {
				scaleX: 1,
				scaleY: 1,
				position: { x: 0, y: 0 },
				rotate: 0,
			},
			opacity: 1,
		});
		const stale = node.getRenderRuntime();
		await Promise.resolve();
		fixture.runtime.invalidate();
		fixture.resolveFirstLoad();

		await expect(stale).rejects.toThrow(/stale/i);
		await expect(node.getRenderRuntime()).resolves.toBeDefined();
		expect(fixture.loads()).toBe(2);
		fixture.runtime.dispose();
	});

	test("two languages and seeds resolve as isolated layers in one scene", async () => {
		const english = sequenceFixture({ seed: 11 });
		const koreanBase = sequenceFixture({ seed: 29 });
		const korean: MotionTextSequence = {
			...koreanBase,
			language: "ko",
			source: { format: "plain", text: "새벽빛" },
			cues: koreanBase.cues.map((cue) => ({ ...cue, text: "새벽빛" })),
			resolvedPlan: koreanBase.resolvedPlan
				? {
						...koreanBase.resolvedPlan,
						cuts: koreanBase.resolvedPlan.cuts.map((cut) => ({
							...cut,
							text: "새벽빛",
						})),
					}
				: undefined,
		};
		const tracks = tracksFixture({ sequenceId: english.id });
		const motionTrack = tracks.overlay[0];
		const englishElement = motionTrack.elements[0];
		if (englishElement?.type !== "motion-text") {
			throw new TypeError("Expected a motion-text fixture element");
		}
		motionTrack.elements.push({
			...englishElement,
			id: "motion-clip-ko",
			name: "Korean motion clip",
			sequenceId: korean.id,
		});
		const scene = buildScene({
			tracks,
			mediaAssets: [],
			motionTextSequences: [english, korean],
			motionTextTimeMapper: testTimeMapper,
			duration: 120_000,
			canvasSize: { width: 640, height: 360 },
			background: { type: "color", color: "transparent" },
			assetResolver: { resolve: ({ ref }) => ref.path },
		});
		const renderer = rendererFixture();
		await resolveRenderTree({
			node: scene,
			renderer,
			time: 25_000,
			videoCache: videoCacheFixture(),
		});
		const descriptor = await buildFrameDescriptor({ node: scene, renderer });
		const nodes = scene.children.filter(
			(candidate): candidate is MotionTextNode =>
				candidate instanceof MotionTextNode,
		);

		expect(nodes).toHaveLength(2);
		expect(nodes[0].resolved?.frame.font.family).toBe("Inter");
		expect(nodes[1].resolved?.frame.font.family).toBe("Noto Sans KR");
		expect(nodes[0].resolved?.contentHash).not.toBe(
			nodes[1].resolved?.contentHash,
		);
		expect(descriptor.frame.items).toHaveLength(2);
		expect(descriptor.textures).toHaveLength(2);
	});
});
