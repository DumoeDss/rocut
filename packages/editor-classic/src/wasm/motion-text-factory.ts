import {
	DEFAULT_MOTION_TEXT_PLANNING_CONTROLS,
	isMotionTextSequence,
	type MotionTextPlanningControls,
	type MotionTextPresetGroup,
	type MotionTextSequence,
} from "@opencut/editor-contracts";
import * as wasm from "opencut-wasm";

export const MOTION_TEXT_STARTER_PRESET_IDS = [
	"clean-caption",
	"impact-title",
	"editorial-paper",
	"mono-marquee",
] as const;

export type MotionTextStarterPresetId =
	(typeof MOTION_TEXT_STARTER_PRESET_IDS)[number];

export interface MotionTextRendererSupportEntry {
	readonly group: MotionTextPresetGroup;
	readonly id: string;
}

export interface MotionTextSequenceBuildDiagnostic {
	readonly severity: "warning" | "error";
	readonly code: string;
	readonly message: string;
	readonly sourceLine: number | null;
	readonly cueId: string | null;
}

export interface CreatedMotionTextSequence {
	readonly sequence: MotionTextSequence | null;
	readonly diagnostics: readonly MotionTextSequenceBuildDiagnostic[];
}

export type JizuraImportStatus =
	| "imported"
	| "imported-with-warnings"
	| "rejected";

export type JizuraCompatibilityStatus =
	| "preserved"
	| "approximated"
	| "unsupported"
	| "ignored";

export interface JizuraCompatibilityItem {
	readonly path: string;
	readonly status: JizuraCompatibilityStatus;
	readonly code: string;
	readonly message: string;
}

export interface JizuraCompatibilityReport {
	readonly status: JizuraImportStatus;
	readonly sourceVersion: number | null;
	readonly sourceAppVersion: string | null;
	readonly items: readonly JizuraCompatibilityItem[];
}

export type JizuraImportResourceKind = "audio" | "font" | "language-font-pack";

export interface JizuraImportResource {
	readonly kind: JizuraImportResourceKind;
	readonly id: string;
	readonly path: string;
	readonly status: "available" | "missing";
	readonly requiredForFidelity: boolean;
	readonly message: string;
}

export interface ImportedJizuraMotionTextProject extends CreatedMotionTextSequence {
	readonly resourcesNeeded: readonly JizuraImportResource[];
	readonly compatibilityReport: JizuraCompatibilityReport;
}

export interface MotionTextVariationCandidate {
	readonly sequence: MotionTextSequence | null;
	readonly baseRevision: number | null;
	readonly candidateRevision: number | null;
	readonly salt: number;
	readonly diagnostics: readonly MotionTextSequenceBuildDiagnostic[];
}

export type CreateMotionTextSequenceCore = (options: {
	readonly sequenceId: string;
	readonly source: string;
	readonly sourceFormat: "plain" | "lrc" | "jizura";
	readonly language: string;
	readonly duration: number;
	readonly seed: number | undefined;
	readonly starterPreset: MotionTextStarterPresetId;
	readonly rendererSupport: readonly MotionTextRendererSupportEntry[];
}) => unknown;

export type CreateMotionTextPresetPreviewCore = (options: {
	readonly sequenceId: string;
	readonly previewText: string;
	readonly language: string;
	readonly duration: number;
	readonly seed: number | undefined;
	readonly presetGroup: MotionTextPresetGroup;
	readonly presetId: string;
	readonly rendererSupport: readonly MotionTextRendererSupportEntry[];
}) => unknown;

export type ImportJizuraMotionTextProjectCore = (options: {
	readonly sequenceId: string;
	readonly projectJson: string;
	readonly rendererSupport: readonly MotionTextRendererSupportEntry[];
}) => unknown;

export type RestyleMotionTextSequenceCore = (options: {
	readonly sequenceJson: string;
	readonly starterPreset: MotionTextStarterPresetId;
	readonly rendererSupport: readonly MotionTextRendererSupportEntry[];
}) => unknown;

export type MutateMotionTextSequenceCore = (options: {
	readonly sequenceJson: string;
	readonly mutationJson: string;
	readonly rendererSupport: readonly MotionTextRendererSupportEntry[];
}) => unknown;

export type CreateMotionTextVariationCandidateCore = (options: {
	readonly sequenceJson: string;
	readonly salt: number;
	readonly cueIds: readonly string[];
	readonly groups: readonly MotionTextPresetGroup[];
	readonly rendererSupport: readonly MotionTextRendererSupportEntry[];
}) => unknown;

export type MotionTextFontMutation =
	| { readonly mode: "keep" }
	| { readonly mode: "inherit" }
	| { readonly mode: "set"; readonly fontId: string };

export type MotionTextColorMutation =
	| { readonly mode: "keep" }
	| { readonly mode: "inherit" }
	| {
			readonly mode: "set";
			readonly foreground: string;
			readonly accent: string;
	  };

export type MotionTextCuePresetMutation =
	| { readonly mode: "keep" }
	| { readonly mode: "inherit" }
	| {
			readonly mode: "starter";
			readonly starterPreset: MotionTextStarterPresetId;
	  };

export type MotionTextSequenceMutation =
	| {
			readonly kind: "update-planning-controls";
			readonly controls: MotionTextPlanningControls;
	  }
	| {
			readonly kind: "update-defaults";
			readonly font: MotionTextFontMutation;
			readonly colors: MotionTextColorMutation;
	  }
	| {
			readonly kind: "set-cut-boundary";
			readonly cutId: string;
			readonly endTime: number;
	  }
	| {
			readonly kind: "set-cue-lock";
			readonly cueId: string;
			readonly scope: "cue" | "cut" | "preset-group" | "parameter";
			readonly key: string;
			readonly locked: boolean;
	  }
	| {
			readonly kind: "update-cue";
			readonly cueId: string;
			readonly text: string;
			readonly startTime: number;
			readonly duration: number;
			readonly preset: MotionTextCuePresetMutation;
			readonly font: MotionTextFontMutation;
			readonly colors: MotionTextColorMutation;
	  }
	| {
			readonly kind: "apply-cue-taps";
			readonly startCueId: string;
			readonly tapTimes: readonly number[];
	  }
	| {
			readonly kind: "set-audio-binding";
			readonly assetId: string;
			readonly clipId: string | null;
			readonly sourceOffset: number;
			readonly duration: number | null;
			readonly contentDigest: string;
			readonly analysis: {
				readonly version: number;
				readonly contentDigest: string;
				readonly bpm: number | null;
				readonly firstBeat: number | null;
			} | null;
	  }
	| {
			readonly kind: "sync-audio-timing";
			readonly assetId: string;
			readonly clipId: string | null;
			readonly sourceOffset: number;
			readonly duration: number | null;
			readonly contentDigest: string;
			readonly analysis: {
				readonly version: number;
				readonly contentDigest: string;
				readonly bpm: number | null;
				readonly firstBeat: number | null;
			} | null;
	  }
	| {
			readonly kind: "set-audio-beat-override";
			readonly bpm: number | null;
			readonly firstBeat: number | null;
	  }
	| {
			readonly kind: "clear-audio-binding";
	  };

function isMotionTextStarterPresetId(
	value: string,
): value is MotionTextStarterPresetId {
	return MOTION_TEXT_STARTER_PRESET_IDS.some(
		(starterPresetId) => starterPresetId === value,
	);
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function decodeNullableString({
	value,
	field,
}: {
	value: unknown;
	field: string;
}): string | null {
	if (value === null) return null;
	if (typeof value === "string") return value;
	throw new TypeError(
		`Motion-text sequence factory returned an invalid ${field}.`,
	);
}

function decodeNullableLine(value: unknown): number | null {
	if (value === null) return null;
	if (typeof value === "number" && Number.isInteger(value) && value > 0) {
		return value;
	}
	throw new TypeError(
		"Motion-text sequence factory returned an invalid source line.",
	);
}

function decodeNullableRevision({
	value,
	field,
}: {
	value: unknown;
	field: string;
}): number | null {
	if (value === null) return null;
	if (
		typeof value === "number" &&
		Number.isInteger(value) &&
		value >= 0 &&
		value <= 0xffff_ffff
	) {
		return value;
	}
	throw new TypeError(
		`Motion-text variation factory returned an invalid ${field}.`,
	);
}

function decodeNullableUnsignedInteger({
	value,
	field,
}: {
	value: unknown;
	field: string;
}): number | null {
	if (value === null) return null;
	if (
		typeof value === "number" &&
		Number.isInteger(value) &&
		value >= 0 &&
		value <= 0xffff_ffff
	) {
		return value;
	}
	throw new TypeError(`JIZURA importer returned an invalid ${field}.`);
}

function decodeDiagnostics(
	value: unknown,
): MotionTextSequenceBuildDiagnostic[] {
	if (!Array.isArray(value)) {
		throw new TypeError(
			"Motion-text sequence factory returned invalid diagnostics.",
		);
	}
	return value.map((entry) => {
		if (
			!isRecord(entry) ||
			(entry.severity !== "warning" && entry.severity !== "error") ||
			typeof entry.code !== "string" ||
			typeof entry.message !== "string"
		) {
			throw new TypeError(
				"Motion-text sequence factory returned an invalid diagnostic.",
			);
		}
		return {
			severity: entry.severity,
			code: entry.code,
			message: entry.message,
			sourceLine: decodeNullableLine(entry.sourceLine),
			cueId: decodeNullableString({
				value: entry.cueId,
				field: "diagnostic cue id",
			}),
		};
	});
}

function decodeSequenceBuildResult(raw: unknown): CreatedMotionTextSequence {
	if (!isRecord(raw)) {
		throw new TypeError(
			"Motion-text sequence factory returned a non-object result.",
		);
	}
	const diagnostics = decodeDiagnostics(raw.diagnostics);
	if (raw.sequenceJson === null) {
		return { sequence: null, diagnostics };
	}
	if (typeof raw.sequenceJson !== "string") {
		throw new TypeError(
			"Motion-text sequence factory returned an invalid sequence payload.",
		);
	}
	const parsed: unknown = JSON.parse(raw.sequenceJson);
	if (!isMotionTextSequence(parsed)) {
		throw new TypeError(
			"Motion-text sequence factory returned a sequence outside the editor contract.",
		);
	}
	return { sequence: parsed, diagnostics };
}

function decodeJizuraCompatibilityReport(
	value: unknown,
): JizuraCompatibilityReport {
	if (
		!isRecord(value) ||
		(value.status !== "imported" &&
			value.status !== "imported-with-warnings" &&
			value.status !== "rejected") ||
		!Array.isArray(value.items)
	) {
		throw new TypeError(
			"JIZURA importer returned an invalid compatibility report.",
		);
	}
	const items = value.items.map((entry): JizuraCompatibilityItem => {
		if (
			!isRecord(entry) ||
			typeof entry.path !== "string" ||
			(entry.status !== "preserved" &&
				entry.status !== "approximated" &&
				entry.status !== "unsupported" &&
				entry.status !== "ignored") ||
			typeof entry.code !== "string" ||
			typeof entry.message !== "string"
		) {
			throw new TypeError(
				"JIZURA importer returned an invalid compatibility item.",
			);
		}
		return {
			path: entry.path,
			status: entry.status,
			code: entry.code,
			message: entry.message,
		};
	});
	return {
		status: value.status,
		sourceVersion: decodeNullableUnsignedInteger({
			value: value.sourceVersion,
			field: "source version",
		}),
		sourceAppVersion: decodeNullableString({
			value: value.sourceAppVersion,
			field: "source app version",
		}),
		items,
	};
}

function decodeJizuraResources(value: unknown): JizuraImportResource[] {
	if (!Array.isArray(value)) {
		throw new TypeError("JIZURA importer returned invalid resource needs.");
	}
	return value.map((entry): JizuraImportResource => {
		if (
			!isRecord(entry) ||
			(entry.kind !== "audio" &&
				entry.kind !== "font" &&
				entry.kind !== "language-font-pack") ||
			typeof entry.id !== "string" ||
			typeof entry.path !== "string" ||
			(entry.status !== "available" && entry.status !== "missing") ||
			typeof entry.requiredForFidelity !== "boolean" ||
			typeof entry.message !== "string"
		) {
			throw new TypeError("JIZURA importer returned an invalid resource need.");
		}
		return {
			kind: entry.kind,
			id: entry.id,
			path: entry.path,
			status: entry.status,
			requiredForFidelity: entry.requiredForFidelity,
			message: entry.message,
		};
	});
}

function decodeJizuraImportResult(
	raw: unknown,
): ImportedJizuraMotionTextProject {
	if (!isRecord(raw)) {
		throw new TypeError("JIZURA importer returned a non-object result.");
	}
	const created = decodeSequenceBuildResult(raw);
	const compatibilityReport = decodeJizuraCompatibilityReport(
		raw.compatibilityReport,
	);
	if (
		(created.sequence === null) !==
		(compatibilityReport.status === "rejected")
	) {
		throw new TypeError(
			"JIZURA importer returned an inconsistent import status.",
		);
	}
	return {
		...created,
		resourcesNeeded: decodeJizuraResources(raw.resourcesNeeded),
		compatibilityReport,
	};
}

function decodeVariationCandidateResult({
	raw,
	baseSequence,
	requestedSalt,
}: {
	raw: unknown;
	baseSequence: MotionTextSequence;
	requestedSalt: number;
}): MotionTextVariationCandidate {
	if (!isRecord(raw)) {
		throw new TypeError(
			"Motion-text variation factory returned a non-object result.",
		);
	}
	const diagnostics = decodeDiagnostics(raw.diagnostics);
	const baseRevision = decodeNullableRevision({
		value: raw.baseRevision,
		field: "base revision",
	});
	const candidateRevision = decodeNullableRevision({
		value: raw.candidateRevision,
		field: "candidate revision",
	});
	if (
		typeof raw.salt !== "number" ||
		!Number.isInteger(raw.salt) ||
		raw.salt < 0 ||
		raw.salt > 0xffff_ffff ||
		raw.salt !== requestedSalt
	) {
		throw new TypeError(
			"Motion-text variation factory returned an invalid salt.",
		);
	}
	if (raw.sequenceJson === null) {
		if (candidateRevision !== null) {
			throw new TypeError(
				"Motion-text variation factory returned a revision without a candidate.",
			);
		}
		return {
			sequence: null,
			baseRevision,
			candidateRevision,
			salt: raw.salt,
			diagnostics,
		};
	}
	if (typeof raw.sequenceJson !== "string") {
		throw new TypeError(
			"Motion-text variation factory returned an invalid sequence payload.",
		);
	}
	const parsed: unknown = JSON.parse(raw.sequenceJson);
	if (!isMotionTextSequence(parsed)) {
		throw new TypeError(
			"Motion-text variation factory returned a sequence outside the editor contract.",
		);
	}
	if (
		baseRevision !== baseSequence.revision ||
		candidateRevision !== baseSequence.revision + 1 ||
		parsed.revision !== candidateRevision ||
		parsed.id !== baseSequence.id
	) {
		throw new TypeError(
			"Motion-text variation factory returned inconsistent candidate revisions.",
		);
	}
	return {
		sequence: parsed,
		baseRevision,
		candidateRevision,
		salt: raw.salt,
		diagnostics,
	};
}

export function createStarterMotionTextSequence({
	sequenceId,
	source,
	sourceFormat = "plain",
	language = "zh-Hans",
	duration,
	seed,
	starterPreset,
	rendererSupport,
	core,
}: {
	readonly sequenceId: string;
	readonly source: string;
	readonly sourceFormat?: "plain" | "lrc" | "jizura";
	readonly language?: string;
	readonly duration: number;
	readonly seed?: number;
	readonly starterPreset: MotionTextStarterPresetId;
	readonly rendererSupport: readonly MotionTextRendererSupportEntry[];
	readonly core?: CreateMotionTextSequenceCore;
}): CreatedMotionTextSequence {
	const candidate: unknown =
		core ?? Reflect.get(wasm, "createMotionTextSequence");
	if (typeof candidate !== "function") {
		throw new Error(
			"The installed opencut-wasm binary does not expose createMotionTextSequence.",
		);
	}
	return decodeSequenceBuildResult(
		candidate({
			sequenceId,
			source,
			sourceFormat,
			language,
			duration,
			seed,
			starterPreset,
			rendererSupport,
		}),
	);
}

export function createMotionTextPresetPreview({
	sequenceId,
	previewText,
	language = "en",
	duration,
	seed,
	presetGroup,
	presetId,
	rendererSupport,
	core,
}: {
	readonly sequenceId: string;
	readonly previewText: string;
	readonly language?: string;
	readonly duration: number;
	readonly seed?: number;
	readonly presetGroup: MotionTextPresetGroup;
	readonly presetId: string;
	readonly rendererSupport: readonly MotionTextRendererSupportEntry[];
	readonly core?: CreateMotionTextPresetPreviewCore;
}): CreatedMotionTextSequence {
	const candidate: unknown =
		core ?? Reflect.get(wasm, "createMotionTextPresetPreview");
	if (typeof candidate !== "function") {
		throw new Error(
			"The installed opencut-wasm binary does not expose createMotionTextPresetPreview.",
		);
	}
	return decodeSequenceBuildResult(
		candidate({
			sequenceId,
			previewText,
			language,
			duration,
			seed,
			presetGroup,
			presetId,
			rendererSupport,
		}),
	);
}

export function importJizuraMotionTextProject({
	sequenceId,
	projectJson,
	rendererSupport,
	core,
}: {
	readonly sequenceId: string;
	readonly projectJson: string;
	readonly rendererSupport: readonly MotionTextRendererSupportEntry[];
	readonly core?: ImportJizuraMotionTextProjectCore;
}): ImportedJizuraMotionTextProject {
	const candidate: unknown =
		core ?? Reflect.get(wasm, "importJizuraMotionTextProject");
	if (typeof candidate !== "function") {
		throw new Error(
			"The installed opencut-wasm binary does not expose importJizuraMotionTextProject.",
		);
	}
	return decodeJizuraImportResult(
		candidate({
			sequenceId,
			projectJson,
			rendererSupport,
		}),
	);
}

export function restyleStarterMotionTextSequence({
	sequence,
	starterPreset,
	rendererSupport,
	core,
}: {
	readonly sequence: MotionTextSequence;
	readonly starterPreset: MotionTextStarterPresetId;
	readonly rendererSupport: readonly MotionTextRendererSupportEntry[];
	readonly core?: RestyleMotionTextSequenceCore;
}): CreatedMotionTextSequence {
	const candidate: unknown =
		core ?? Reflect.get(wasm, "restyleMotionTextSequence");
	if (typeof candidate !== "function") {
		throw new Error(
			"The installed opencut-wasm binary does not expose restyleMotionTextSequence.",
		);
	}
	return decodeSequenceBuildResult(
		candidate({
			sequenceJson: JSON.stringify(sequence),
			starterPreset,
			rendererSupport,
		}),
	);
}

export function mutateMotionTextSequence({
	sequence,
	mutation,
	rendererSupport,
	core,
}: {
	readonly sequence: MotionTextSequence;
	readonly mutation: MotionTextSequenceMutation;
	readonly rendererSupport: readonly MotionTextRendererSupportEntry[];
	readonly core?: MutateMotionTextSequenceCore;
}): CreatedMotionTextSequence {
	const candidate: unknown =
		core ?? Reflect.get(wasm, "mutateMotionTextSequence");
	if (typeof candidate !== "function") {
		throw new Error(
			"The installed opencut-wasm binary does not expose mutateMotionTextSequence.",
		);
	}
	return decodeSequenceBuildResult(
		candidate({
			sequenceJson: JSON.stringify(sequence),
			mutationJson: JSON.stringify(mutation),
			rendererSupport,
		}),
	);
}

export function createMotionTextVariationCandidate({
	sequence,
	salt,
	cueIds = [],
	groups,
	rendererSupport,
	core,
}: {
	readonly sequence: MotionTextSequence;
	readonly salt: number;
	readonly cueIds?: readonly string[];
	readonly groups: readonly MotionTextPresetGroup[];
	readonly rendererSupport: readonly MotionTextRendererSupportEntry[];
	readonly core?: CreateMotionTextVariationCandidateCore;
}): MotionTextVariationCandidate {
	if (!Number.isInteger(salt) || salt < 0 || salt > 0xffff_ffff) {
		throw new TypeError(
			"Motion-text variation salt must be an unsigned integer.",
		);
	}
	const candidate: unknown =
		core ?? Reflect.get(wasm, "createMotionTextVariationCandidate");
	if (typeof candidate !== "function") {
		throw new Error(
			"The installed opencut-wasm binary does not expose createMotionTextVariationCandidate.",
		);
	}
	return decodeVariationCandidateResult({
		raw: candidate({
			sequenceJson: JSON.stringify(sequence),
			salt,
			cueIds,
			groups,
			rendererSupport,
		}),
		baseSequence: sequence,
		requestedSalt: salt,
	});
}

export function getMotionTextStarterPresetId(
	sequence: MotionTextSequence,
): MotionTextStarterPresetId | null {
	const value = sequence.defaults.parameters["rocut.starterPreset"];
	return typeof value === "string" && isMotionTextStarterPresetId(value)
		? value
		: null;
}

export function getMotionTextPlanningControls(
	sequence: MotionTextSequence,
): MotionTextPlanningControls {
	return sequence.planningControls ?? DEFAULT_MOTION_TEXT_PLANNING_CONTROLS;
}
