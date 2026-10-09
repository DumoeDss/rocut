import type {
	ProgrammaticSource,
	ResolvedProgrammaticResource,
} from "@opencut/editor-contracts";
import type { GeneratorCapture } from "./generator-capture";

export interface MeshOracleFrame {
	pixels: Uint8ClampedArray;
	mask?: Uint8Array;
}

export interface MeshSnapshot {
	label: string;
	width: number;
	height: number;
	pixels: Uint8ClampedArray;
}

export interface MeshPixelComparison {
	label: string;
	pixels: number;
	coverage: number;
	maxPremul: number;
	maxAlpha: number;
	meanPremul: number;
	meanAlpha: number;
}

export interface MeshPixelOptions {
	label?: string;
	mask?: Uint8Array;
	maxPremul?: number;
	maxAlpha?: number;
	meanPremul?: number;
	minPixels?: number;
}

export type MeshImages = Record<"a" | "b", ImageBitmap>;

export interface MeshProbeContext {
	capture: GeneratorCapture;
	resources: ResolvedProgrammaticResource[];
	images: MeshImages;
}

export interface MeshProbeResult<Evidence> {
	evidence: Evidence;
	snapshots: MeshSnapshot[];
	exports: {
		name: string;
		source: ProgrammaticSource;
		oracle: (
			frame: number,
			width: number,
			height: number,
		) => MeshOracleFrame | Promise<MeshOracleFrame>;
	}[];
}
