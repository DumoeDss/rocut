import type { MvHexFloat, MvMeshFace } from "@opencut/editor-contracts";
import type {
	MeshPixelComparison,
	MeshProbeContext,
	MeshProbeResult,
} from "./mesh-scenes-contract";

export interface HexEvidence {
	comparisons: MeshPixelComparison[];
	transparent: number;
	partial: number;
	depthSensitive: number;
	perspectiveSensitive: number;
	frameHashes: Record<number, string>;
	neutralMidpointUsesFullImageOracle: boolean;
}

export function hexGeometry(
	settings: MvHexFloat,
	progress: number,
	width: number,
	height: number,
	seed: number,
): MvMeshFace[];
export function checkHexScenes(
	context: MeshProbeContext,
): Promise<MeshProbeResult<HexEvidence>>;
