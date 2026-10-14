/** Facts about encoded source bytes, never decoder output or authored metadata. */
export interface MediaFacts {
	readonly schemaVersion: 1;
	readonly source: "byte-probe";
	readonly sha256: string;
	readonly frameRate?: {
		readonly numerator: number;
		readonly denominator: number;
		readonly mode: "constant" | "variable" | "average";
		readonly samples: number;
		readonly complete: boolean;
	};
	/** Encoded alpha capability, not a claim that any pixel is transparent. */
	readonly alpha?: boolean;
	readonly animation?: {
		readonly frameCount: number;
		readonly loopCount?: number;
		readonly durationTicks?: number;
	};
	readonly audio?: {
		readonly channels: number;
		readonly sampleRate: number;
		readonly layout?: string;
	};
}
