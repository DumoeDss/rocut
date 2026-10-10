/** Finite fixture transport admission, not a compression-ratio promise.
 * Budget the complete fixed film as unpacked RGBA8 plus explicit per-frame
 * WebM block/index/packet allowance and global tracks/cues/seekhead allowance.
 * VP9 4:4:4/quantizer0 may exceed a short-export 256MiB policy; no frames or
 * encoder settings are changed to fit transport. Both endpoints use this file.
 */
export const INK_EXPORT_VIDEO_POLICY = Object.freeze({
	width: 1920,
	height: 1080,
	frameCount: 421,
	bytesPerPixel: 4,
	perFrameContainerBytes: 64 * 1024,
	globalContainerBytes: 4 * 1024 * 1024,
});
export const INK_EXPORT_VIDEO_FRAME_PAYLOAD_BYTES =
	INK_EXPORT_VIDEO_POLICY.width *
	INK_EXPORT_VIDEO_POLICY.height *
	INK_EXPORT_VIDEO_POLICY.bytesPerPixel *
	INK_EXPORT_VIDEO_POLICY.frameCount;
export const INK_EXPORT_VIDEO_CONTAINER_BYTES =
	INK_EXPORT_VIDEO_POLICY.perFrameContainerBytes *
		INK_EXPORT_VIDEO_POLICY.frameCount +
	INK_EXPORT_VIDEO_POLICY.globalContainerBytes;
export const INK_EXPORT_VIDEO_MAX_BYTES =
	INK_EXPORT_VIDEO_FRAME_PAYLOAD_BYTES + INK_EXPORT_VIDEO_CONTAINER_BYTES;

/** @param {number} byteLength */
export function validateInkExportVideoSize(byteLength) {
	if (
		!Number.isSafeInteger(byteLength) ||
		byteLength < 4 ||
		byteLength > INK_EXPORT_VIDEO_MAX_BYTES
	)
		throw Error(
			`Ink binary download length ${byteLength} is outside [4,${INK_EXPORT_VIDEO_MAX_BYTES}] fixed-film transport admission`,
		);
}
