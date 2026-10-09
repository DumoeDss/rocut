import type { ProgrammaticResource } from "./programmatic-resources";

/** Transient Rust-issued request; never authored pixels or a budget override. */
export interface MvImagePreprocessBinding {
	readonly resource: ProgrammaticResource;
	readonly width: number;
	readonly height: number;
	readonly flameAt: readonly [number, number, number, number, number, number];
	readonly algorithm: "flame-deflame-v1";
}

export interface MvImagePreprocessRoi {
	readonly x: number;
	readonly y: number;
	readonly width: number;
	readonly height: number;
}

export interface MvImagePreprocessRequest {
	readonly binding: MvImagePreprocessBinding;
	readonly roi: MvImagePreprocessRoi;
}

export interface MvPreparedPatchCommand {
	readonly kind: "preparedPatch";
	readonly request: MvImagePreprocessRequest;
	/** Opaque Rust canonical identity. Clients never construct or interpret it. */
	readonly patchKey: string;
}
