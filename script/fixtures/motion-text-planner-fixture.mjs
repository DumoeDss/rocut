export function motionTextPlannerFixture() {
	return {
		sequence: {
			id: "sequence:planner-probe",
			revision: 2,
			duration: 360_000,
			seed: 20260926,
			language: "en",
			engine: { tokenizerVersion: "unicode-v1" },
			defaults: {
				preset: {
					style: "noir",
					layout: "center",
					enter: "blur",
					hold: "still",
					exit: "blur",
					decor: [],
					treat: "none",
					bg: "none",
					cam: "push",
					fx: [],
					trans: null,
				},
				parameters: { density: 0.5, nullable: null },
			},
			cues: [
				{
					id: "cue:one",
					text: "hello vivid world",
					startTime: 0,
					duration: 120_000,
					interlude: false,
				},
				{
					id: "cue:two",
					text: "second line",
					startTime: 120_000,
					duration: 120_000,
					interlude: false,
				},
			],
		},
		catalog: {
			// These fields mirror the reduced planner metadata extracted from JIZURA's
			// `w`, `fits(n)`, `minDur`, and `maxChars` registry fields.
			choices: [
				{ group: "layout", id: "center", weight: 1 },
				{
					group: "layout",
					id: "stack",
					weight: 1,
					maxChars: 12,
				},
				{
					group: "layout",
					id: "long-copy-only",
					weight: 10_000,
					minChars: 100,
				},
				{ group: "enter", id: "blur", weight: 1 },
				{
					group: "enter",
					id: "unsupportedEnterFixture",
					weight: 0.8,
					maxChars: 20,
					minDuration: 50_000,
				},
			],
		},
		rendererSupport: [
			{ group: "style", id: "noir" },
			{ group: "layout", id: "center" },
			{ group: "layout", id: "stack" },
			{ group: "enter", id: "blur" },
			{ group: "hold", id: "still" },
			{ group: "exit", id: "blur" },
			{ group: "treat", id: "none" },
			{ group: "bg", id: "none" },
			{ group: "cam", id: "push" },
		],
		randomizeGroups: ["layout", "enter"],
	};
}

export function invalidMotionTextPlannerFixture() {
	const fixture = motionTextPlannerFixture();
	fixture.sequence.cues[1].startTime = 100_000;
	return fixture;
}

export function unsupportedRendererPresetFixture() {
	const fixture = motionTextPlannerFixture();
	fixture.randomizeGroups = [];
	fixture.sequence.defaults.preset.layout = "imported-layout";
	return fixture;
}

export const TOKENIZER_CASES = Object.freeze([
	{
		name: "zh-Hans",
		options: { text: "你好世界再次相见", language: "zh-Hans" },
	},
	{
		name: "ja",
		options: { text: "夜明けの色を覚えてる", language: "ja" },
	},
	{
		name: "ko",
		options: { text: "새벽빛을 기억해", language: "ko" },
	},
	{
		name: "en",
		options: { text: "I remember the color of dawn", language: "en" },
	},
	{
		name: "explicit",
		options: {
			text: "ignored",
			language: "ja",
			explicitSegments: ["夜明け", "の色"],
		},
	},
]);

function cueIdsByText(parsed) {
	return Object.fromEntries(parsed.cues.map((cue) => [cue.text, cue.id]));
}

function summarizedCuts(plan) {
	return plan.cuts.map((cut) => ({
		id: cut.id,
		cueId: cut.cueId,
		text: cut.text,
		startTime: cut.startTime,
		duration: cut.duration,
		seed: cut.seed,
		layout: cut.preset.layout,
		enter: cut.preset.enter,
		trans: cut.preset.trans,
		density: cut.parameters.density,
		nullable: cut.parameters.nullable,
	}));
}

export function motionTextSemanticSummary(api) {
	const tokenizer = Object.fromEntries(
		TOKENIZER_CASES.map(({ name, options }) => [
			name,
			api.tokenizeMotionText(options),
		]),
	);
	const baseParsed = api.parseMotionTextSource({
		sequenceId: "identity-probe",
		source: "[00:02.00]alpha\n[00:03.00]beta",
	});
	const prefixedParsed = api.parseMotionTextSource({
		sequenceId: "identity-probe",
		source: "[00:01.00]intro\n[00:02.00]alpha\n[00:03.00]beta",
	});
	const baseIds = cueIdsByText(baseParsed);
	const prefixedIds = cueIdsByText(prefixedParsed);
	const input = motionTextPlannerFixture();
	const initial = api.planMotionTextSequence(input);
	if (!initial.plan) throw new Error("semantic fixture did not produce a plan");
	const variedInput = motionTextPlannerFixture();
	variedInput.sequence.resolvedPlan = initial.plan;
	variedInput.sequence.defaults.parameters.density = 0.9;
	variedInput.sequence.cues[0].locks = [
		{ scope: "preset-group", key: "layout" },
		{ scope: "parameter", key: "density" },
	];
	variedInput.variation = {
		salt: 4242,
		cueIds: ["cue:one"],
		groups: ["layout", "enter"],
	};
	const varied = api.planMotionTextSequence(variedInput);
	if (!varied.plan)
		throw new Error("semantic variation did not produce a plan");
	const invalid = api.planMotionTextSequence(invalidMotionTextPlannerFixture());
	const unsupported = api.planMotionTextSequence(
		unsupportedRendererPresetFixture(),
	);
	const initialCueOne = initial.plan.cuts.filter(
		(cut) => cut.cueId === "cue:one",
	);
	const variedCueOne = varied.plan.cuts.filter(
		(cut) => cut.cueId === "cue:one",
	);
	return {
		tokenizer,
		cueIdentity: {
			base: baseIds,
			prefixed: prefixedIds,
			stableAfterPrefix:
				baseIds.alpha === prefixedIds.alpha &&
				baseIds.beta === prefixedIds.beta,
		},
		initialPlan: {
			version: initial.plan.version,
			sequenceRevision: initial.plan.sequenceRevision,
			cuts: summarizedCuts(initial.plan),
		},
		variation: {
			cuts: summarizedCuts(varied.plan),
			untouchedCueStable:
				JSON.stringify(
					initial.plan.cuts.filter((cut) => cut.cueId === "cue:two"),
				) ===
				JSON.stringify(
					varied.plan.cuts.filter((cut) => cut.cueId === "cue:two"),
				),
			lockedLayoutStable: initialCueOne.every(
				(cut, index) =>
					cut.preset.layout === variedCueOne[index]?.preset.layout,
			),
			lockedParameterStable: variedCueOne.every(
				(cut) => cut.parameters.density === 0.5,
			),
		},
		invalidTiming: {
			plan: invalid.plan,
			codes: invalid.diagnostics.map((diagnostic) => diagnostic.code),
		},
		unsupportedRendererPreset: {
			plan: unsupported.plan,
			codes: [
				...new Set(
					unsupported.diagnostics.map((diagnostic) => diagnostic.code),
				),
			],
		},
	};
}
