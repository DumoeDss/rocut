export interface HeadlessProofControlExecution {
	readonly identity: string;
	dispose(): void | Promise<void>;
}

/** Neutral side of the C7 build-sensitivity seam. */
export async function runHeadlessProofControl(): Promise<HeadlessProofControlExecution> {
	return {
		identity: "neutral",
		dispose() {},
	};
}
