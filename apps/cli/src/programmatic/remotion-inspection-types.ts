import type {
	ProgrammaticSource,
	ResolvedProgrammaticResource,
} from "@opencut/editor-contracts";
import type {
	RemotionMetadataAdapterIdentity,
	RemotionMetadataReceipt,
} from "./remotion-metadata-contract";

export interface InspectedComposition {
	id: string;
	width: number;
	height: number;
	fps: number;
	durationFrames: number;
	props: Record<string, unknown>;
	admission?: "accepted" | "requires-explicit-frame-rate";
}

export interface RemotionInspectionSnapshot {
	revision: string;
	source: ProgrammaticSource;
	inputs: ResolvedProgrammaticResource[];
	toolchainLockSha256: string;
	metadataAdapter: RemotionMetadataAdapterIdentity;
	compositions: InspectedComposition[];
}

export type PreparedRemotionCompile = Pick<
	RemotionInspectionSnapshot,
	"source" | "inputs" | "toolchainLockSha256"
> & { metadataReceipt: RemotionMetadataReceipt };
