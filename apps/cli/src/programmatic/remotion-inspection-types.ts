import type {
	ProgrammaticSource,
	ResolvedProgrammaticResource,
} from "@opencut/editor-contracts";

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
	compositions: InspectedComposition[];
}

export type PreparedRemotionCompile = Pick<
	RemotionInspectionSnapshot,
	"source" | "inputs" | "toolchainLockSha256"
>;
