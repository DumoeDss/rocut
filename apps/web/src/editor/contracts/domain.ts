/**
 * Host-neutral domain types for the transaction contract.
 *
 * Every type in this module is standalone: no import from any OpenCut schema
 * module, command class, editor store, or storage service. The boundary check
 * script (`script/check-transaction-boundary.mjs`) enforces this mechanically.
 *
 * `MediaTime` is defined here rather than re-exported from `@/wasm` because the
 * wasm module is editor-internal and the boundary check bans it. Structural
 * compatibility (same tick rate, same branded-number shape) means T1/T3 bridge
 * between contract `MediaTime` and donor `MediaTime` with a zero-cost cast at
 * the seam.
 */

// ---------------------------------------------------------------------------
// MediaTime — branded integer at fixed 120,000 ticks/sec
// ---------------------------------------------------------------------------

/**
 * The fixed tick rate shared with the donor's `@/wasm` MediaTime.
 * Structural compatibility — not an import dependency.
 */
export const TICKS_PER_SECOND = 120_000 as const;

/**
 * Nominal brand for {@link MediaTime}. A raw `number` is not assignable to
 * `MediaTime` without the {@link mediaTime} constructor.
 */
declare const __mediaTimeBrand: unique symbol;

/**
 * A non-negative integer representing a time position or duration at
 * {@link TICKS_PER_SECOND} ticks per second.
 *
 * Use {@link mediaTime} to construct a value; use {@link ticksOf} to read the
 * raw integer.
 */
export type MediaTime = number & { readonly [__mediaTimeBrand]: true };

/**
 * Construct a {@link MediaTime} from non-negative integer ticks.
 *
 * @throws {RangeError} if `ticks` is negative or not an integer.
 */
export function mediaTime({ ticks }: { ticks: number }): MediaTime {
	if (!Number.isInteger(ticks) || ticks < 0) {
		throw new RangeError(
			`MediaTime requires a non-negative integer tick count, got ${ticks}`,
		);
	}
	return ticks as MediaTime;
}

/** Extract the raw integer tick count from a {@link MediaTime}. */
export function ticksOf(time: MediaTime): number {
	return time as number;
}

// ---------------------------------------------------------------------------
// FrameRate — rational, validated at construction
// ---------------------------------------------------------------------------

/**
 * A rational frame rate: `numerator / denominator` frames per second.
 *
 * Same shape as the wasm binding's `FrameRate`. Use {@link validateFrameRate}
 * to check that it produces an integer ticks-per-frame at the fixed tick rate.
 */
export interface FrameRate {
	readonly numerator: number;
	readonly denominator: number;
}

/**
 * Validate that a {@link FrameRate} produces an integer ticks-per-frame at
 * {@link TICKS_PER_SECOND}.
 *
 * `TICKS_PER_SECOND / (numerator / denominator)` must be a positive integer.
 * For example, 30/1 fps yields `120000 / 30 = 4000` ticks per frame (accepted),
 * but 90/1 fps yields `120000 / 90 = 1333.333...` (rejected).
 *
 * @throws {RangeError} if the rate does not produce an integer ticks-per-frame,
 *   or if numerator/denominator are not positive integers.
 */
export function validateFrameRate(rate: FrameRate): void {
	const { numerator, denominator } = rate;
	if (
		!Number.isInteger(numerator) ||
		numerator <= 0 ||
		!Number.isInteger(denominator) ||
		denominator <= 0
	) {
		throw new RangeError(
			`FrameRate numerator and denominator must be positive integers, ` +
				`got ${numerator}/${denominator}`,
		);
	}
	const ticksPerFrame = (TICKS_PER_SECOND * denominator) / numerator;
	if (!Number.isInteger(ticksPerFrame) || ticksPerFrame <= 0) {
		throw new RangeError(
			`FrameRate ${numerator}/${denominator} does not produce integer ` +
				`ticks-per-frame at ${TICKS_PER_SECOND} ticks/sec ` +
				`(= ${ticksPerFrame.toFixed(6)})`,
		);
	}
}

/**
 * Construct a {@link FrameRate} that is guaranteed to produce integer
 * ticks-per-frame. Convenience wrapper around {@link validateFrameRate}.
 */
export function frameRate(rate: FrameRate): FrameRate {
	validateFrameRate(rate);
	return rate;
}

// ---------------------------------------------------------------------------
// Branded ID types — string brands, not assignable from plain string
// ---------------------------------------------------------------------------

declare const __trackIdBrand: unique symbol;
declare const __clipIdBrand: unique symbol;
declare const __assetIdBrand: unique symbol;
declare const __markerIdBrand: unique symbol;
declare const __projectIdBrand: unique symbol;

/** A unique track identifier. */
export type TrackId = string & { readonly [__trackIdBrand]: true };

/** A unique clip identifier. */
export type ClipId = string & { readonly [__clipIdBrand]: true };

/** A unique asset identifier. */
export type AssetId = string & { readonly [__assetIdBrand]: true };

/** A unique marker identifier. */
export type MarkerId = string & { readonly [__markerIdBrand]: true };

/** A unique project identifier. */
export type ProjectId = string & { readonly [__projectIdBrand]: true };

/** Construct a {@link TrackId} from a plain string. */
export function trackId(id: string): TrackId {
	return id as TrackId;
}

/** Construct a {@link ClipId} from a plain string. */
export function clipId(id: string): ClipId {
	return id as ClipId;
}

/** Construct an {@link AssetId} from a plain string. */
export function assetId(id: string): AssetId {
	return id as AssetId;
}

/** Construct a {@link MarkerId} from a plain string. */
export function markerId(id: string): MarkerId {
	return id as MarkerId;
}

/** Construct a {@link ProjectId} from a plain string. */
export function projectId(id: string): ProjectId {
	return id as ProjectId;
}

// ---------------------------------------------------------------------------
// Entity interfaces — minimal, Host-neutral
// ---------------------------------------------------------------------------

/**
 * The kind of content a track carries. The contract uses a single `Track`
 * interface with a `kind` discriminator, not a union of provider-specific
 * variants. Provider-private fields (effects, masks, keyframes, retiming,
 * animations) are excluded — Target State §5.3 "Not Now" until two real use
 * cases exist.
 */
export type TrackKind = "video" | "audio" | "text" | "graphic" | "effect";

/**
 * Top-level project metadata. The minimal stable surface an automation client
 * needs — not a mirror of the full donor `TProject` schema.
 */
export interface Project {
	readonly id: ProjectId;
	readonly name: string;
	readonly frameRate: FrameRate;
	readonly canvasWidth: number;
	readonly canvasHeight: number;
}

/**
 * A timeline track. Maps to the donor's `TimelineTrack` (5 variants) but
 * flattened to a single interface with a {@link TrackKind} discriminator.
 */
export interface Track {
	readonly id: TrackId;
	readonly kind: TrackKind;
	readonly name: string;
	readonly hidden: boolean;
}

/**
 * A timeline clip. Maps to the donor's `TimelineElement` (8 variants) but
 * flattened to a single interface. `assetId` is optional because not every clip
 * kind references a media asset (e.g., text or generated elements).
 */
export interface Clip {
	readonly id: ClipId;
	readonly trackId: TrackId;
	readonly startTime: MediaTime;
	readonly duration: MediaTime;
	readonly trimStart: MediaTime;
	readonly trimEnd: MediaTime;
	readonly assetId?: AssetId;
}

/**
 * The kind of media an asset contains.
 */
export type AssetKind = "image" | "video" | "audio";

/**
 * A media asset. Maps to the donor's `MediaAsset`/`MediaAssetData`. Duration and
 * dimensions are optional because not every asset kind carries them (e.g., an
 * image has no duration).
 */
export interface Asset {
	readonly id: AssetId;
	readonly kind: AssetKind;
	readonly name: string;
	readonly duration?: MediaTime;
	readonly width?: number;
	readonly height?: number;
}

/**
 * A timeline marker/bookmark. Maps to the donor's `Bookmark`.
 */
export interface Marker {
	readonly id: MarkerId;
	readonly time: MediaTime;
	readonly note?: string;
	readonly color?: string;
}
