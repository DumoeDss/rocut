/** Agent-visible editor state. Collections are replaced, never implicitly merged.
 * Use read + expectedRevision when editing a collection; [] / {} explicitly clear it.
 * Provider catalogues supply supported parameter keys, units and ranges.
 */
export type EditingValue = number | string | boolean;
export type EditingParams = Readonly<Record<string, EditingValue>>;

export interface EditingKey {
	readonly id: string;
	/** Element-relative ticks (120,000 ticks/second). */
	readonly time: number;
	readonly value: EditingValue;
	readonly segmentToNext?: "step" | "linear" | "bezier";
	readonly tangentMode?: "auto" | "aligned" | "broken" | "flat";
	readonly leftHandle?: { readonly dt: number; readonly dv: number };
	readonly rightHandle?: { readonly dt: number; readonly dv: number };
}

export interface EditingChannel {
	readonly keys: readonly EditingKey[];
	readonly extrapolation?: {
		readonly before: "hold" | "linear";
		readonly after: "hold" | "linear";
	};
}

export type EditingAnimations = Readonly<
	Record<
		string,
		| EditingChannel
		| Readonly<Record<string, EditingChannel | undefined>>
		| undefined
	>
>;

export interface EditingEffect {
	readonly id: string;
	readonly type: string;
	readonly enabled: boolean;
	readonly params: EditingParams;
}

export interface EditingPathPoint {
	readonly id: string;
	readonly x: number;
	readonly y: number;
	readonly inX: number;
	readonly inY: number;
	readonly outX: number;
	readonly outY: number;
}

export interface EditingMask {
	readonly id: string;
	readonly type:
		| "split"
		| "cinematic-bars"
		| "rectangle"
		| "ellipse"
		| "heart"
		| "diamond"
		| "star"
		| "text"
		| "freeform";
	readonly params: Readonly<
		Record<string, EditingValue | readonly EditingPathPoint[]>
	>;
}

export type EditingElementType =
	| "video"
	| "image"
	| "audio"
	| "text"
	| "graphic"
	| "sticker"
	| "motion-text"
	| "effect";

export interface ClipEditing {
	readonly type: EditingElementType;
	readonly name?: string;
	readonly hidden?: boolean;
	readonly params: EditingParams;
	readonly animations?: EditingAnimations;
	readonly effects?: readonly EditingEffect[];
	readonly masks?: readonly EditingMask[];
	readonly isSourceAudioEnabled?: boolean;
	readonly definitionId?: string;
	readonly stickerId?: string;
	readonly intrinsicWidth?: number;
	readonly intrinsicHeight?: number;
	readonly effectType?: string;
}

const record = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);
const scalar = (value: unknown): boolean =>
	typeof value === "boolean" ||
	typeof value === "string" ||
	(typeof value === "number" && Number.isFinite(value));
const params = (value: unknown): boolean =>
	record(value) && Object.values(value).every(scalar);

/** Transport shape check only. Rust/provider policy owns key, range and lane semantics. */
export function isClipEditing(value: unknown): value is ClipEditing {
	if (
		!record(value) ||
		!params(value.params) ||
		![
			"video",
			"image",
			"audio",
			"text",
			"graphic",
			"sticker",
			"motion-text",
			"effect",
		].includes(String(value.type))
	)
		return false;
	const fields = [
		"type",
		"name",
		"hidden",
		"params",
		"animations",
		"effects",
		"masks",
		"isSourceAudioEnabled",
		"definitionId",
		"stickerId",
		"intrinsicWidth",
		"intrinsicHeight",
		"effectType",
	];
	if (Object.keys(value).some((key) => !fields.includes(key))) return false;
	for (const key of ["name", "definitionId", "stickerId", "effectType"])
		if (value[key] !== undefined && typeof value[key] !== "string")
			return false;
	for (const key of ["hidden", "isSourceAudioEnabled"])
		if (value[key] !== undefined && typeof value[key] !== "boolean")
			return false;
	for (const key of ["intrinsicWidth", "intrinsicHeight"])
		if (
			value[key] !== undefined &&
			(typeof value[key] !== "number" ||
				!Number.isFinite(value[key]) ||
				value[key] <= 0)
		)
			return false;
	if (value.animations !== undefined && !record(value.animations)) return false;
	if (
		value.effects !== undefined &&
		(!Array.isArray(value.effects) ||
			!value.effects.every(
				(effect) =>
					record(effect) &&
					typeof effect.id === "string" &&
					typeof effect.type === "string" &&
					typeof effect.enabled === "boolean" &&
					params(effect.params),
			))
	)
		return false;
	if (
		value.masks !== undefined &&
		(!Array.isArray(value.masks) ||
			!value.masks.every(
				(mask) =>
					record(mask) &&
					typeof mask.id === "string" &&
					typeof mask.type === "string" &&
					record(mask.params),
			))
	)
		return false;
	return true;
}
