/** Runtime request validation and public catalog for motion-text host routes. */
import { createHash } from "node:crypto";
import {
	DEFAULT_MOTION_TEXT_PLANNING_CONTROLS,
	type MotionTextPresetGroup,
} from "@opencut/editor-contracts";
import {
	JIZURA_PRESET_CATALOG,
	MOTION_TEXT_RENDERER_SUPPORT_VERSION,
	MOTION_TEXT_STARTER_PRESET_IDS,
	type MotionTextSequenceMutation,
	type MotionTextStarterPresetId,
} from "@opencut/editor-classic/motion-text/factory";

export const PRESET_GROUPS = [
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
] as const satisfies readonly MotionTextPresetGroup[];

const MUTATION_KINDS = new Set([
	"update-planning-controls",
	"update-defaults",
	"set-cut-boundary",
	"set-cue-lock",
	"update-cue",
	"apply-cue-taps",
	"set-audio-binding",
	"sync-audio-timing",
	"set-audio-beat-override",
	"clear-audio-binding",
]);

export class MotionTextApiError extends Error {
	readonly status: number;
	readonly code: string;
	readonly details: Readonly<Record<string, unknown>>;

	constructor(args: {
		readonly status: number;
		readonly code: string;
		readonly message: string;
		readonly details?: Readonly<Record<string, unknown>>;
	}) {
		super(args.message);
		this.name = "MotionTextApiError";
		this.status = args.status;
		this.code = args.code;
		this.details = args.details ?? {};
	}
}

interface MotionTextRequestJournalEntry {
	readonly fingerprint: string;
	readonly response: Readonly<Record<string, unknown>>;
}

export type MotionTextRequestJournal = Map<
	string,
	MotionTextRequestJournalEntry
>;

export function createMotionTextRequestJournal(): MotionTextRequestJournal {
	return new Map();
}

function canonicalJson(value: unknown): string {
	if (value === null || typeof value !== "object") {
		return JSON.stringify(value);
	}
	if (Array.isArray(value)) {
		return `[${value.map(canonicalJson).join(",")}]`;
	}
	const object = value as Record<string, unknown>;
	return `{${Object.keys(object)
		.sort()
		.map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key])}`)
		.join(",")}}`;
}

function requestFingerprint(
	scope: string,
	input: Record<string, unknown>,
): string {
	const businessInput = Object.fromEntries(
		Object.entries(input).filter(
			([key]) => key !== "expectedRevision" && key !== "idempotencyKey",
		),
	);
	return createHash("sha256")
		.update(canonicalJson({ scope, input: businessInput }), "utf8")
		.digest("hex");
}

export function replayMotionTextRequest(args: {
	readonly journal: MotionTextRequestJournal | undefined;
	readonly idempotencyKey: string;
	readonly scope: string;
	readonly input: Record<string, unknown>;
}): Readonly<Record<string, unknown>> | null {
	const entry = args.journal?.get(args.idempotencyKey);
	if (entry === undefined) return null;
	const fingerprint = requestFingerprint(args.scope, args.input);
	if (entry.fingerprint !== fingerprint) {
		throw new MotionTextApiError({
			status: 409,
			code: "motion-text-idempotency-conflict",
			message: `Idempotency key ${args.idempotencyKey} was already used for a different motion-text request.`,
			details: { idempotencyKey: args.idempotencyKey },
		});
	}
	return { ...entry.response, replayed: true };
}

export function rememberMotionTextRequest(args: {
	readonly journal: MotionTextRequestJournal | undefined;
	readonly idempotencyKey: string;
	readonly scope: string;
	readonly input: Record<string, unknown>;
	readonly response: Readonly<Record<string, unknown>>;
}): void {
	args.journal?.set(args.idempotencyKey, {
		fingerprint: requestFingerprint(args.scope, args.input),
		response: args.response,
	});
}

export function invalid(
	message: string,
	details: Record<string, unknown> = {},
): never {
	throw new MotionTextApiError({
		status: 400,
		code: "invalid-motion-text-request",
		message,
		details,
	});
}

export function record(
	value: unknown,
	label = "request",
): Record<string, unknown> {
	if (value === null || typeof value !== "object" || Array.isArray(value)) {
		return invalid(`${label} must be a JSON object.`);
	}
	return value as Record<string, unknown>;
}

export function onlyKeys(
	value: Record<string, unknown>,
	allowed: readonly string[],
): void {
	const allowedSet = new Set(allowed);
	const unknown = Object.keys(value).filter((key) => !allowedSet.has(key));
	if (unknown.length > 0) {
		invalid(`Request contains unsupported field ${unknown[0]}.`, {
			unsupportedFields: unknown,
		});
	}
}

export function nonEmptyString(
	value: unknown,
	field: string,
	options: { readonly optional?: boolean } = {},
): string | undefined {
	if (value === undefined && options.optional === true) return undefined;
	if (typeof value !== "string" || value.trim().length === 0) {
		return invalid(`${field} must be a non-empty string.`, { field });
	}
	return value;
}

export function integer(
	value: unknown,
	field: string,
	options: {
		readonly optional?: boolean;
		readonly minimum?: number;
		readonly maximum?: number;
	} = {},
): number | undefined {
	if (value === undefined && options.optional === true) return undefined;
	const minimum = options.minimum ?? 0;
	const maximum = options.maximum ?? Number.MAX_SAFE_INTEGER;
	if (
		typeof value !== "number" ||
		!Number.isSafeInteger(value) ||
		value < minimum ||
		value > maximum
	) {
		return invalid(
			`${field} must be an integer between ${minimum} and ${maximum}.`,
			{ field },
		);
	}
	return value;
}

export function stringArray(
	value: unknown,
	field: string,
	options: { readonly optional?: boolean } = {},
): readonly string[] {
	if (value === undefined && options.optional === true) return [];
	if (
		!Array.isArray(value) ||
		!value.every((entry) => typeof entry === "string" && entry.length > 0)
	) {
		return invalid(`${field} must be an array of non-empty strings.`, {
			field,
		});
	}
	return value;
}

export function stableId(
	kind: "sequence" | "clip" | "track",
	key: string,
): string {
	const digest = createHash("sha256")
		.update(`rocut-motion-text-${kind}\0${key}`, "utf8")
		.digest("hex")
		.slice(0, 24);
	return `motion-${kind}:${digest}`;
}

export function rejected(
	diagnostics: readonly { readonly code: string; readonly message: string }[],
	extra: Record<string, unknown> = {},
): never {
	const message =
		diagnostics.length === 0
			? "The Rust motion-text factory rejected the request."
			: diagnostics
					.map((entry) => `${entry.code}: ${entry.message}`)
					.join("; ");
	throw new MotionTextApiError({
		status: 422,
		code: "motion-text-factory-rejected",
		message,
		details: { diagnostics, ...extra },
	});
}

export function isStarterPreset(
	value: string,
): value is MotionTextStarterPresetId {
	return MOTION_TEXT_STARTER_PRESET_IDS.some((id) => id === value);
}

export function mutationFrom(value: unknown): MotionTextSequenceMutation {
	const mutation = record(value, "mutation");
	if (typeof mutation.kind !== "string" || !MUTATION_KINDS.has(mutation.kind)) {
		return invalid("mutation.kind is not a supported motion-text mutation.", {
			field: "mutation.kind",
			supported: [...MUTATION_KINDS],
		});
	}
	// Rust owns the complete per-variant schema and returns field-level
	// diagnostics. This narrowing only closes the public kind set before the
	// payload crosses that boundary.
	return mutation as unknown as MotionTextSequenceMutation;
}

export function motionTextCatalog(): Readonly<Record<string, unknown>> {
	const counts: Record<string, number> = {};
	for (const group of PRESET_GROUPS) counts[group] = 0;
	for (const entry of JIZURA_PRESET_CATALOG) {
		counts[entry.group] = (counts[entry.group] ?? 0) + 1;
	}
	return {
		schemaVersion: 1,
		rendererSupportVersion: MOTION_TEXT_RENDERER_SUPPORT_VERSION,
		starterPresets: MOTION_TEXT_STARTER_PRESET_IDS,
		planningDefaults: DEFAULT_MOTION_TEXT_PLANNING_CONTROLS,
		groups: PRESET_GROUPS,
		counts: { ...counts, total: JIZURA_PRESET_CATALOG.length },
		entries: JIZURA_PRESET_CATALOG,
	};
}
