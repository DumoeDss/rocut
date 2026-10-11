/** Rust-admitted IO geometry. This is not a project-facing capability or an
 * alternative TS admission policy. Clock placement, limits, tails, faders and
 * stage ordering belong to the Rust plan supplied by the host. */
export interface HyperframesFxStage {
	sampleRate: number;
	inputFrames: number;
	expectedOutputFrames: number;
	maxOutputBytes: number;
	normalizedFxChain: unknown;
	nativeFxAutomation: unknown | null;
}

export interface HyperframesFxProvenance {
	/** Nonsecret Electron Host lifetime identity; omitted for standalone. */
	electronHostEpoch?: string;
	nativeVersion: "0.8.139";
	runtimeSha256: string;
	moduleSha256: string;
	packageLockSha256: string;
	packageIntegrity: string;
	adapterVersion: 1;
	adapterSha256: string;
	browser: {
		product: string;
		revision: string;
		jsVersion: string;
		protocolVersion: string;
	};
}

export interface HyperframesFxResult {
	/** Interleaved stereo float32 little-endian. Not clamped or mastered. */
	pcm: Buffer;
	inputSha256: string;
	outputSha256: string;
	provenance: HyperframesFxProvenance;
}

export interface HyperframesFxExecutor {
	readonly provenance: HyperframesFxProvenance;
	/** Complete history only: track-local t=0 or composition-global t=0.
	 * There is intentionally no partial-window/seek/clock-offset argument. */
	run(
		stage: HyperframesFxStage,
		dryStereoF32LE: Uint8Array,
	): Promise<HyperframesFxResult>;
}
