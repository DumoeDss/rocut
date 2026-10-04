import { canEncodeVideo, type VideoEncodingConfig } from "mediabunny";

/** Prefer an available software export path; keep unsupported hosts on their existing path. */
export async function resolveExportVideoOptions({
	codec,
	width,
	height,
	bitrate,
}: Pick<VideoEncodingConfig, "codec" | "bitrate"> & {
	width: number;
	height: number;
}): Promise<VideoEncodingConfig> {
	try {
		if (
			await canEncodeVideo(codec, {
				width,
				height,
				bitrate,
				hardwareAcceleration: "prefer-software",
			})
		)
			return { codec, bitrate, hardwareAcceleration: "prefer-software" };
	} catch {
		// A failed optional capability probe must not remove the prior encoder path.
	}
	return { codec, bitrate };
}
