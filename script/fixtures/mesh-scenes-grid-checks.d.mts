import type {
	MeshPixelComparison,
	MeshProbeContext,
	MeshProbeResult,
} from "./mesh-scenes-contract";

export interface GridEvidence {
	comparisons: MeshPixelComparison[];
	transparent: number;
	partial: number;
	controlSensitivity: Record<string, number>;
	depthSensitive: number;
	perspectiveSensitive: number;
	completeUvSensitive: number;
	frameHashes: Record<number, string>;
	neutralMidpointUsesFullImageOracle: boolean;
}

export function checkGridScenes(
	context: MeshProbeContext,
): Promise<MeshProbeResult<GridEvidence>>;
