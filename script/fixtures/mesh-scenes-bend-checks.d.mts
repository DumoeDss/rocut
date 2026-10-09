import type { MvBendTransition } from "@opencut/editor-contracts";
import type {
	MeshImages,
	MeshOracleFrame,
	MeshPixelComparison,
	MeshProbeContext,
	MeshProbeResult,
} from "./mesh-scenes-contract";

export interface BendEvidence {
	comparisons: MeshPixelComparison[];
	temporal: Record<MvBendTransition["direction"], Record<number, string>>;
	opaqueCrackFrames: number;
	fractionalEdgeOn: {
		hinge: number;
		pixelBoundary: number;
		frame: number;
		fullFrameExact: boolean;
	};
	oracle: string;
	boundaries: string;
}

export function bendStyle(
	direction?: MvBendTransition["direction"],
): MvBendTransition;
export function inverseBendPoint(
	x: number,
	y: number,
	width: number,
	height: number,
	progress: number,
	style: MvBendTransition,
): {
	q: number;
	hinge: number;
	hit: boolean;
	uv: [number, number];
	brightness: number;
};
export function bendOracle(
	images: MeshImages,
	frame: number,
	width: number,
	height: number,
	style?: MvBendTransition,
	duration?: number,
): MeshOracleFrame & {
	mask: Uint8Array;
	counts?: Record<"mesh" | "flatA" | "baseB" | "partial" | "clear", number>;
};
export function checkBendScenes(
	context: MeshProbeContext,
): Promise<MeshProbeResult<BendEvidence>>;
