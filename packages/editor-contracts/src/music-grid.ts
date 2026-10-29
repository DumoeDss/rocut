/** Transport only. Rust owns review, source mapping, candidates and quantization. */
export type MusicGridSourceAvailabilityProbe = (pin: {
	readonly assetId: string;
	readonly sourceSha256: string;
}) => Promise<"available" | "unavailable" | "unknown">;
export interface MusicGridPoint {
	readonly id: string;
	readonly sourceTick: number;
	/** Missing means unknown, not a guessed bar boundary. */
	readonly downbeat?: boolean;
}
export interface MusicGridRational {
	readonly numerator: number;
	readonly denominator: number;
}
/** Reviewed source range. Phase uses quarter notes; beatUnit uses whole notes. */
export interface MusicGridMeterSegment {
	readonly id: string;
	readonly sourceStartTick: number;
	readonly sourceEndTick: number;
	readonly meter: MusicGridRational;
	readonly beatUnit: MusicGridRational;
	readonly phaseQuarterNotes: MusicGridRational;
	readonly barNumber?: number;
	readonly confidence?: number;
}
export interface MusicGridManualBpmSegment extends MusicGridMeterSegment {
	readonly quarterNoteBpm: MusicGridRational;
	readonly interpolation: "step";
}
export interface MusicGridAnchorSource {
	readonly sourceSha256: string;
	readonly resourceSha256: string;
	readonly resourceRevision: number;
	readonly reviewReference: string;
	readonly anchors: readonly {
		readonly key: string;
		/** Closed source boundary [0, sourceDurationTick]; trim endpoints project exactly, including reverse. */
		readonly sourceTick: number;
	}[];
}
export interface ReviewedMusicGrid {
	readonly id: string;
	readonly revision: number;
	readonly mode: "measured" | "manual";
	readonly assetId: string;
	readonly sourceSha256: string;
	readonly sourceDurationTick: number;
	readonly reviewReference: string;
	readonly analysisProvenance: unknown | null;
	readonly points: readonly MusicGridPoint[];
	readonly meterSegments?: readonly MusicGridMeterSegment[];
	readonly manualBpmProvenance?: readonly MusicGridManualBpmSegment[];
}
export interface MusicGridBinding {
	readonly id: string;
	readonly gridId: string;
	readonly clipId: string;
	readonly assetId: string;
	readonly sceneId: string;
}
export interface MusicGridState {
	readonly version: 1;
	readonly grids: readonly ReviewedMusicGrid[];
	readonly bindings: readonly MusicGridBinding[];
}
export interface MusicGridQuery {
	readonly kind: "read" | "list" | "snap" | "validate" | "project-anchors";
	readonly clock?: "scene-timeline-ticks" | "project-timeline-ticks";
	readonly anchorSource?: MusicGridAnchorSource;
	readonly bindingId: string;
	readonly expectedNativeRevision?: number;
	readonly expectedGridRevision?: number;
	readonly expectedMappingHash?: string;
	readonly pointKind?: "beat" | "downbeat";
	readonly range?: { readonly startTick: number; readonly endTick: number };
	readonly offset?: number;
	readonly limit?: number;
	readonly samples?: readonly { readonly key: string; readonly tick: number }[];
	readonly direction?: "nearest" | "before" | "after";
	readonly maxDistanceTicks?: number;
	readonly frameQuantize?: boolean;
}
export interface MusicGridEditRequest {
	readonly expectedNativeRevision: number;
	readonly idempotencyKey: string;
	readonly operation:
		| {
				readonly kind: "create-manual-bpm";
				readonly clipId: string;
				readonly segments: readonly MusicGridManualBpmSegment[];
				readonly reviewReference: string;
		  }
		| {
				readonly kind: "replace-structure";
				readonly gridId: string;
				readonly expectedGridRevision: number;
				readonly meterSegments: readonly MusicGridMeterSegment[];
				readonly reviewReference: string;
		  }
		| {
				readonly kind: "create-measured";
				readonly clipId: string;
				readonly analysis: unknown;
				readonly reviewReference: string;
		  }
		| {
				readonly kind: "create-manual";
				readonly clipId: string;
				readonly points: readonly MusicGridPoint[];
				readonly reviewReference: string;
		  }
		| {
				readonly kind: "replace-points";
				readonly gridId: string;
				readonly expectedGridRevision: number;
				readonly points: readonly MusicGridPoint[];
				readonly reviewReference: string;
		  }
		| {
				readonly kind: "bind";
				readonly gridId: string;
				readonly expectedGridRevision: number;
				readonly clipId: string;
		  }
		| {
				readonly kind: "remove";
				readonly gridId: string;
				readonly expectedGridRevision: number;
		  };
}
