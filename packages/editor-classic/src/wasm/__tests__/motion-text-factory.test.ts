import { describe, expect, test } from "bun:test";

await import("../../editor/session/__tests__/wasm-test-mock");

const {
	createMotionTextPresetPreview,
	createMotionTextVariationCandidate,
	createStarterMotionTextSequence,
	importJizuraMotionTextProject,
	mutateMotionTextSequence,
	restyleStarterMotionTextSequence,
} = await import("../motion-text-factory");
type CreateMotionTextVariationCandidateCore =
	import("../motion-text-factory").CreateMotionTextVariationCandidateCore;
type CreateMotionTextPresetPreviewCore =
	import("../motion-text-factory").CreateMotionTextPresetPreviewCore;
type ImportJizuraMotionTextProjectCore =
	import("../motion-text-factory").ImportJizuraMotionTextProjectCore;
type RestyleMotionTextSequenceCore =
	import("../motion-text-factory").RestyleMotionTextSequenceCore;
type MutateMotionTextSequenceCore =
	import("../motion-text-factory").MutateMotionTextSequenceCore;
const { MOTION_TEXT_RENDERER_SUPPORT } =
	await import("../../services/renderer/motion-text/support-manifest");
const {
	createMotionTextPresetPreview: createMotionTextPresetPreviewCore,
	createMotionTextVariationCandidate: createMotionTextVariationCandidateCore,
	createMotionTextSequence,
	importJizuraMotionTextProject: importJizuraMotionTextProjectCore,
	mutateMotionTextSequence: mutateMotionTextSequenceCore,
	restyleMotionTextSequence,
} = await import("../../../../../rust/wasm/pkg/opencut_wasm_sync.js");

const canonicalFactory = (
	options: Parameters<typeof createStarterMotionTextSequence>[0],
) =>
	createMotionTextSequence({
		sequenceId: options.sequenceId,
		source: options.source,
		sourceFormat: options.sourceFormat ?? "plain",
		language: options.language ?? "zh-Hans",
		duration: options.duration,
		seed: options.seed,
		starterPreset: options.starterPreset,
		rendererSupport: [...options.rendererSupport],
	});

const canonicalPresetPreview: CreateMotionTextPresetPreviewCore = (options) =>
	createMotionTextPresetPreviewCore({
		sequenceId: options.sequenceId,
		previewText: options.previewText,
		language: options.language,
		duration: options.duration,
		seed: options.seed,
		presetGroup: options.presetGroup,
		presetId: options.presetId,
		rendererSupport: [...options.rendererSupport],
	});

const canonicalRestyle: RestyleMotionTextSequenceCore = (options) =>
	restyleMotionTextSequence({
		sequenceJson: options.sequenceJson,
		starterPreset: options.starterPreset,
		rendererSupport: [...options.rendererSupport],
	});

const canonicalMutation: MutateMotionTextSequenceCore = (options) =>
	mutateMotionTextSequenceCore({
		sequenceJson: options.sequenceJson,
		mutationJson: options.mutationJson,
		rendererSupport: [...options.rendererSupport],
	});

const canonicalVariation: CreateMotionTextVariationCandidateCore = (options) =>
	createMotionTextVariationCandidateCore({
		sequenceJson: options.sequenceJson,
		salt: options.salt,
		cueIds: [...options.cueIds],
		groups: [...options.groups],
		rendererSupport: [...options.rendererSupport],
	});

const canonicalJizuraImport: ImportJizuraMotionTextProjectCore = (options) =>
	importJizuraMotionTextProjectCore({
		sequenceId: options.sequenceId,
		projectJson: options.projectJson,
		rendererSupport: [...options.rendererSupport],
	});

describe("motion-text Rust sequence factory seam", () => {
	test("applies catalog presets through the canonical WASM mutation seam", () => {
		const created = createStarterMotionTextSequence({
			sequenceId: "catalog-application", source: "First line\nSecond line",
			duration: 1_800_000, starterPreset: "clean-caption",
			rendererSupport: MOTION_TEXT_RENDERER_SUPPORT, core: canonicalFactory,
		});
		if (!created.sequence) throw new Error("Fixture sequence missing");
		const result = mutateMotionTextSequence({
			sequence: created.sequence,
			mutation: { kind: "apply-preset", group: "style", presetId: "crimson" },
			rendererSupport: MOTION_TEXT_RENDERER_SUPPORT, core: canonicalMutation,
		});
		expect(result.sequence?.revision).toBe(1);
		expect(result.sequence?.cues.every((cue) => cue.overrides.preset?.style === "crimson")).toBe(true);
		expect(result.sequence?.resolvedPlan?.cuts.every((cut) => cut.preset.style === "crimson")).toBe(true);
		expect(created.sequence.revision).toBe(0);
	});
	test("creates contract-valid preset previews through the canonical WASM seam", () => {
		const created = createMotionTextPresetPreview({
			sequenceId: "preview:layout:huge",
			previewText: "RO CUT\nNEXT FRAME",
			duration: 720_000,
			seed: 17,
			presetGroup: "layout",
			presetId: "huge",
			rendererSupport: MOTION_TEXT_RENDERER_SUPPORT,
			core: canonicalPresetPreview,
		});

		expect(created.diagnostics).toEqual([]);
		expect(created.sequence?.cues).toHaveLength(2);
		expect(created.sequence?.defaults.preset.layout).toBe("huge");
		expect(
			created.sequence?.resolvedPlan?.cuts.every(
				(cut) => cut.preset.layout === "huge",
			),
		).toBe(true);
	});

	test("strictly decodes preset preview results", () => {
		expect(() =>
			createMotionTextPresetPreview({
				sequenceId: "preview:invalid",
				previewText: "Preview",
				duration: 720_000,
				presetGroup: "enter",
				presetId: "pop",
				rendererSupport: MOTION_TEXT_RENDERER_SUPPORT,
				core: () => ({ sequenceJson: 42, diagnostics: [] }),
			}),
		).toThrow("invalid sequence payload");
	});

	for (const starterPreset of [
		"clean-caption",
		"impact-title",
		"editorial-paper",
		"mono-marquee",
	] as const) {
		test(`creates a contract-valid ${starterPreset} sequence`, () => {
			const created = createStarterMotionTextSequence({
				sequenceId: `sequence:${starterPreset}`,
				source: "风从城里来\n灯在雨里亮\n我们继续向前",
				duration: 1_800_000,
				starterPreset,
				rendererSupport: MOTION_TEXT_RENDERER_SUPPORT,
				core: canonicalFactory,
			});

			expect(created.sequence).not.toBeNull();
			expect(created.sequence?.cues).toHaveLength(3);
			expect(created.sequence?.fonts).toHaveLength(25);
			expect(created.sequence?.defaults.fontId).toBe("gothic_bold_zh_hans");
			expect(created.sequence?.fonts[0]).toMatchObject({
				id: "gothic_black",
				source: "builtin",
				supportedLanguages: ["ja", "en"],
				builtinPath: "motion-text/fonts/noto-sans-jp-variable.ttf",
			});
			expect(created.sequence?.cues[0]?.timingSource).toBe("estimated");
			expect(created.sequence?.resolvedPlan?.cuts.length).toBeGreaterThan(0);
			expect(created.sequence?.defaults.preset.style).toBe(
				created.sequence?.resolvedPlan?.cuts[0]?.preset.style,
			);
		});
	}

	test("returns actionable diagnostics without a partial sequence", () => {
		const created = createStarterMotionTextSequence({
			sequenceId: "sequence:invalid-source",
			source: "[00:01]有时间\n没有时间",
			duration: 1_800_000,
			starterPreset: "clean-caption",
			rendererSupport: MOTION_TEXT_RENDERER_SUPPORT,
			core: canonicalFactory,
		});

		expect(created.sequence).toBeNull();
		expect(created.diagnostics).toContainEqual(
			expect.objectContaining({
				severity: "error",
				code: "mixed-lrc-timing",
			}),
		);
	});

	test("strictly decodes the JIZURA import contract", () => {
		const base = createStarterMotionTextSequence({
			sequenceId: "sequence:jizura-decoder",
			source: "风从城里来\n灯在雨里亮",
			duration: 1_800_000,
			starterPreset: "clean-caption",
			rendererSupport: MOTION_TEXT_RENDERER_SUPPORT,
			core: canonicalFactory,
		});
		expect(base.sequence).not.toBeNull();
		if (!base.sequence) return;
		const importCore: ImportJizuraMotionTextProjectCore = () => ({
			sequenceJson: JSON.stringify({
				...base.sequence,
				source: { format: "jizura", text: '{"version":1}' },
			}),
			resourcesNeeded: [
				{
					kind: "audio",
					id: "jizura-audio",
					path: "$.audio",
					status: "missing",
					requiredForFidelity: false,
					message: "Relink audio.",
				},
			],
			compatibilityReport: {
				status: "imported-with-warnings",
				sourceVersion: 1,
				sourceAppVersion: "fixture-1.0.0",
				items: [
					{
						path: "$.lyrics",
						status: "preserved",
						code: "lyrics-preserved",
						message: "Lyrics preserved.",
					},
				],
			},
			diagnostics: [],
		});

		const imported = importJizuraMotionTextProject({
			sequenceId: "sequence:jizura-decoder",
			projectJson: '{"version":1}',
			rendererSupport: MOTION_TEXT_RENDERER_SUPPORT,
			core: importCore,
		});

		expect(imported.sequence?.source.format).toBe("jizura");
		expect(imported.resourcesNeeded).toEqual([
			expect.objectContaining({ kind: "audio", status: "missing" }),
		]);
		expect(imported.compatibilityReport).toEqual(
			expect.objectContaining({
				status: "imported-with-warnings",
				sourceVersion: 1,
			}),
		);
	});

	test("imports a JIZURA v1 project through canonical WASM", () => {
		const imported = importJizuraMotionTextProject({
			sequenceId: "sequence:jizura-canonical",
			projectJson: JSON.stringify({
				version: 1,
				appVersion: "fixture-1.0.0",
				title: "City Light",
				artist: "Rocut Fixture",
				lyrics: "first line\nsecond line",
				style: "noir",
				lang: "en",
				seed: 20260928,
				timing: { lineTimes: { 0: 0.5, 1: 2.5 }, tail: 0.9 },
				overrides: { 0: { layout: "huge", enter: "pop" } },
			}),
			rendererSupport: MOTION_TEXT_RENDERER_SUPPORT,
			core: canonicalJizuraImport,
		});

		expect(imported.sequence).not.toBeNull();
		expect(imported.sequence?.revision).toBe(0);
		expect(imported.sequence?.source.format).toBe("jizura");
		expect(imported.sequence?.cues[0]).toEqual(
			expect.objectContaining({
				startTime: 60_000,
				timingSource: "manual",
			}),
		);
		expect(imported.sequence?.cues[0]?.overrides.preset).toEqual(
			expect.objectContaining({ layout: "huge", enter: "pop" }),
		);
		expect(imported.compatibilityReport.sourceAppVersion).toBe("fixture-1.0.0");
		expect(imported.resourcesNeeded).toContainEqual(
			expect.objectContaining({ kind: "audio", status: "missing" }),
		);
	});

	test("rejects inconsistent JIZURA import status metadata", () => {
		expect(() =>
			importJizuraMotionTextProject({
				sequenceId: "sequence:jizura-invalid-status",
				projectJson: "{}",
				rendererSupport: MOTION_TEXT_RENDERER_SUPPORT,
				core: () => ({
					sequenceJson: null,
					resourcesNeeded: [],
					compatibilityReport: {
						status: "imported",
						sourceVersion: 1,
						sourceAppVersion: null,
						items: [],
					},
					diagnostics: [],
				}),
			}),
		).toThrow("inconsistent import status");
	});

	test("restyles through canonical WASM with one revision", () => {
		const created = createStarterMotionTextSequence({
			sequenceId: "sequence:restyle",
			source: "夜色落下\n灯火醒来",
			duration: 1_800_000,
			starterPreset: "clean-caption",
			rendererSupport: MOTION_TEXT_RENDERER_SUPPORT,
			core: canonicalFactory,
		});
		expect(created.sequence).not.toBeNull();
		if (!created.sequence) return;

		const restyled = restyleStarterMotionTextSequence({
			sequence: created.sequence,
			starterPreset: "impact-title",
			rendererSupport: MOTION_TEXT_RENDERER_SUPPORT,
			core: canonicalRestyle,
		});

		expect(restyled.sequence?.revision).toBe(created.sequence.revision + 1);
		expect(restyled.sequence?.defaults.parameters["rocut.starterPreset"]).toBe(
			"impact-title",
		);
		expect(restyled.sequence?.resolvedPlan?.sequenceRevision).toBe(
			restyled.sequence?.revision,
		);
	});

	test("mutates cue content, timing, local style, and colors through canonical WASM", () => {
		const created = createStarterMotionTextSequence({
			sequenceId: "sequence:cue-edit",
			source: "旧的第一句\n第二句",
			duration: 1_800_000,
			starterPreset: "clean-caption",
			rendererSupport: MOTION_TEXT_RENDERER_SUPPORT,
			core: canonicalFactory,
		});
		expect(created.sequence).not.toBeNull();
		const firstCue = created.sequence?.cues[0];
		if (!created.sequence || !firstCue) return;

		const mutated = mutateMotionTextSequence({
			sequence: created.sequence,
			mutation: {
				kind: "update-cue",
				cueId: firstCue.id,
				text: "改后的第一句",
				startTime: firstCue.startTime,
				duration: 600_000,
				preset: { mode: "starter", starterPreset: "impact-title" },
				font: { mode: "inherit" },
				colors: {
					mode: "set",
					foreground: "#f4f4f5",
					accent: "#ef4444",
				},
			},
			rendererSupport: MOTION_TEXT_RENDERER_SUPPORT,
			core: canonicalMutation,
		});

		expect(mutated.sequence?.revision).toBe(created.sequence.revision + 1);
		expect(mutated.sequence?.cues[0]?.text).toBe("改后的第一句");
		expect(mutated.sequence?.cues[0]?.duration).toBe(600_000);
		expect(mutated.sequence?.cues[0]?.timingSource).toBe("manual");
		expect(mutated.sequence?.cues[0]?.overrides.preset?.style).toBe("crimson");
		expect(mutated.sequence?.cues[0]?.overrides.colors?.accent).toBe("#ef4444");
	});

	test("applies staged cue taps from a stable cue id in one revision", () => {
		const created = createStarterMotionTextSequence({
			sequenceId: "sequence:cue-taps",
			source: "第一句\n第二句\n第三句",
			duration: 1_800_000,
			starterPreset: "clean-caption",
			rendererSupport: MOTION_TEXT_RENDERER_SUPPORT,
			core: canonicalFactory,
		});
		const sequence = created.sequence;
		const secondCue = sequence?.cues[1];
		if (!sequence || !secondCue) return;

		const tapped = mutateMotionTextSequence({
			sequence,
			mutation: {
				kind: "apply-cue-taps",
				startCueId: secondCue.id,
				tapTimes: [720_000, 1_320_000],
			},
			rendererSupport: MOTION_TEXT_RENDERER_SUPPORT,
			core: canonicalMutation,
		});

		expect(tapped.sequence?.revision).toBe(sequence.revision + 1);
		expect(tapped.sequence?.cues[0]?.timingSource).toBe("estimated");
		expect(tapped.sequence?.cues[1]).toEqual(
			expect.objectContaining({
				startTime: 720_000,
				duration: 600_000,
				timingSource: "tap",
			}),
		);
		expect(tapped.sequence?.cues[2]).toEqual(
			expect.objectContaining({
				startTime: 1_320_000,
				duration: 480_000,
				timingSource: "tap",
			}),
		);
	});

	test("moves a stable cut boundary and persists the full cue partition", () => {
		const created = createStarterMotionTextSequence({
			sequenceId: "sequence:cut-boundary",
			source: "一/二/三\n第四句",
			duration: 1_800_000,
			starterPreset: "clean-caption",
			rendererSupport: MOTION_TEXT_RENDERER_SUPPORT,
			core: canonicalFactory,
		});
		const sequence = created.sequence;
		const firstCue = sequence?.cues[0];
		const firstCut = sequence?.resolvedPlan?.cuts.find(
			(cut) => cut.cueId === firstCue?.id,
		);
		if (!sequence || !firstCue || !firstCut) return;

		const moved = mutateMotionTextSequence({
			sequence,
			mutation: {
				kind: "set-cut-boundary",
				cutId: firstCut.id,
				endTime: 400_000,
			},
			rendererSupport: MOTION_TEXT_RENDERER_SUPPORT,
			core: canonicalMutation,
		});

		expect(moved.sequence?.revision).toBe(sequence.revision + 1);
		expect(moved.sequence?.cues[0]?.cutDurations).toEqual([
			400_000, 200_000, 300_000,
		]);
		expect(
			moved.sequence?.resolvedPlan?.cuts
				.filter((cut) => cut.cueId === firstCue.id)
				.map((cut) => cut.duration),
		).toEqual([400_000, 200_000, 300_000]);
	});

	test("adds and removes precise cue locks through canonical WASM", () => {
		const created = createStarterMotionTextSequence({
			sequenceId: "sequence:lock-edit",
			source: "一/二/三\n第四句",
			duration: 1_800_000,
			starterPreset: "clean-caption",
			rendererSupport: MOTION_TEXT_RENDERER_SUPPORT,
			core: canonicalFactory,
		});
		const sequence = created.sequence;
		const cue = sequence?.cues[0];
		if (!sequence || !cue) return;

		const locked = mutateMotionTextSequence({
			sequence,
			mutation: {
				kind: "set-cue-lock",
				cueId: cue.id,
				scope: "preset-group",
				key: "layout",
				locked: true,
			},
			rendererSupport: MOTION_TEXT_RENDERER_SUPPORT,
			core: canonicalMutation,
		});

		expect(locked.diagnostics).toEqual([]);
		expect(locked.sequence?.revision).toBe(sequence.revision + 1);
		expect(locked.sequence?.cues[0]?.locks).toEqual([
			{ scope: "preset-group", key: "layout" },
		]);
		expect(locked.sequence?.resolvedPlan?.sequenceRevision).toBe(
			locked.sequence?.revision,
		);

		if (!locked.sequence) return;
		const varied = createMotionTextVariationCandidate({
			sequence: locked.sequence,
			salt: 41,
			cueIds: [cue.id],
			groups: ["style", "layout"],
			rendererSupport: MOTION_TEXT_RENDERER_SUPPORT,
			core: canonicalVariation,
		});
		const beforeLayouts = locked.sequence.resolvedPlan?.cuts
			.filter((cut) => cut.cueId === cue.id)
			.map((cut) => cut.preset.layout);
		const afterLayouts = varied.sequence?.resolvedPlan?.cuts
			.filter((cut) => cut.cueId === cue.id)
			.map((cut) => cut.preset.layout);
		expect(afterLayouts).toEqual(beforeLayouts);
		expect(varied.sequence?.cues[0]?.locks).toEqual([
			{ scope: "preset-group", key: "layout" },
		]);

		const unlocked = mutateMotionTextSequence({
			sequence: locked.sequence,
			mutation: {
				kind: "set-cue-lock",
				cueId: cue.id,
				scope: "preset-group",
				key: "layout",
				locked: false,
			},
			rendererSupport: MOTION_TEXT_RENDERER_SUPPORT,
			core: canonicalMutation,
		});
		expect(unlocked.sequence?.cues[0]?.locks).toEqual([]);
		expect(unlocked.sequence?.revision).toBe(locked.sequence.revision + 1);
	});

	test("updates Rust-owned JIZURA planning controls in one revision", () => {
		const created = createStarterMotionTextSequence({
			sequenceId: "sequence:planning-controls",
			source: "风从城里来\n灯在雨里亮",
			duration: 1_200_000,
			starterPreset: "clean-caption",
			rendererSupport: MOTION_TEXT_RENDERER_SUPPORT,
			core: canonicalFactory,
		});
		if (!created.sequence) return;
		expect(created.sequence.planningControls).toEqual({
			presetSets: { horror: false, typo: true, kinetic: true },
			unify: false,
			centerFree: false,
			centerDirection: "tb",
		});

		const mutated = mutateMotionTextSequence({
			sequence: created.sequence,
			mutation: {
				kind: "update-planning-controls",
				controls: {
					presetSets: { horror: true, typo: false, kinetic: true },
					unify: true,
					centerFree: true,
					centerDirection: "lr",
				},
			},
			rendererSupport: MOTION_TEXT_RENDERER_SUPPORT,
			core: canonicalMutation,
		});

		expect(mutated.sequence?.revision).toBe(created.sequence.revision + 1);
		expect(mutated.sequence?.planningControls).toEqual({
			presetSets: { horror: true, typo: false, kinetic: true },
			unify: true,
			centerFree: true,
			centerDirection: "lr",
		});
		expect(
			mutated.sequence?.resolvedPlan?.cuts.every(
				(cut) => cut.parameters["jizura.centerFree"] !== undefined,
			),
		).toBe(true);
	});

	test("binds analyzed audio through canonical WASM with one revision", () => {
		const created = createStarterMotionTextSequence({
			sequenceId: "sequence:audio-binding",
			source: "第一句\n第二句",
			duration: 1_800_000,
			starterPreset: "clean-caption",
			rendererSupport: MOTION_TEXT_RENDERER_SUPPORT,
			core: canonicalFactory,
		});
		if (!created.sequence) return;
		const contentDigest = `sha256:${"a".repeat(64)}`;

		const mutated = mutateMotionTextSequence({
			sequence: created.sequence,
			mutation: {
				kind: "set-audio-binding",
				assetId: "asset:music",
				clipId: "clip:music",
				sourceOffset: 24_000,
				duration: 1_200_000,
				contentDigest,
				analysis: {
					version: 1,
					contentDigest,
					bpm: 120,
					firstBeat: 12_000,
				},
			},
			rendererSupport: MOTION_TEXT_RENDERER_SUPPORT,
			core: canonicalMutation,
		});

		expect(mutated.sequence?.revision).toBe(created.sequence.revision + 1);
		expect(mutated.sequence?.audioBinding).toEqual({
			assetId: "asset:music",
			clipId: "clip:music",
			sourceOffset: 24_000,
			duration: 1_200_000,
			contentDigest,
			analysis: {
				version: 1,
				contentDigest,
				bpm: 120,
				firstBeat: 12_000,
			},
		});
		expect(mutated.sequence?.resolvedPlan?.sequenceRevision).toBe(
			mutated.sequence?.revision,
		);

		if (!mutated.sequence) return;
		const overridden = mutateMotionTextSequence({
			sequence: mutated.sequence,
			mutation: {
				kind: "set-audio-beat-override",
				bpm: 128,
				firstBeat: 30_000,
			},
			rendererSupport: MOTION_TEXT_RENDERER_SUPPORT,
			core: canonicalMutation,
		});
		expect(overridden.sequence?.revision).toBe(mutated.sequence.revision + 1);
		expect(overridden.sequence?.audioBinding?.beatOverride).toEqual({
			bpm: 128,
			firstBeat: 30_000,
		});
		expect(overridden.sequence?.audioBinding?.analysis?.bpm).toBe(120);
	});

	test("prepares an atomic audio timing synchronization through canonical WASM", () => {
		const created = createStarterMotionTextSequence({
			sequenceId: "sequence:audio-sync",
			source: "手工保留\n自动移动",
			duration: 1_800_000,
			starterPreset: "clean-caption",
			rendererSupport: MOTION_TEXT_RENDERER_SUPPORT,
			core: canonicalFactory,
		});
		const sequence = created.sequence;
		const firstCue = sequence?.cues[0];
		if (!sequence || !firstCue) return;

		const manual = mutateMotionTextSequence({
			sequence,
			mutation: {
				kind: "update-cue",
				cueId: firstCue.id,
				text: firstCue.text,
				startTime: firstCue.startTime,
				duration: 600_000,
				preset: { mode: "keep" },
				font: { mode: "keep" },
				colors: { mode: "keep" },
			},
			rendererSupport: MOTION_TEXT_RENDERER_SUPPORT,
			core: canonicalMutation,
		});
		if (!manual.sequence) return;
		const oldDigest = `sha256:${"a".repeat(64)}`;
		const bound = mutateMotionTextSequence({
			sequence: manual.sequence,
			mutation: {
				kind: "set-audio-binding",
				assetId: "asset:old-music",
				clipId: "clip:old-music",
				sourceOffset: 24_000,
				duration: 1_200_000,
				contentDigest: oldDigest,
				analysis: null,
			},
			rendererSupport: MOTION_TEXT_RENDERER_SUPPORT,
			core: canonicalMutation,
		});
		const boundSequence = bound.sequence;
		const derivedStart = boundSequence?.cues[1]?.startTime;
		if (!boundSequence || derivedStart === undefined) return;
		const newDigest = `sha256:${"b".repeat(64)}`;

		const synchronized = mutateMotionTextSequence({
			sequence: boundSequence,
			mutation: {
				kind: "sync-audio-timing",
				assetId: "asset:new-music",
				clipId: "clip:new-music",
				sourceOffset: 48_000,
				duration: 1_100_000,
				contentDigest: newDigest,
				analysis: null,
			},
			rendererSupport: MOTION_TEXT_RENDERER_SUPPORT,
			core: canonicalMutation,
		});

		expect(synchronized.diagnostics).toEqual([]);
		expect(synchronized.sequence?.revision).toBe(boundSequence.revision + 1);
		expect(synchronized.sequence?.resolvedPlan?.sequenceRevision).toBe(
			synchronized.sequence?.revision,
		);
		expect(synchronized.sequence?.cues[0]?.startTime).toBe(
			boundSequence.cues[0]?.startTime,
		);
		expect(synchronized.sequence?.cues[0]?.timingSource).toBe("manual");
		expect(synchronized.sequence?.cues[1]?.startTime).toBe(
			derivedStart - 24_000,
		);
		expect(synchronized.sequence?.audioBinding).toEqual({
			assetId: "asset:new-music",
			clipId: "clip:new-music",
			sourceOffset: 48_000,
			duration: 1_100_000,
			contentDigest: newDigest,
		});
	});

	test("creates a scoped variation candidate with explicit revision metadata", () => {
		const created = createStarterMotionTextSequence({
			sequenceId: "sequence:variation",
			source: "第一句\n第二句",
			duration: 1_800_000,
			starterPreset: "clean-caption",
			rendererSupport: MOTION_TEXT_RENDERER_SUPPORT,
			core: canonicalFactory,
		});
		const sequence = created.sequence;
		const firstCue = sequence?.cues[0];
		if (!sequence || !firstCue) return;
		const secondCueId = sequence.cues[1]?.id;
		const beforeSecondCue = sequence.resolvedPlan?.cuts.filter(
			(cut) => cut.cueId === secondCueId,
		);

		const candidate = createMotionTextVariationCandidate({
			sequence,
			salt: 17,
			cueIds: [firstCue.id],
			groups: ["style", "layout", "enter", "hold"],
			rendererSupport: MOTION_TEXT_RENDERER_SUPPORT,
			core: canonicalVariation,
		});

		expect(candidate.baseRevision).toBe(sequence.revision);
		expect(candidate.candidateRevision).toBe(sequence.revision + 1);
		expect(candidate.sequence?.revision).toBe(sequence.revision + 1);
		expect(
			candidate.sequence?.resolvedPlan?.cuts.filter(
				(cut) => cut.cueId === secondCueId,
			),
		).toEqual(beforeSecondCue);
	});

	test("rejects inconsistent variation candidate revision metadata", () => {
		const created = createStarterMotionTextSequence({
			sequenceId: "sequence:invalid-variation-result",
			source: "第一句",
			duration: 600_000,
			starterPreset: "clean-caption",
			rendererSupport: MOTION_TEXT_RENDERER_SUPPORT,
			core: canonicalFactory,
		});
		const sequence = created.sequence;
		if (!sequence) return;

		expect(() =>
			createMotionTextVariationCandidate({
				sequence,
				salt: 1,
				groups: ["layout"],
				rendererSupport: MOTION_TEXT_RENDERER_SUPPORT,
				core: () => ({
					baseRevision: sequence.revision + 1,
					candidateRevision: sequence.revision + 1,
					salt: 1,
					sequenceJson: JSON.stringify({
						...sequence,
						revision: sequence.revision + 1,
						resolvedPlan: {
							...sequence.resolvedPlan,
							sequenceRevision: sequence.revision + 1,
						},
					}),
					diagnostics: [],
				}),
			}),
		).toThrow("inconsistent candidate revisions");
	});
});
