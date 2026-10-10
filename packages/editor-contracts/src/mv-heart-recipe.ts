import type { ProgrammaticResource } from "./programmatic-resources";
import type { MvAudioStop } from "./mv-recipe-audio";
import type { MvRole, MvSpan } from "./mv-recipe";
import type {
	MvHeartShatterSettings,
	MvHeartBurnSettings,
	MvHeartGatherSettings,
	MvHeartSunSettings,
	MvHeartSkySettings,
	MvHeartOwnerFrameInput,
} from "./mv-heart";
type Author = {
	readonly role: MvRole;
	readonly span: MvSpan;
	readonly bpm: number;
};
/** Author fields only. Native dimensions, packets, manifests and leases are forbidden. */
export type MvHeartRecipeScene = Author &
	(
		| {
				readonly kind: "heartShatter";
				readonly settings: MvHeartShatterSettings;
		  }
		| {
				readonly kind: "heartShatterBurn";
				readonly settings: MvHeartBurnSettings;
		  }
		| { readonly kind: "heartGather"; readonly settings: MvHeartGatherSettings }
		| { readonly kind: "sunBloom"; readonly settings: MvHeartSunSettings }
		| { readonly kind: "skyShatter"; readonly settings: MvHeartSkySettings }
	);
export interface MvHeartRecipeRequest {
	readonly status: "pendingNativeOwner";
	readonly source: ProgrammaticResource;
	readonly background: ProgrammaticResource | null;
	readonly character: ProgrammaticResource | null;
	readonly frame: MvHeartOwnerFrameInput;
	readonly provenance: {
		readonly schema: string;
		readonly inputSha256: string;
		readonly vocalSha256: string | null;
		readonly manifestSha256: string;
		readonly musicSha256: string;
		readonly envelopesSha256: string;
		readonly review: {
			readonly status: "accepted";
			readonly reference: string;
		};
	};
	readonly downbeats: readonly number[];
	readonly stops: readonly MvAudioStop[] | null;
	readonly reservation: {
		readonly nativeFactsPending: true;
		readonly declaredEncodedBytes: number;
		readonly ownerMaxBytes: number;
		readonly ownerMaxSessions: number;
		readonly frameMetadataMaxBytes: number;
		/** Present only after Rust complete native graph/resource admission. */
		readonly host?: {
			readonly recipeReservationBytes: number;
			readonly sessionCeilingBytes: number;
			readonly maxLiveSessions: number;
			readonly rasterByteLimit: number;
		};
	};
}
export interface MvHeartRecipeRequestNode {
	readonly kind: "heartOwnerRequest";
	readonly role: MvRole;
	readonly nodeId: string;
	readonly request: MvHeartRecipeRequest;
}
