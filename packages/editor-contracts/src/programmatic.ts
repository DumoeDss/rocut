import type { FrameRate } from "./domain";
import type { MvRecipe } from "./mv-recipe";
import {
	isProgrammaticBuild,
	type ProgrammaticBuild,
} from "./programmatic-build";
import {
	isProgrammaticResource,
	type ProgrammaticResource,
} from "./programmatic-resources";

/** Self-contained picture source. Explicit native audio is mixed by Rocut.
 * canvas-worker code is an async body (canvas, frame); html-document code is
 * a complete self-contained document, or empty when documentId selects a
 * content-addressed document attachment. Neither runtime receives host access.
 */
export interface ProgrammaticSource {
	readonly version: 1;
	readonly runtime: "canvas-worker" | "html-document";
	readonly code: string;
	readonly documentId?: string;
	readonly width: number;
	readonly height: number;
	readonly frameRate: FrameRate;
	readonly durationFrames: number;
	readonly seed: number;
	readonly resources?: readonly ProgrammaticResource[];
	readonly build?: ProgrammaticBuild;
	/** Opt-in source soundtrack; unsupported hosts must fail, never silently mute. */
	readonly audio?: {
		readonly version: 1;
		readonly mode: "native";
		/** Explicit pinned HyperFrames graph semantics; omission preserves legacy native audio. */
		readonly profile?: "hyperframes-graph-v1";
		readonly muted?: boolean;
		readonly volumeDb?: number;
	};
	readonly recipe?: MvRecipe;
}

/** Original integer timing request, revalidated by Rust at the host boundary. */
export interface ProgrammaticFrameRequest {
	readonly source: ProgrammaticSource;
	readonly clipStart: number;
	readonly clipDuration: number;
	readonly trimStart: number;
	readonly timelineTime: number;
}

/** Transport shape only; Rust owns limits, duration and frame mapping. */
export function isProgrammaticSource(
	value: unknown,
): value is ProgrammaticSource {
	const isRecord = (input: unknown): input is Record<string, unknown> =>
		!!input && typeof input === "object" && !Array.isArray(input);
	if (!isRecord(value)) return false;
	const source = value;
	const keys = [
		"version",
		"runtime",
		"code",
		"documentId",
		"width",
		"height",
		"frameRate",
		"durationFrames",
		"seed",
		"resources",
		"build",
		"audio",
		"recipe",
	];
	if (Object.keys(source).some((key) => !keys.includes(key))) return false;
	const rate = source.frameRate;
	return (
		source.version === 1 &&
		(source.runtime === "canvas-worker" ||
			source.runtime === "html-document") &&
		typeof source.code === "string" &&
		// Rust is authoritative for the complete declarative recipe schema.
		(source.recipe === undefined || isRecord(source.recipe)) &&
		(source.build === undefined || isProgrammaticBuild(source.build)) &&
		(source.audio === undefined ||
			(isRecord(source.audio) &&
				Object.keys(source.audio).every((key) =>
					["version", "mode", "profile", "muted", "volumeDb"].includes(key),
				) &&
				source.audio.version === 1 &&
				source.audio.mode === "native" &&
				(source.audio.profile === undefined ||
					source.audio.profile === "hyperframes-graph-v1") &&
				(source.audio.muted === undefined ||
					typeof source.audio.muted === "boolean") &&
				(source.audio.volumeDb === undefined ||
					typeof source.audio.volumeDb === "number"))) &&
		(source.documentId === undefined ||
			typeof source.documentId === "string") &&
		(source.resources === undefined ||
			(Array.isArray(source.resources) &&
				source.resources.every(isProgrammaticResource))) &&
		["width", "height", "durationFrames", "seed"].every((key) =>
			Number.isSafeInteger(source[key]),
		) &&
		!!rate &&
		typeof rate === "object" &&
		!Array.isArray(rate) &&
		Object.keys(rate).every(
			(key) => key === "numerator" || key === "denominator",
		) &&
		Number.isSafeInteger(Reflect.get(rate, "numerator")) &&
		Number.isSafeInteger(Reflect.get(rate, "denominator"))
	);
}
