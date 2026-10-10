export const INK_EXPORT_VIDEO_POLICY: Readonly<{
	width: number;
	height: number;
	frameCount: number;
	bytesPerPixel: number;
	perFrameContainerBytes: number;
	globalContainerBytes: number;
}>;
export const INK_EXPORT_VIDEO_FRAME_PAYLOAD_BYTES: number;
export const INK_EXPORT_VIDEO_CONTAINER_BYTES: number;
export const INK_EXPORT_VIDEO_MAX_BYTES: number;
export function validateInkExportVideoSize(byteLength: number): void;
