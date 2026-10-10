export interface RemotionMetadataAdapterIdentity {
	id: "rocut-remotion-html";
	version: 2;
	sha256: string;
}
export interface RemotionMetadataBinding {
	adapter: RemotionMetadataAdapterIdentity;
	inspectionRevision: string;
	toolchainLockSha256: string;
	compositionId: string;
	inputPropsSha256: string;
	width: number;
	height: number;
	durationFrames: number;
	frameRate: { numerator: number; denominator: number };
}
export interface RemotionMetadataReceipt extends RemotionMetadataBinding {
	version: 1;
	returnedProps: Record<string, unknown>;
}
/** Adapter-normalized native result, never a substitute for calculateMetadata. */
export interface RemotionResolvedMetadata {
	compositionId: string;
	width: number;
	height: number;
	fps: number;
	durationFrames: number;
	props: Record<string, unknown>;
}
export interface RemotionMetadataValidation {
	validateReceipt(args: {
		receipt: unknown;
		binding: unknown;
	}): RemotionMetadataReceipt;
	assertRuntimeMetadata(args: {
		receipt: unknown;
		binding: unknown;
		metadata: unknown;
	}): void;
}
