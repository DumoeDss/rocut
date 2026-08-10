/**
 * Transaction operations — the discriminated union of atomic edits.
 *
 * Each operation carries a `kind` field that discriminates its payload
 * structurally, making `apply` type-safe. `update-*` operations take a `patch`
 * (partial minus `id`), not a full replacement, so a caller cannot accidentally
 * drop the `id` field or change the entity kind.
 */
import type {
	Asset,
	AssetId,
	Clip,
	ClipId,
	Marker,
	MarkerId,
	Track,
	TrackId,
} from "./domain";

/**
 * The discriminated union of operations an `apply` batch may contain.
 *
 * Adding a new operation kind (e.g., `create-effect`) is a compile-breaking
 * change for consumers — intentionally, because a new operation kind is a
 * contract change that should be visible at compile time, not silently swallowed
 * by a generic escape hatch.
 */
export type TransactionOperation =
	| { readonly kind: "create-track"; readonly track: Track }
	| {
			readonly kind: "update-track";
			readonly trackId: TrackId;
			readonly patch: Partial<Omit<Track, "id">>;
	  }
	| { readonly kind: "delete-track"; readonly trackId: TrackId }
	| { readonly kind: "create-clip"; readonly clip: Clip }
	| {
			readonly kind: "update-clip";
			readonly clipId: ClipId;
			readonly patch: Partial<Omit<Clip, "id">>;
	  }
	| { readonly kind: "delete-clip"; readonly clipId: ClipId }
	| { readonly kind: "create-asset"; readonly asset: Asset }
	| { readonly kind: "delete-asset"; readonly assetId: AssetId }
	| { readonly kind: "create-marker"; readonly marker: Marker }
	| {
			readonly kind: "update-marker";
			readonly markerId: MarkerId;
			readonly patch: Partial<Omit<Marker, "id">>;
	  }
	| { readonly kind: "delete-marker"; readonly markerId: MarkerId };

/** The set of all operation kind strings, for runtime checks. */
export const OPERATION_KINDS = [
	"create-track",
	"update-track",
	"delete-track",
	"create-clip",
	"update-clip",
	"delete-clip",
	"create-asset",
	"delete-asset",
	"create-marker",
	"update-marker",
	"delete-marker",
] as const;

/** A single operation kind string. */
export type OperationKind = (typeof OPERATION_KINDS)[number];
