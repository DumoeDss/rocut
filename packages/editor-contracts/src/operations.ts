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
	Project,
	ProjectId,
	Track,
	TrackId,
} from "./domain";
import type { MotionTextSequence, MotionTextSequenceId } from "./motion-text";

/** The public, Host-neutral Project fields that a transaction may update. */
export type ProjectPatch = Partial<
	Pick<
		Project,
		| "name"
		| "frameRate"
		| "canvasWidth"
		| "canvasHeight"
		| "sceneState"
		| "background"
	>
>;

/** Update the selected Project without exposing provider-private settings. */
export interface UpdateProjectOperation {
	readonly kind: "update-project";
	readonly projectId: ProjectId;
	readonly patch: ProjectPatch;
}

/** Create a versioned motion-text sequence before a clip references it. */
export interface CreateMotionTextSequenceOperation {
	readonly kind: "create-motion-text-sequence";
	readonly sequence: MotionTextSequence;
}

/**
 * Atomically replace one sequence after comparing its entity revision.
 *
 * A full replacement prevents nested cue/plan fields from being silently
 * dropped by shallow patching. Domain-specific cue/style operations can build
 * the replacement through the Rust core, then submit it through this boundary.
 */
export interface UpdateMotionTextSequenceOperation {
	readonly kind: "update-motion-text-sequence";
	readonly sequenceId: MotionTextSequenceId;
	readonly expectedSequenceRevision: number;
	readonly sequence: MotionTextSequence;
}

/** Delete an unreferenced sequence after comparing its entity revision. */
export interface DeleteMotionTextSequenceOperation {
	readonly kind: "delete-motion-text-sequence";
	readonly sequenceId: MotionTextSequenceId;
	readonly expectedSequenceRevision: number;
}

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
	/** Exact permutation of all current track IDs; relative order within each scene/lane is rendered. */
	| { readonly kind: "reorder-tracks"; readonly trackIds: readonly TrackId[] }
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
			/** null explicitly clears optional media settings across JSON transports. */
			readonly patch: Partial<
				Omit<
					Clip,
					"id" | "freezeFrame" | "retime" | "transitionIn" | "sourceComponent"
				>
			> & {
				readonly sourceComponent?: Clip["sourceComponent"] | null;
				readonly retime?: Clip["retime"] | null;
				readonly transitionIn?: Clip["transitionIn"] | null;
				readonly freezeFrame?: Clip["freezeFrame"] | null;
			};
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
	| { readonly kind: "delete-marker"; readonly markerId: MarkerId }
	| CreateMotionTextSequenceOperation
	| UpdateMotionTextSequenceOperation
	| DeleteMotionTextSequenceOperation
	| UpdateProjectOperation;

/** The set of all operation kind strings, for runtime checks. */
export const OPERATION_KINDS = [
	"reorder-tracks",
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
	"create-motion-text-sequence",
	"update-motion-text-sequence",
	"delete-motion-text-sequence",
	"update-project",
] as const;

/** A single operation kind string. */
export type OperationKind = (typeof OPERATION_KINDS)[number];
