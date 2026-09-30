import * as wasm from "opencut-wasm";

export const MOTION_TEXT_AUDIO_ANALYSIS_VERSION = 1 as const;

export interface MotionTextAudioDiagnostic {
	readonly severity: "warning" | "error";
	readonly code: string;
	readonly message: string;
}

export interface MotionTextAudioAnalysis {
	readonly version: typeof MOTION_TEXT_AUDIO_ANALYSIS_VERSION;
	readonly sampleRate: number;
	readonly sampleCount: number;
	readonly duration: number;
	readonly energyHopSamples: number;
	readonly energy: readonly number[];
	readonly bpm: number | null;
	readonly firstBeat: number | null;
	readonly beats: readonly number[];
	readonly confidence: number;
}

export interface MotionTextAudioAnalysisResult {
	readonly analysis: MotionTextAudioAnalysis | null;
	readonly diagnostics: readonly MotionTextAudioDiagnostic[];
}

export type MotionTextBeatValueSource =
	| "detected"
	| "manual"
	| "default"
	| "unavailable";

export interface MotionTextBeatGrid {
	readonly bpm: number | null;
	readonly firstBeat: number | null;
	readonly bpmSource: MotionTextBeatValueSource;
	readonly firstBeatSource: MotionTextBeatValueSource;
	readonly beats: readonly number[];
}

export interface MotionTextBeatGridResult {
	readonly grid: MotionTextBeatGrid | null;
	readonly diagnostics: readonly MotionTextAudioDiagnostic[];
}

export interface MotionTextBeatSnapResult {
	readonly time: number;
	readonly snapped: boolean;
	readonly beatIndex: number | null;
	readonly error: string | null;
}

export interface MotionTextAudioClipBindingResult {
	readonly sourceOffset: number | null;
	readonly duration: number | null;
	readonly errorCode: string | null;
	readonly error: string | null;
}

export type MotionTextAudioSyncStatus =
	| "synchronized"
	| "unchecked"
	| "missing-asset"
	| "missing-clip"
	| "asset-changed"
	| "content-changed"
	| "timing-changed";

export interface MotionTextAudioSyncAssessment {
	readonly status: MotionTextAudioSyncStatus;
	readonly requiresSync: boolean;
	readonly analysisReusable: boolean;
}

export type AnalyzeMotionTextAudioCore = (options: {
	readonly pcmF32le: Uint8Array;
	readonly sampleRate: number;
}) => unknown;

export type ResolveMotionTextBeatGridCore = (options: {
	readonly duration: number;
	readonly detectedBpm: number | null;
	readonly detectedFirstBeat: number | null;
	readonly sourceOffset: number | null;
	readonly bpmOverride: number | null;
	readonly firstBeatOverride: number | null;
}) => unknown;

export type SnapMotionTextTimeToBeatCore = (options: {
	readonly time: number;
	readonly bpm: number;
	readonly firstBeat: number;
	readonly maxDistance: number | null;
}) => unknown;

export type ResolveMotionTextAudioClipBindingCore = (options: {
	readonly sequenceDuration: number;
	readonly sequenceClipStart: number;
	readonly sequenceTrimStart: number;
	readonly sequenceClipDuration: number;
	readonly audioClipStart: number;
	readonly audioClipDuration: number;
	readonly audioTrimStart: number;
	readonly audioSourceDuration: number;
}) => unknown;

export type AssessMotionTextAudioSyncCore = (options: {
	readonly boundAssetId: string;
	readonly boundClipId: string | null;
	readonly boundSourceOffset: number;
	readonly boundDuration: number | null;
	readonly boundContentDigest: string | null;
	readonly currentAssetId: string | null;
	readonly currentClipId: string | null;
	readonly currentSourceOffset: number | null;
	readonly currentDuration: number | null;
	readonly currentContentDigest: string | null;
}) => unknown;

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isNonNegativeInteger(value: unknown): value is number {
	return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isFinitePositive(value: unknown): value is number {
	return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function decodeNullableNumber({
	value,
	field,
	positive = false,
}: {
	readonly value: unknown;
	readonly field: string;
	readonly positive?: boolean;
}): number | null {
	if (value === null) return null;
	if (
		typeof value === "number" &&
		Number.isFinite(value) &&
		(!positive || value > 0)
	) {
		return value;
	}
	throw new TypeError(`Motion-text audio returned an invalid ${field}.`);
}

function decodeNullableTime({
	value,
	field,
}: {
	readonly value: unknown;
	readonly field: string;
}): number | null {
	if (value === null) return null;
	if (isNonNegativeInteger(value)) return value;
	throw new TypeError(`Motion-text audio returned an invalid ${field}.`);
}

function decodeDiagnostics(value: unknown): MotionTextAudioDiagnostic[] {
	if (!Array.isArray(value)) {
		throw new TypeError("Motion-text audio returned invalid diagnostics.");
	}
	return value.map((entry) => {
		if (
			!isRecord(entry) ||
			(entry.severity !== "warning" && entry.severity !== "error") ||
			typeof entry.code !== "string" ||
			typeof entry.message !== "string"
		) {
			throw new TypeError("Motion-text audio returned an invalid diagnostic.");
		}
		return {
			severity: entry.severity,
			code: entry.code,
			message: entry.message,
		};
	});
}

function decodeTimes({
	value,
	field,
}: {
	readonly value: unknown;
	readonly field: string;
}): number[] {
	if (!Array.isArray(value) || !value.every(isNonNegativeInteger)) {
		throw new TypeError(`Motion-text audio returned invalid ${field}.`);
	}
	if (value.some((time, index) => index > 0 && time <= value[index - 1]!)) {
		throw new TypeError(`Motion-text audio returned unordered ${field}.`);
	}
	return value;
}

function decodeAnalysis(value: unknown): MotionTextAudioAnalysis | null {
	if (value === null) return null;
	if (
		!isRecord(value) ||
		value.version !== MOTION_TEXT_AUDIO_ANALYSIS_VERSION ||
		!isFinitePositive(value.sampleRate) ||
		!isNonNegativeInteger(value.sampleCount) ||
		!isNonNegativeInteger(value.duration) ||
		!isFinitePositive(value.energyHopSamples) ||
		!Array.isArray(value.energy) ||
		!value.energy.every(
			(entry) =>
				typeof entry === "number" &&
				Number.isFinite(entry) &&
				entry >= 0 &&
				entry <= 1,
		) ||
		typeof value.confidence !== "number" ||
		!Number.isFinite(value.confidence) ||
		value.confidence < 0 ||
		value.confidence > 1
	) {
		throw new TypeError("Motion-text audio returned an invalid analysis.");
	}
	const bpm = decodeNullableNumber({
		value: value.bpm,
		field: "analysis BPM",
		positive: true,
	});
	const firstBeat = decodeNullableTime({
		value: value.firstBeat,
		field: "analysis first beat",
	});
	if ((bpm === null) !== (firstBeat === null)) {
		throw new TypeError(
			"Motion-text audio returned incomplete tempo metadata.",
		);
	}
	return {
		version: MOTION_TEXT_AUDIO_ANALYSIS_VERSION,
		sampleRate: value.sampleRate,
		sampleCount: value.sampleCount,
		duration: value.duration,
		energyHopSamples: value.energyHopSamples,
		energy: value.energy,
		bpm,
		firstBeat,
		beats: decodeTimes({ value: value.beats, field: "analysis beats" }),
		confidence: value.confidence,
	};
}

function decodeAnalysisResult(value: unknown): MotionTextAudioAnalysisResult {
	if (!isRecord(value)) {
		throw new TypeError("Motion-text audio returned a non-object result.");
	}
	return {
		analysis: decodeAnalysis(value.analysis),
		diagnostics: decodeDiagnostics(value.diagnostics),
	};
}

function float32LittleEndianBytes(samples: Float32Array): Uint8Array {
	const endianProbe = new Uint8Array(new Uint32Array([0x01020304]).buffer)[0];
	if (endianProbe === 0x04) {
		return new Uint8Array(
			samples.buffer,
			samples.byteOffset,
			samples.byteLength,
		);
	}
	const bytes = new Uint8Array(samples.byteLength);
	const view = new DataView(bytes.buffer);
	for (let index = 0; index < samples.length; index++) {
		view.setFloat32(
			index * Float32Array.BYTES_PER_ELEMENT,
			samples[index]!,
			true,
		);
	}
	return bytes;
}

export function analyzeMotionTextAudio({
	samples,
	sampleRate,
	core,
}: {
	readonly samples: Float32Array;
	readonly sampleRate: number;
	readonly core?: AnalyzeMotionTextAudioCore;
}): MotionTextAudioAnalysisResult {
	const candidate: unknown =
		core ?? Reflect.get(wasm, "analyzeMotionTextAudio");
	if (typeof candidate !== "function") {
		throw new Error(
			"The installed opencut-wasm binary does not expose analyzeMotionTextAudio.",
		);
	}
	return decodeAnalysisResult(
		candidate({
			pcmF32le: float32LittleEndianBytes(samples),
			sampleRate,
		}),
	);
}

function isBeatValueSource(value: unknown): value is MotionTextBeatValueSource {
	return (
		value === "detected" ||
		value === "manual" ||
		value === "default" ||
		value === "unavailable"
	);
}

function decodeBeatGrid(value: unknown): MotionTextBeatGrid | null {
	if (value === null) return null;
	if (
		!isRecord(value) ||
		!isBeatValueSource(value.bpmSource) ||
		!isBeatValueSource(value.firstBeatSource)
	) {
		throw new TypeError("Motion-text audio returned an invalid beat grid.");
	}
	return {
		bpm: decodeNullableNumber({
			value: value.bpm,
			field: "beat-grid BPM",
			positive: true,
		}),
		firstBeat: decodeNullableTime({
			value: value.firstBeat,
			field: "beat-grid first beat",
		}),
		bpmSource: value.bpmSource,
		firstBeatSource: value.firstBeatSource,
		beats: decodeTimes({ value: value.beats, field: "beat-grid beats" }),
	};
}

export function resolveMotionTextBeatGrid({
	duration,
	detectedBpm = null,
	detectedFirstBeat = null,
	sourceOffset = null,
	bpmOverride = null,
	firstBeatOverride = null,
	core,
}: {
	readonly duration: number;
	readonly detectedBpm?: number | null;
	readonly detectedFirstBeat?: number | null;
	readonly sourceOffset?: number | null;
	readonly bpmOverride?: number | null;
	readonly firstBeatOverride?: number | null;
	readonly core?: ResolveMotionTextBeatGridCore;
}): MotionTextBeatGridResult {
	const candidate: unknown =
		core ?? Reflect.get(wasm, "resolveMotionTextBeatGrid");
	if (typeof candidate !== "function") {
		throw new Error(
			"The installed opencut-wasm binary does not expose resolveMotionTextBeatGrid.",
		);
	}
	const raw: unknown = candidate({
		duration,
		detectedBpm,
		detectedFirstBeat,
		sourceOffset,
		bpmOverride,
		firstBeatOverride,
	});
	if (!isRecord(raw)) {
		throw new TypeError("Motion-text audio returned a non-object grid result.");
	}
	return {
		grid: decodeBeatGrid(raw.grid),
		diagnostics: decodeDiagnostics(raw.diagnostics),
	};
}

export function snapMotionTextTimeToBeat({
	time,
	bpm,
	firstBeat,
	maxDistance = null,
	core,
}: {
	readonly time: number;
	readonly bpm: number;
	readonly firstBeat: number;
	readonly maxDistance?: number | null;
	readonly core?: SnapMotionTextTimeToBeatCore;
}): MotionTextBeatSnapResult {
	const candidate: unknown =
		core ?? Reflect.get(wasm, "snapMotionTextTimeToBeat");
	if (typeof candidate !== "function") {
		throw new Error(
			"The installed opencut-wasm binary does not expose snapMotionTextTimeToBeat.",
		);
	}
	const raw: unknown = candidate({ time, bpm, firstBeat, maxDistance });
	if (
		!isRecord(raw) ||
		!isNonNegativeInteger(raw.time) ||
		typeof raw.snapped !== "boolean" ||
		(raw.beatIndex !== null && !isNonNegativeInteger(raw.beatIndex)) ||
		(raw.error !== null && typeof raw.error !== "string")
	) {
		throw new TypeError("Motion-text audio returned an invalid snap result.");
	}
	return {
		time: raw.time,
		snapped: raw.snapped,
		beatIndex: raw.beatIndex,
		error: raw.error,
	};
}

function decodeNullableString({
	value,
	field,
}: {
	readonly value: unknown;
	readonly field: string;
}): string | null {
	if (value === null) return null;
	if (typeof value === "string") return value;
	throw new TypeError(`Motion-text audio returned an invalid ${field}.`);
}

export function resolveMotionTextAudioClipBinding({
	sequenceDuration,
	sequenceClipStart,
	sequenceTrimStart,
	sequenceClipDuration,
	audioClipStart,
	audioClipDuration,
	audioTrimStart,
	audioSourceDuration,
	core,
}: {
	readonly sequenceDuration: number;
	readonly sequenceClipStart: number;
	readonly sequenceTrimStart: number;
	readonly sequenceClipDuration: number;
	readonly audioClipStart: number;
	readonly audioClipDuration: number;
	readonly audioTrimStart: number;
	readonly audioSourceDuration: number;
	readonly core?: ResolveMotionTextAudioClipBindingCore;
}): MotionTextAudioClipBindingResult {
	const candidate: unknown =
		core ?? Reflect.get(wasm, "resolveMotionTextAudioClipBinding");
	if (typeof candidate !== "function") {
		throw new Error(
			"The installed opencut-wasm binary does not expose resolveMotionTextAudioClipBinding.",
		);
	}
	const raw: unknown = candidate({
		sequenceDuration,
		sequenceClipStart,
		sequenceTrimStart,
		sequenceClipDuration,
		audioClipStart,
		audioClipDuration,
		audioTrimStart,
		audioSourceDuration,
	});
	if (!isRecord(raw)) {
		throw new TypeError(
			"Motion-text audio returned a non-object clip-binding result.",
		);
	}
	const sourceOffset = decodeNullableTime({
		value: raw.sourceOffset,
		field: "clip-binding source offset",
	});
	const duration = decodeNullableTime({
		value: raw.duration,
		field: "clip-binding duration",
	});
	const errorCode = decodeNullableString({
		value: raw.errorCode,
		field: "clip-binding error code",
	});
	const error = decodeNullableString({
		value: raw.error,
		field: "clip-binding error",
	});
	const succeeded = sourceOffset !== null && duration !== null;
	if (
		(succeeded && (errorCode !== null || error !== null || duration <= 0)) ||
		(!succeeded &&
			(sourceOffset !== null ||
				duration !== null ||
				errorCode === null ||
				error === null))
	) {
		throw new TypeError(
			"Motion-text audio returned an inconsistent clip-binding result.",
		);
	}
	return { sourceOffset, duration, errorCode, error };
}

function isAudioSyncStatus(value: unknown): value is MotionTextAudioSyncStatus {
	return (
		value === "synchronized" ||
		value === "unchecked" ||
		value === "missing-asset" ||
		value === "missing-clip" ||
		value === "asset-changed" ||
		value === "content-changed" ||
		value === "timing-changed"
	);
}

export function assessMotionTextAudioSync({
	boundAssetId,
	boundClipId = null,
	boundSourceOffset,
	boundDuration = null,
	boundContentDigest = null,
	currentAssetId = null,
	currentClipId = null,
	currentSourceOffset = null,
	currentDuration = null,
	currentContentDigest = null,
	core,
}: {
	readonly boundAssetId: string;
	readonly boundClipId?: string | null;
	readonly boundSourceOffset: number;
	readonly boundDuration?: number | null;
	readonly boundContentDigest?: string | null;
	readonly currentAssetId?: string | null;
	readonly currentClipId?: string | null;
	readonly currentSourceOffset?: number | null;
	readonly currentDuration?: number | null;
	readonly currentContentDigest?: string | null;
	readonly core?: AssessMotionTextAudioSyncCore;
}): MotionTextAudioSyncAssessment {
	const candidate: unknown =
		core ?? Reflect.get(wasm, "assessMotionTextAudioSync");
	if (typeof candidate !== "function") {
		throw new Error(
			"The installed opencut-wasm binary does not expose assessMotionTextAudioSync.",
		);
	}
	const raw: unknown = candidate({
		boundAssetId,
		boundClipId,
		boundSourceOffset,
		boundDuration,
		boundContentDigest,
		currentAssetId,
		currentClipId,
		currentSourceOffset,
		currentDuration,
		currentContentDigest,
	});
	if (
		!isRecord(raw) ||
		!isAudioSyncStatus(raw.status) ||
		typeof raw.requiresSync !== "boolean" ||
		typeof raw.analysisReusable !== "boolean" ||
		raw.requiresSync ===
			(raw.status === "synchronized" || raw.status === "unchecked") ||
		(raw.analysisReusable &&
			raw.status !== "synchronized" &&
			raw.status !== "timing-changed")
	) {
		throw new TypeError(
			"Motion-text audio returned an invalid sync assessment.",
		);
	}
	return {
		status: raw.status,
		requiresSync: raw.requiresSync,
		analysisReusable: raw.analysisReusable,
	};
}
