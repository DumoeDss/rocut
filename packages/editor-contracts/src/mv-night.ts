import type { MvRole, MvSpan } from "./mv-recipe";
import type { MvTrain, MvTrainPlan } from "./mv-train";
import type { MvWetFloor, MvWetFloorPlan } from "./mv-wet-floor";
import type { ProgrammaticResource } from "./programmatic-resources";
import type { ReferencePostPlan } from "./mv-reference-post";
import type { MvLutAtlasRowSample, MvLutAtlasSettings } from "./mv-lut-atlas";

/** Physical resources carry family/style/SHA. Instances cannot override them. */
export interface MvNightFontInstance {
	readonly id: string;
	readonly resourceId: string;
	readonly weight: number;
	readonly axes: Readonly<Record<string, number>>;
}
export type MvNightBinding =
	| { readonly scene: "wetFloor"; readonly settings: MvWetFloor }
	| { readonly scene: "train"; readonly settings: MvTrain };
export interface MvNight {
	readonly binding: MvNightBinding;
	readonly fontInstances: readonly MvNightFontInstance[];
	readonly lutAtlas?: MvLutAtlasSettings;
}
/** Proposed shared Recipe leaf, awaiting explicit module/evaluator registration. */
export interface MvNightScene {
	readonly kind: "night";
	readonly role: MvRole;
	readonly span: MvSpan;
	readonly settings: MvNight;
}
/** Discovery only. This serializable shape cannot stand in for native admission. */
export interface MvNightPreparationRequest {
	readonly host: MvNightHostReservation | null;
	readonly nodeId: string;
	readonly occurrenceId: number;
	readonly songTicks: number;
	readonly shotStartTicks: number;
	readonly shotEndTicks: number;
	readonly physicalResources: readonly ProgrammaticResource[];
	readonly fontInstances: readonly MvNightFontInstance[];
	readonly physicalEncodedBytes: number;
	readonly requiresNativeDecode: true;
	readonly requiresReflection: boolean;
	readonly requiresOriginalP4Post: boolean;
	readonly metadata: string;
	readonly lutAtlas: MvLutAtlasSettings | null;
	readonly lutResources: readonly ProgrammaticResource[];
}
/** Rust complete-graph receipt; never an authored native admission token. */
export interface MvNightHostReservation {
	readonly recipeReservationBytes: number;
	readonly retainedBitmapBytes: number;
	readonly preparationPeakBytes: number;
	readonly rasterByteLimit: number;
}
type Lease = {
	readonly sessionId: number;
	readonly frameId: number;
	readonly reservedBytes: number;
	readonly scope: string;
};
/** Owner-issued frame lease must outlive rendering and release after surfaces. */
export type MvNightNativeFrame = Lease & (
	| { readonly scene: MvWetFloorPlan; readonly postRequired: false; readonly post: null; readonly lut: null }
	| { readonly scene: MvTrainPlan; readonly postRequired: true; readonly post: ReferencePostPlan;
		readonly lut: { readonly alias: "P4"; readonly byteLength: 1024; readonly sampledSha256: string; readonly sample: MvLutAtlasRowSample } }
);
