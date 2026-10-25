import * as wasm from "opencut-wasm";
import {
	decodeSequenceBuildResult,
	type CreatedMotionTextSequence,
	type MotionTextRendererSupportEntry,
	type MotionTextStarterPresetId,
} from "./motion-text-factory";

export interface StructuredMotionTextCue {
	readonly lineId: string;
	readonly sourceLine: number;
	readonly text: string;
	readonly startTicks: number;
	readonly endTicks: number;
}
export interface MotionTextLineMapping {
	readonly lineId: string;
	readonly sourceLine: number;
	readonly cueId: string;
}
export interface StructuredMotionTextOptions {
	readonly sequenceId: string;
	readonly source: string;
	/** Raw source identity stays exact; only explicit JIZURA interprets display markup. */
	readonly textSyntax?: "literal" | "jizura";
	readonly cues: readonly StructuredMotionTextCue[];
	readonly language: string;
	readonly durationTicks: number;
	readonly starterPreset: MotionTextStarterPresetId;
	readonly seed?: number;
	readonly rendererSupport: readonly MotionTextRendererSupportEntry[];
}
export type CreateMotionTextStructuredCuesCore = (
	options: StructuredMotionTextOptions,
) => unknown;

export function hasStructuredMotionTextCore(
	core?: CreateMotionTextStructuredCuesCore,
): boolean {
	return (
		typeof (core ?? Reflect.get(wasm, "createMotionTextStructuredCues")) ===
		"function"
	);
}

export function createStructuredMotionTextSequence({
	options,
	core,
}: {
	options: StructuredMotionTextOptions;
	core?: CreateMotionTextStructuredCuesCore;
}): CreatedMotionTextSequence & {
	readonly lineMappings: readonly MotionTextLineMapping[];
} {
	const candidate = core ?? Reflect.get(wasm, "createMotionTextStructuredCues");
	if (typeof candidate !== "function")
		throw new Error("Structured motion-text capability is unavailable");
	const raw: unknown = candidate({
		...options,
		seed: options.seed,
		cues: [...options.cues],
		rendererSupport: [...options.rendererSupport],
	});
	const built = decodeSequenceBuildResult(raw);
	if (
		raw === null ||
		typeof raw !== "object" ||
		!Array.isArray(Reflect.get(raw, "lineMappings"))
	)
		throw new TypeError(
			"Structured motion-text factory returned invalid line mappings",
		);
	const lineMappings: unknown = Reflect.get(raw, "lineMappings");
	if (!Array.isArray(lineMappings))
		throw new TypeError("Invalid line mappings");
	if (built.sequence === null) {
		if (lineMappings.length !== 0)
			throw new TypeError("Rejected candidate returned line mappings");
		return { ...built, lineMappings: [] };
	}
	if (
		lineMappings.length !== options.cues.length ||
		built.sequence.cues.length !== options.cues.length ||
		built.sequence.id !== options.sequenceId ||
		built.sequence.source.text !== options.source ||
		Number(built.sequence.duration) !== options.durationTicks
	)
		throw new TypeError(
			"Structured motion-text factory returned inconsistent candidate",
		);
	const decoded = lineMappings.map((value, index) => {
		const input = options.cues[index];
		const cue = built.sequence!.cues[index];
		if (
			value === null ||
			typeof value !== "object" ||
			Reflect.get(value, "lineId") !== input.lineId ||
			Reflect.get(value, "sourceLine") !== input.sourceLine ||
			Reflect.get(value, "cueId") !== cue.id ||
			cue.sourceLine !== input.sourceLine ||
			(options.textSyntax !== "jizura" && cue.text !== input.text) ||
			Number(cue.startTime) !== input.startTicks ||
			Number(cue.duration) !== input.endTicks - input.startTicks ||
			cue.timingSource !== "manual"
		)
			throw new TypeError("Structured motion-text factory changed a fixed cue");
		return {
			lineId: input.lineId,
			sourceLine: input.sourceLine,
			cueId: String(cue.id),
		};
	});
	if (new Set(decoded.map((entry) => entry.cueId)).size !== decoded.length)
		throw new TypeError(
			"Structured motion-text factory returned duplicate cue identities",
		);
	return { ...built, lineMappings: decoded };
}
