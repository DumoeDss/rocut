import type { FrameRate } from "./domain";
import type { MvCamera, MvRole } from "./mv-recipe";
import type { ProgrammaticResource } from "./programmatic-resources";

/** Portable, content-addressed archive. Rust owns admission and all budgets. */
export interface ImageSequenceManifest {
	readonly version: 1;
	readonly shotId: string;
	readonly renderId: string;
	readonly frameRate: FrameRate;
	readonly width: number;
	readonly height: number;
	/** File numbering only; this does not shift the playback clock. */
	readonly firstFileFrame: number;
	readonly alpha: "opaque" | "straight";
	readonly colorSpace: "srgb";
	readonly frames: readonly ProgrammaticResource[];
	readonly provenance: {
		readonly engine: string;
		readonly version: string;
		readonly entryFile: string;
		readonly parameters: Readonly<Record<string, unknown>>;
		readonly originalManifest: ProgrammaticResource;
		readonly sourceFiles: readonly {
			readonly path: string;
			readonly byteLength: number;
			readonly sha256: string;
			readonly parts: readonly ProgrammaticResource[];
		}[];
	};
}

export interface MvImageSequenceScene {
	readonly kind: "imageSequence";
	readonly sequence: string;
	readonly originSourceTicks: number;
	readonly rate: FrameRate;
	readonly role: MvRole;
	readonly view: MvCamera;
}

/** Verified manifest bytes are decoded as data and admitted by Rust. */
export interface ImageSequenceManifestInput {
	readonly resourceId: string;
	readonly manifest: unknown;
}

export interface ImageSequenceManifestLimits extends SequenceImageLimits {
	readonly maxFrames: number;
	readonly maxManifests: number;
	readonly maxClosureBytes: number;
	readonly maxSourceBytes: number;
	readonly maxResourceBytes: number;
	readonly maxManifestBytes: number;
	readonly maxSourceFiles: number;
	readonly maxSourceParts: number;
	readonly maxParameterDepth: number;
	readonly maxParameterElements: number;
	readonly maxParameterStringBytes: number;
	readonly maxParameterBytes: number;
}

export interface ImageSequenceManifestValidation {
	readonly manifest: ImageSequenceManifest;
	readonly dependencies: readonly ProgrammaticResource[];
	readonly limits: ImageSequenceManifestLimits;
}

/** Selected by Rust for this exact frame, after reference-clock remapping. */
export interface SequenceImage {
	readonly imageKey: string;
	readonly manifestId: string;
	readonly manifestSha256: string;
	readonly ordinal: number;
	readonly resource: ProgrammaticResource;
	readonly width: number;
	readonly height: number;
	readonly alpha: "opaque" | "straight";
}

export interface SequenceImageLimits {
	readonly maxDimension: number;
	readonly maxDecodedBytes: number;
}

/** Transient selected bytes only; never embedded in the saved project. */
export interface ResolvedSequenceImage {
	readonly imageKey: string;
	readonly resource: ProgrammaticResource;
	readonly body: ArrayBuffer;
}
