/** Optional, bounded native decoding of an already imported project attachment. */
export interface MediaPreviewProvider {
	renderFrame(args: {
		readonly mediaId: string;
		readonly sourceSha256: string;
		readonly timeSeconds: number;
		readonly signal: AbortSignal;
	}): Promise<{
		readonly body: ArrayBuffer;
		readonly mimeType: "image/png";
	} | null>;
}
