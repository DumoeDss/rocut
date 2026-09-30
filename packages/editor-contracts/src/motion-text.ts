import type { AssetId, ClipId, MediaTime } from "./domain";

export const MOTION_TEXT_SCHEMA_VERSION = 1 as const;
export const MOTION_TEXT_PLAN_VERSION = 1 as const;

export const MOTION_TEXT_LIMITS = Object.freeze({
	maxCues: 10_000,
	maxCuts: 20_000,
	maxFonts: 128,
	maxSourceCharacters: 1_000_000,
	maxCueCharacters: 20_000,
	maxParameterDepth: 8,
	maxParameterNodes: 10_000,
	maxParameterStringCharacters: 16_384,
});

declare const __motionTextSequenceIdBrand: unique symbol;
declare const __motionTextCueIdBrand: unique symbol;
declare const __motionTextCutIdBrand: unique symbol;
declare const __motionTextFontIdBrand: unique symbol;

export type MotionTextSequenceId = string & {
	readonly [__motionTextSequenceIdBrand]: true;
};
export type MotionTextCueId = string & {
	readonly [__motionTextCueIdBrand]: true;
};
export type MotionTextCutId = string & {
	readonly [__motionTextCutIdBrand]: true;
};
export type MotionTextFontId = string & {
	readonly [__motionTextFontIdBrand]: true;
};

export function motionTextSequenceId(id: string): MotionTextSequenceId {
	// eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- Runtime validation happens at the wire boundary; this constructor adds the nominal brand.
	return id as MotionTextSequenceId;
}

export function motionTextCueId(id: string): MotionTextCueId {
	// eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- Runtime validation happens at the wire boundary; this constructor adds the nominal brand.
	return id as MotionTextCueId;
}

export function motionTextCutId(id: string): MotionTextCutId {
	// eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- Runtime validation happens at the wire boundary; this constructor adds the nominal brand.
	return id as MotionTextCutId;
}

export function motionTextFontId(id: string): MotionTextFontId {
	// eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- Runtime validation happens at the wire boundary; this constructor adds the nominal brand.
	return id as MotionTextFontId;
}

export type MotionTextSourceFormat = "plain" | "lrc" | "jizura";

export interface MotionTextSource {
	readonly format: MotionTextSourceFormat;
	readonly text: string;
}

export interface MotionTextEngineRef {
	readonly id: "jizura";
	readonly version: string;
	readonly catalogHash: string;
	readonly plannerVersion: number;
	readonly tokenizerVersion: string;
}

export interface MotionTextAudioAnalysisRef {
	readonly version: number;
	readonly contentDigest: string;
	readonly bpm?: number;
	/** Position in the analyzed audio source, before applying the binding source offset. */
	readonly firstBeat?: MediaTime;
}

export interface MotionTextAudioBeatOverride {
	readonly bpm?: number;
	/** Manual beat phase in sequence-local time. */
	readonly firstBeat?: MediaTime;
}

export interface MotionTextAudioBinding {
	readonly assetId: AssetId;
	readonly clipId?: ClipId;
	readonly sourceOffset: MediaTime;
	readonly duration?: MediaTime;
	readonly contentDigest?: string;
	readonly analysis?: MotionTextAudioAnalysisRef;
	readonly beatOverride?: MotionTextAudioBeatOverride;
}

export type MotionTextFontSource = "builtin" | "project" | "system";

export interface MotionTextFontAssetRef {
	readonly id: MotionTextFontId;
	readonly source: MotionTextFontSource;
	readonly family: string;
	readonly style: "normal" | "italic";
	readonly weight: number;
	readonly supportedLanguages?: readonly string[];
	readonly builtinPath?: string;
	readonly assetId?: AssetId;
	readonly contentDigest?: string;
}

export type MotionTextParameterValue =
	| null
	| boolean
	| number
	| string
	| readonly MotionTextParameterValue[]
	| { readonly [key: string]: MotionTextParameterValue };

export type MotionTextPresetGroup =
	| "style"
	| "layout"
	| "enter"
	| "hold"
	| "exit"
	| "decor"
	| "treat"
	| "bg"
	| "cam"
	| "fx"
	| "trans";

export interface MotionTextPresetSelection {
	readonly style: string;
	readonly layout: string;
	readonly enter: string;
	readonly hold: string;
	readonly exit: string;
	readonly decor: readonly string[];
	readonly treat: string;
	readonly bg: string;
	readonly cam: string;
	readonly fx: readonly string[];
	readonly trans: string | null;
}

export interface MotionTextOverrides {
	readonly preset?: Partial<MotionTextPresetSelection>;
	readonly fontId?: MotionTextFontId;
	readonly colors?: Readonly<Record<string, string>>;
	readonly parameters?: Readonly<Record<string, MotionTextParameterValue>>;
}

export interface MotionTextDefaults {
	readonly preset: MotionTextPresetSelection;
	readonly fontId?: MotionTextFontId;
	readonly colors: Readonly<Record<string, string>>;
	readonly parameters: Readonly<Record<string, MotionTextParameterValue>>;
}

export interface MotionTextPresetSetControls {
	readonly horror: boolean;
	readonly typo: boolean;
	readonly kinetic: boolean;
}

export type MotionTextCenterDirection = "tb" | "lr";

export interface MotionTextPlanningControls {
	readonly presetSets: MotionTextPresetSetControls;
	readonly unify: boolean;
	readonly centerFree: boolean;
	readonly centerDirection: MotionTextCenterDirection;
}

export const DEFAULT_MOTION_TEXT_PLANNING_CONTROLS: MotionTextPlanningControls =
	Object.freeze({
		presetSets: Object.freeze({
			horror: false,
			typo: true,
			kinetic: true,
		}),
		unify: false,
		centerFree: false,
		centerDirection: "tb",
	});

export interface MotionTextLock {
	readonly scope: "cue" | "cut" | "preset-group" | "parameter";
	readonly key: string;
}

export interface MotionTextCue {
	readonly id: MotionTextCueId;
	readonly text: string;
	readonly startTime: MediaTime;
	readonly duration: MediaTime;
	readonly timingSource?: "lrc" | "estimated" | "manual" | "tap";
	readonly sourceLine?: number;
	readonly interlude: boolean;
	readonly gapBefore: boolean;
	readonly note?: string;
	readonly impact: boolean;
	readonly emphasis: readonly string[];
	readonly segments: readonly string[];
	readonly cutDurations?: readonly MediaTime[];
	readonly locks: readonly MotionTextLock[];
	readonly overrides: MotionTextOverrides;
}

export interface MotionTextResolvedCut {
	readonly id: MotionTextCutId;
	readonly cueId: MotionTextCueId;
	readonly text: string;
	readonly startTime: MediaTime;
	readonly duration: MediaTime;
	readonly seed: number;
	readonly preset: MotionTextPresetSelection;
	readonly fontId?: MotionTextFontId;
	readonly parameters: Readonly<Record<string, MotionTextParameterValue>>;
}

export interface MotionTextResolvedPlan {
	readonly version: typeof MOTION_TEXT_PLAN_VERSION;
	readonly sequenceRevision: number;
	readonly cuts: readonly MotionTextResolvedCut[];
}

export interface MotionTextSequence {
	readonly id: MotionTextSequenceId;
	readonly schemaVersion: typeof MOTION_TEXT_SCHEMA_VERSION;
	readonly revision: number;
	readonly source: MotionTextSource;
	readonly language: string;
	/** Missing on legacy v1 documents; consumers must use the exported JIZURA defaults. */
	readonly planningControls?: MotionTextPlanningControls;
	readonly duration: MediaTime;
	readonly compositionMode: "overlay" | "scene";
	readonly seed: number;
	readonly engine: MotionTextEngineRef;
	readonly audioBinding?: MotionTextAudioBinding;
	readonly fonts: readonly MotionTextFontAssetRef[];
	readonly defaults: MotionTextDefaults;
	readonly cues: readonly MotionTextCue[];
	readonly resolvedPlan?: MotionTextResolvedPlan;
}

export interface MotionTextClipContent {
	readonly kind: "motion-text";
	readonly sequenceId: MotionTextSequenceId;
}

export interface MotionTextValidationIssue {
	readonly code:
		| "invalid-value"
		| "invalid-id"
		| "unsupported-version"
		| "unknown-preset"
		| "resource-limit"
		| "duplicate-id"
		| "missing-relation"
		| "out-of-range";
	readonly path: string;
	readonly message: string;
}

export interface MotionTextValidationOptions {
	readonly knownPresetIds?: ReadonlySet<string>;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function validId(value: unknown): value is string {
	return (
		typeof value === "string" &&
		/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(value)
	);
}

const MOTION_TEXT_LOCK_SCOPES = new Set([
	"cue",
	"cut",
	"preset-group",
	"parameter",
]);
const MOTION_TEXT_PRESET_GROUPS = new Set<string>([
	"style",
	"layout",
	"enter",
	"hold",
	"exit",
	"decor",
	"treat",
	"bg",
	"cam",
	"fx",
	"trans",
]);

function validMotionTextLock(value: unknown): value is MotionTextLock {
	if (
		!isRecord(value) ||
		typeof value.scope !== "string" ||
		!MOTION_TEXT_LOCK_SCOPES.has(value.scope) ||
		typeof value.key !== "string"
	) {
		return false;
	}
	if (value.scope === "cue") {
		return ["all", "preset", "parameters"].includes(value.key);
	}
	if (value.scope === "cut") return validId(value.key);
	if (value.scope === "preset-group") {
		return MOTION_TEXT_PRESET_GROUPS.has(value.key);
	}
	return (
		value.key.length > 0 &&
		value.key.length <= 256 &&
		![...value.key].some((character) => /\p{Cc}/u.test(character))
	);
}

function validBuiltinFontPath(value: unknown): value is string {
	return (
		typeof value === "string" &&
		/^motion-text\/fonts\/[a-z0-9][a-z0-9-]*\.ttf$/u.test(value)
	);
}

function nonNegativeInteger(value: unknown): value is number {
	return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function positiveInteger(value: unknown): value is number {
	return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function finitePositive(value: unknown): value is number {
	return typeof value === "number" && Number.isFinite(value) && value > 0;
}

interface IssueInput {
	readonly issues: MotionTextValidationIssue[];
	readonly value: MotionTextValidationIssue;
}

function issue(args: IssueInput): void;
function issue(
	issues: MotionTextValidationIssue[],
	value: MotionTextValidationIssue,
): void;
// eslint-disable-next-line opencut/prefer-object-params -- The second overload temporarily preserves the pre-freeze internal call form while the public validator is stabilized.
function issue(
	argsOrIssues: IssueInput | MotionTextValidationIssue[],
	value?: MotionTextValidationIssue,
): void {
	if (Array.isArray(argsOrIssues)) {
		if (value !== undefined) argsOrIssues.push(value);
		return;
	}
	argsOrIssues.issues.push(argsOrIssues.value);
}

function validateParameterTree(args: {
	readonly value: unknown;
	readonly path: string;
	readonly issues: MotionTextValidationIssue[];
	readonly state: { nodes: number };
	readonly depth?: number;
}): void {
	const depth = args.depth ?? 0;
	args.state.nodes += 1;
	if (args.state.nodes > MOTION_TEXT_LIMITS.maxParameterNodes) {
		issue({
			issues: args.issues,
			value: {
				code: "resource-limit",
				path: args.path,
				message: "Motion-text parameter tree exceeds its node limit",
			},
		});
		return;
	}
	if (depth > MOTION_TEXT_LIMITS.maxParameterDepth) {
		issue({
			issues: args.issues,
			value: {
				code: "resource-limit",
				path: args.path,
				message: "Motion-text parameter tree exceeds its depth limit",
			},
		});
		return;
	}
	if (args.value === null || typeof args.value === "boolean") return;
	if (typeof args.value === "number") {
		if (!Number.isFinite(args.value)) {
			issue({
				issues: args.issues,
				value: {
					code: "invalid-value",
					path: args.path,
					message: "Motion-text parameter numbers must be finite",
				},
			});
		}
		return;
	}
	if (typeof args.value === "string") {
		if (args.value.length > MOTION_TEXT_LIMITS.maxParameterStringCharacters) {
			issue({
				issues: args.issues,
				value: {
					code: "resource-limit",
					path: args.path,
					message: "Motion-text parameter string exceeds its character limit",
				},
			});
		}
		return;
	}
	if (Array.isArray(args.value)) {
		for (let index = 0; index < args.value.length; index += 1) {
			validateParameterTree({
				...args,
				value: args.value[index],
				path: `${args.path}[${index}]`,
				depth: depth + 1,
			});
		}
		return;
	}
	if (isRecord(args.value)) {
		for (const [key, value] of Object.entries(args.value)) {
			validateParameterTree({
				...args,
				value,
				path: `${args.path}.${key}`,
				depth: depth + 1,
			});
		}
		return;
	}
	issue({
		issues: args.issues,
		value: {
			code: "invalid-value",
			path: args.path,
			message: "Motion-text parameters must be JSON-compatible data",
		},
	});
}

const PRESET_FIELDS: Readonly<
	Array<readonly [MotionTextPresetGroup, keyof MotionTextPresetSelection]>
> = [
	["style", "style"],
	["layout", "layout"],
	["enter", "enter"],
	["hold", "hold"],
	["exit", "exit"],
	["treat", "treat"],
	["bg", "bg"],
	["cam", "cam"],
];

function validatePresetSelection(args: {
	readonly value: unknown;
	readonly path: string;
	readonly issues: MotionTextValidationIssue[];
	readonly knownPresetIds?: ReadonlySet<string>;
}): void {
	if (!isRecord(args.value)) {
		issue({
			issues: args.issues,
			value: {
				code: "invalid-value",
				path: args.path,
				message: "Motion-text preset selection must be an object",
			},
		});
		return;
	}
	const checkPreset = (input: {
		readonly group: MotionTextPresetGroup;
		readonly value: unknown;
		readonly path: string;
	}) => {
		const { group, value, path } = input;
		if (!validId(value)) {
			issue({
				issues: args.issues,
				value: {
					code: "invalid-id",
					path,
					message: `Motion-text ${group} preset id is invalid`,
				},
			});
			return;
		}
		if (args.knownPresetIds && !args.knownPresetIds.has(`${group}:${value}`)) {
			issue({
				issues: args.issues,
				value: {
					code: "unknown-preset",
					path,
					message: `Unknown motion-text preset ${group}:${value}`,
				},
			});
		}
	};
	for (const [group, field] of PRESET_FIELDS) {
		checkPreset({
			group,
			value: args.value[field],
			path: `${args.path}.${field}`,
		});
	}
	for (const [group, field] of [
		["decor", "decor"],
		["fx", "fx"],
	] as const) {
		const values = args.value[field];
		if (!Array.isArray(values)) {
			issue({
				issues: args.issues,
				value: {
					code: "invalid-value",
					path: `${args.path}.${field}`,
					message: `Motion-text ${field} presets must be an array`,
				},
			});
			continue;
		}
		values.forEach((value, index) =>
			checkPreset({
				group,
				value,
				path: `${args.path}.${field}[${index}]`,
			}),
		);
	}
	if (args.value.trans !== null) {
		checkPreset({
			group: "trans",
			value: args.value.trans,
			path: `${args.path}.trans`,
		});
	}
}

export function validateMotionTextSequence(args: {
	readonly value: unknown;
	readonly options?: MotionTextValidationOptions;
}): readonly MotionTextValidationIssue[] {
	const { value, options = {} } = args;
	const issues: MotionTextValidationIssue[] = [];
	if (!isRecord(value)) {
		return [
			{
				code: "invalid-value",
				path: "sequence",
				message: "Motion-text sequence must be an object",
			},
		];
	}
	if (!validId(value.id)) {
		issue(issues, {
			code: "invalid-id",
			path: "sequence.id",
			message: "Motion-text sequence id is invalid",
		});
	}
	if (value.schemaVersion !== MOTION_TEXT_SCHEMA_VERSION) {
		issue(issues, {
			code: "unsupported-version",
			path: "sequence.schemaVersion",
			message: `Unsupported motion-text schema version ${String(value.schemaVersion)}`,
		});
	}
	if (!nonNegativeInteger(value.revision)) {
		issue(issues, {
			code: "invalid-value",
			path: "sequence.revision",
			message: "Motion-text sequence revision must be a non-negative integer",
		});
	}
	if (
		!isRecord(value.source) ||
		!["plain", "lrc", "jizura"].includes(String(value.source.format)) ||
		typeof value.source.text !== "string"
	) {
		issue(issues, {
			code: "invalid-value",
			path: "sequence.source",
			message: "Motion-text source is invalid",
		});
	} else if (
		value.source.text.length > MOTION_TEXT_LIMITS.maxSourceCharacters
	) {
		issue(issues, {
			code: "resource-limit",
			path: "sequence.source.text",
			message: "Motion-text source exceeds its character limit",
		});
	}
	if (typeof value.language !== "string" || value.language.length === 0) {
		issue(issues, {
			code: "invalid-value",
			path: "sequence.language",
			message: "Motion-text language must be a non-empty string",
		});
	}
	if (value.planningControls !== undefined) {
		const controls = value.planningControls;
		if (
			!isRecord(controls) ||
			!isRecord(controls.presetSets) ||
			typeof controls.presetSets.horror !== "boolean" ||
			typeof controls.presetSets.typo !== "boolean" ||
			typeof controls.presetSets.kinetic !== "boolean" ||
			typeof controls.unify !== "boolean" ||
			typeof controls.centerFree !== "boolean" ||
			(controls.centerDirection !== "tb" && controls.centerDirection !== "lr")
		) {
			issue(issues, {
				code: "invalid-value",
				path: "sequence.planningControls",
				message: "Motion-text planning controls are invalid",
			});
		}
	}
	if (!positiveInteger(value.duration)) {
		issue(issues, {
			code: "invalid-value",
			path: "sequence.duration",
			message: "Motion-text sequence duration must be positive",
		});
	}
	if (
		value.compositionMode !== "overlay" &&
		value.compositionMode !== "scene"
	) {
		issue(issues, {
			code: "invalid-value",
			path: "sequence.compositionMode",
			message: "Motion-text composition mode must be overlay or scene",
		});
	}
	if (!nonNegativeInteger(value.seed) || value.seed > 0xffff_ffff) {
		issue(issues, {
			code: "invalid-value",
			path: "sequence.seed",
			message: "Motion-text seed must be an unsigned 32-bit integer",
		});
	}
	if (
		!isRecord(value.engine) ||
		value.engine.id !== "jizura" ||
		typeof value.engine.version !== "string" ||
		value.engine.version.length === 0 ||
		typeof value.engine.catalogHash !== "string" ||
		value.engine.catalogHash.length === 0 ||
		!positiveInteger(value.engine.plannerVersion) ||
		typeof value.engine.tokenizerVersion !== "string" ||
		value.engine.tokenizerVersion.length === 0
	) {
		issue(issues, {
			code: "invalid-value",
			path: "sequence.engine",
			message: "Motion-text engine reference is invalid",
		});
	}
	if (value.audioBinding !== undefined) {
		const binding = value.audioBinding;
		if (
			!isRecord(binding) ||
			!validId(binding.assetId) ||
			(binding.clipId !== undefined && !validId(binding.clipId)) ||
			!nonNegativeInteger(binding.sourceOffset) ||
			(binding.duration !== undefined && !positiveInteger(binding.duration)) ||
			(binding.contentDigest !== undefined &&
				(typeof binding.contentDigest !== "string" ||
					binding.contentDigest.length === 0))
		) {
			issue(issues, {
				code: "invalid-value",
				path: "sequence.audioBinding",
				message: "Motion-text audio binding is invalid",
			});
		} else if (
			binding.analysis !== undefined &&
			(!isRecord(binding.analysis) ||
				!positiveInteger(binding.analysis.version) ||
				typeof binding.analysis.contentDigest !== "string" ||
				binding.analysis.contentDigest.length === 0 ||
				(binding.analysis.bpm !== undefined &&
					!finitePositive(binding.analysis.bpm)) ||
				(binding.analysis.firstBeat !== undefined &&
					!nonNegativeInteger(binding.analysis.firstBeat)))
		) {
			issue(issues, {
				code: "invalid-value",
				path: "sequence.audioBinding.analysis",
				message: "Motion-text audio analysis reference is invalid",
			});
		} else if (
			binding.beatOverride !== undefined &&
			(!isRecord(binding.beatOverride) ||
				(binding.beatOverride.bpm === undefined &&
					binding.beatOverride.firstBeat === undefined) ||
				(binding.beatOverride.bpm !== undefined &&
					(!finitePositive(binding.beatOverride.bpm) ||
						binding.beatOverride.bpm < 20 ||
						binding.beatOverride.bpm > 400)) ||
				(binding.beatOverride.firstBeat !== undefined &&
					!nonNegativeInteger(binding.beatOverride.firstBeat)))
		) {
			issue(issues, {
				code: "invalid-value",
				path: "sequence.audioBinding.beatOverride",
				message: "Motion-text audio beat override is invalid",
			});
		}
	}

	const cueIds = new Set<string>();
	if (!Array.isArray(value.cues)) {
		issue(issues, {
			code: "invalid-value",
			path: "sequence.cues",
			message: "Motion-text cues must be an array",
		});
	} else {
		if (value.cues.length > MOTION_TEXT_LIMITS.maxCues) {
			issue(issues, {
				code: "resource-limit",
				path: "sequence.cues",
				message: "Motion-text sequence exceeds its cue limit",
			});
		}
		value.cues.forEach((cue, index) => {
			const path = `sequence.cues[${index}]`;
			if (!isRecord(cue)) {
				issue(issues, {
					code: "invalid-value",
					path,
					message: "Motion-text cue must be an object",
				});
				return;
			}
			if (!validId(cue.id)) {
				issue(issues, {
					code: "invalid-id",
					path: `${path}.id`,
					message: "Motion-text cue id is invalid",
				});
			} else if (cueIds.has(cue.id)) {
				issue(issues, {
					code: "duplicate-id",
					path: `${path}.id`,
					message: `Duplicate motion-text cue id ${cue.id}`,
				});
			} else cueIds.add(cue.id);
			if (
				typeof cue.text !== "string" ||
				cue.text.length > MOTION_TEXT_LIMITS.maxCueCharacters
			) {
				issue(issues, {
					code: "resource-limit",
					path: `${path}.text`,
					message: "Motion-text cue text exceeds its character limit",
				});
			}
			if (
				!nonNegativeInteger(cue.startTime) ||
				!positiveInteger(cue.duration)
			) {
				issue(issues, {
					code: "invalid-value",
					path,
					message:
						"Motion-text cue requires non-negative time and positive duration",
				});
			}
			if (
				cue.timingSource !== undefined &&
				cue.timingSource !== "lrc" &&
				cue.timingSource !== "estimated" &&
				cue.timingSource !== "manual" &&
				cue.timingSource !== "tap"
			) {
				issue(issues, {
					code: "invalid-value",
					path: `${path}.timingSource`,
					message: "Motion-text cue timing source is invalid",
				});
			}
			if (
				positiveInteger(value.duration) &&
				nonNegativeInteger(cue.startTime) &&
				positiveInteger(cue.duration) &&
				cue.startTime + cue.duration > value.duration
			) {
				issue(issues, {
					code: "out-of-range",
					path,
					message: "Motion-text cue exceeds the sequence duration",
				});
			}
			if (
				typeof cue.interlude !== "boolean" ||
				typeof cue.gapBefore !== "boolean" ||
				typeof cue.impact !== "boolean" ||
				!Array.isArray(cue.emphasis) ||
				!cue.emphasis.every((entry) => typeof entry === "string") ||
				!Array.isArray(cue.segments) ||
				!cue.segments.every((entry) => typeof entry === "string") ||
				!Array.isArray(cue.locks)
			) {
				issue(issues, {
					code: "invalid-value",
					path,
					message: "Motion-text cue metadata is invalid",
				});
			}
			if (Array.isArray(cue.locks)) {
				const lockIdentities = new Set<string>();
				cue.locks.forEach((lock, lockIndex) => {
					const lockPath = `${path}.locks[${lockIndex}]`;
					if (!validMotionTextLock(lock)) {
						issue(issues, {
							code: "invalid-value",
							path: lockPath,
							message: "Motion-text cue lock scope or key is invalid",
						});
						return;
					}
					const identity = `${lock.scope}\0${lock.key}`;
					if (lockIdentities.has(identity)) {
						issue(issues, {
							code: "duplicate-id",
							path: lockPath,
							message: "Motion-text cue locks must be unique",
						});
					} else {
						lockIdentities.add(identity);
					}
				});
			}
			if (cue.cutDurations !== undefined) {
				if (
					!Array.isArray(cue.cutDurations) ||
					cue.cutDurations.length > MOTION_TEXT_LIMITS.maxCuts ||
					!cue.cutDurations.every(positiveInteger)
				) {
					issue(issues, {
						code: "invalid-value",
						path: `${path}.cutDurations`,
						message:
							"Motion-text custom cut durations must be positive integers",
					});
				} else {
					const expectedCount =
						cue.interlude === true
							? 1
							: Array.isArray(cue.segments)
								? cue.segments.length
								: 0;
					const total = cue.cutDurations.reduce(
						(sum, duration) => sum + duration,
						0,
					);
					if (
						cue.cutDurations.length !== expectedCount ||
						total !== cue.duration
					) {
						issue(issues, {
							code: "invalid-value",
							path: `${path}.cutDurations`,
							message:
								"Motion-text custom cut durations must exactly partition the cue",
						});
					}
				}
			}
			if (!isRecord(cue.overrides)) {
				issue(issues, {
					code: "invalid-value",
					path: `${path}.overrides`,
					message: "Motion-text cue overrides must be an object",
				});
			} else if (cue.overrides.parameters !== undefined) {
				validateParameterTree({
					value: cue.overrides.parameters,
					path: `${path}.overrides.parameters`,
					issues,
					state: { nodes: 0 },
				});
			}
		});
	}

	const fontIds = new Set<string>();
	if (!Array.isArray(value.fonts)) {
		issue(issues, {
			code: "invalid-value",
			path: "sequence.fonts",
			message: "Motion-text fonts must be an array",
		});
	} else {
		if (value.fonts.length > MOTION_TEXT_LIMITS.maxFonts) {
			issue(issues, {
				code: "resource-limit",
				path: "sequence.fonts",
				message: "Motion-text sequence exceeds its font limit",
			});
		}
		value.fonts.forEach((font, index) => {
			const path = `sequence.fonts[${index}]`;
			if (
				!isRecord(font) ||
				!validId(font.id) ||
				!["builtin", "project", "system"].includes(String(font.source)) ||
				typeof font.family !== "string" ||
				font.family.length === 0 ||
				!["normal", "italic"].includes(String(font.style)) ||
				!finitePositive(font.weight)
			) {
				issue(issues, {
					code: "invalid-value",
					path,
					message: "Motion-text font reference is invalid",
				});
				return;
			}
			if (fontIds.has(font.id)) {
				issue(issues, {
					code: "duplicate-id",
					path: `${path}.id`,
					message: `Duplicate motion-text font id ${font.id}`,
				});
			} else fontIds.add(font.id);
			if (
				font.supportedLanguages !== undefined &&
				(!Array.isArray(font.supportedLanguages) ||
					font.supportedLanguages.length === 0 ||
					!font.supportedLanguages.every(
						(language) =>
							typeof language === "string" &&
							/^[a-z]{2,3}(?:-[A-Z][a-z]{3})?(?:-[A-Z]{2}|-\d{3})?$/u.test(
								language,
							),
					) ||
					new Set(font.supportedLanguages).size !==
						font.supportedLanguages.length)
			) {
				issue(issues, {
					code: "invalid-value",
					path: `${path}.supportedLanguages`,
					message:
						"Motion-text font supported languages must be unique language tags",
				});
			}
			if (
				font.source === "builtin" &&
				font.builtinPath !== undefined &&
				!validBuiltinFontPath(font.builtinPath)
			) {
				issue(issues, {
					code: "invalid-value",
					path: `${path}.builtinPath`,
					message: "Builtin motion-text font paths must be logical TTF assets",
				});
			}
			if (
				font.source === "project" &&
				(!validId(font.assetId) ||
					typeof font.contentDigest !== "string" ||
					font.contentDigest.length === 0)
			) {
				issue(issues, {
					code: "invalid-value",
					path,
					message:
						"Project motion-text fonts require an asset and content digest",
				});
			}
		});
	}
	if (!isRecord(value.defaults)) {
		issue(issues, {
			code: "invalid-value",
			path: "sequence.defaults",
			message: "Motion-text defaults must be an object",
		});
	} else {
		validatePresetSelection({
			value: value.defaults.preset,
			path: "sequence.defaults.preset",
			issues,
			knownPresetIds: options.knownPresetIds,
		});
		if (
			value.defaults.fontId !== undefined &&
			(!validId(value.defaults.fontId) || !fontIds.has(value.defaults.fontId))
		) {
			issue(issues, {
				code: "missing-relation",
				path: "sequence.defaults.fontId",
				message: "Motion-text defaults reference a missing font",
			});
		}
		if (
			!isRecord(value.defaults.colors) ||
			!Object.values(value.defaults.colors).every(
				(color) => typeof color === "string",
			)
		) {
			issue(issues, {
				code: "invalid-value",
				path: "sequence.defaults.colors",
				message: "Motion-text default colors must be strings",
			});
		}
		if (!isRecord(value.defaults.parameters)) {
			issue(issues, {
				code: "invalid-value",
				path: "sequence.defaults.parameters",
				message: "Motion-text default parameters must be an object",
			});
		} else {
			validateParameterTree({
				value: value.defaults.parameters,
				path: "sequence.defaults.parameters",
				issues,
				state: { nodes: 0 },
			});
		}
	}

	if (value.resolvedPlan !== undefined) {
		const plan = value.resolvedPlan;
		if (!isRecord(plan) || plan.version !== MOTION_TEXT_PLAN_VERSION) {
			issue(issues, {
				code: "unsupported-version",
				path: "sequence.resolvedPlan.version",
				message: "Motion-text resolved plan version is unsupported",
			});
		} else if (!Array.isArray(plan.cuts)) {
			issue(issues, {
				code: "invalid-value",
				path: "sequence.resolvedPlan.cuts",
				message: "Motion-text resolved cuts must be an array",
			});
		} else {
			if (plan.sequenceRevision !== value.revision) {
				issue(issues, {
					code: "out-of-range",
					path: "sequence.resolvedPlan.sequenceRevision",
					message: "Resolved plan does not match the sequence revision",
				});
			}
			if (plan.cuts.length > MOTION_TEXT_LIMITS.maxCuts) {
				issue(issues, {
					code: "resource-limit",
					path: "sequence.resolvedPlan.cuts",
					message: "Motion-text resolved plan exceeds its cut limit",
				});
			}
			const cutIds = new Set<string>();
			plan.cuts.forEach((cut, index) => {
				const path = `sequence.resolvedPlan.cuts[${index}]`;
				if (!isRecord(cut)) {
					issue(issues, {
						code: "invalid-value",
						path,
						message: "Motion-text cut must be an object",
					});
					return;
				}
				if (!validId(cut.id) || cutIds.has(cut.id)) {
					issue(issues, {
						code: cutIds.has(String(cut.id)) ? "duplicate-id" : "invalid-id",
						path: `${path}.id`,
						message: "Motion-text cut id is invalid or duplicated",
					});
				} else cutIds.add(cut.id);
				if (!validId(cut.cueId) || !cueIds.has(cut.cueId)) {
					issue(issues, {
						code: "missing-relation",
						path: `${path}.cueId`,
						message: "Motion-text cut references a missing cue",
					});
				}
				if (
					!nonNegativeInteger(cut.startTime) ||
					!positiveInteger(cut.duration)
				) {
					issue(issues, {
						code: "invalid-value",
						path,
						message:
							"Motion-text cut requires non-negative time and positive duration",
					});
				}
				if (
					positiveInteger(value.duration) &&
					nonNegativeInteger(cut.startTime) &&
					positiveInteger(cut.duration) &&
					cut.startTime + cut.duration > value.duration
				) {
					issue(issues, {
						code: "out-of-range",
						path,
						message: "Motion-text cut exceeds the sequence duration",
					});
				}
				if (typeof cut.text !== "string") {
					issue(issues, {
						code: "invalid-value",
						path: `${path}.text`,
						message: "Motion-text cut text must be a string",
					});
				}
				if (!nonNegativeInteger(cut.seed) || cut.seed > 0xffff_ffff) {
					issue(issues, {
						code: "invalid-value",
						path: `${path}.seed`,
						message: "Motion-text cut seed must be an unsigned 32-bit integer",
					});
				}
				validatePresetSelection({
					value: cut.preset,
					path: `${path}.preset`,
					issues,
					knownPresetIds: options.knownPresetIds,
				});
				if (
					cut.fontId !== undefined &&
					(!validId(cut.fontId) || !fontIds.has(cut.fontId))
				) {
					issue(issues, {
						code: "missing-relation",
						path: `${path}.fontId`,
						message: "Motion-text cut references a missing font",
					});
				}
				if (!isRecord(cut.parameters)) {
					issue(issues, {
						code: "invalid-value",
						path: `${path}.parameters`,
						message: "Motion-text cut parameters must be an object",
					});
				} else {
					validateParameterTree({
						value: cut.parameters,
						path: `${path}.parameters`,
						issues,
						state: { nodes: 0 },
					});
				}
			});
		}
	}

	return issues;
}

export function isMotionTextSequence(
	value: unknown,
): value is MotionTextSequence {
	return validateMotionTextSequence({ value }).length === 0;
}
