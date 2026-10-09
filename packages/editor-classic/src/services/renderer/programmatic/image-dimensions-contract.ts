import type { ProgrammaticResource } from "@opencut/editor-contracts";
import type { FontMeasurement } from "./font-metrics-contract";

/** Private transient platform protocol, never part of authored Source. */
export interface ImageDimensionRequest {
	readonly resource: ProgrammaticResource;
}
export interface ImageDimensionMeasurement extends ImageDimensionRequest {
	readonly width: number;
	readonly height: number;
}
/** Encoded-container admission is deliberately distinct from decoded facts. */
export interface ImageDecodeAdmission extends ImageDimensionMeasurement {
	readonly decodedBytes: number;
}
export interface ResourceMeasurements {
	readonly fontMetrics: readonly FontMeasurement[];
	readonly imageDimensions: readonly ImageDimensionMeasurement[];
}
