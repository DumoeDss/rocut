import { canEncodeVideo, type VideoEncodingConfig } from "mediabunny";
import type { ExportOptions } from "../../export";
import {
	ExportCancelledError,
	waitForExportOperation,
} from "./export-cancellation";
import { resolveHighChromaVideoOptions } from "./export-video-chroma";

/** Prefer an available software export path; keep unsupported hosts on their existing path. */
export async function resolveExportVideoOptions({
	codec,
	width,
	height,
	bitrate,
	videoChroma,
	fullCodecString,
	frameRate,
	signal,
}: Pick<VideoEncodingConfig, "codec" | "bitrate"> & {
	width: number;
	height: number;
	videoChroma?: ExportOptions["videoChroma"];
	fullCodecString?: string;
	frameRate?: number;
	signal?: AbortSignal;
}): Promise<VideoEncodingConfig> {
	if (videoChroma === "444") {
		if (
			codec !== "vp9" ||
			typeof bitrate !== "number" ||
			!fullCodecString ||
			!frameRate
		)
			throw new Error("Missing high-fidelity WebM codec plan");
		return resolveHighChromaVideoOptions({
			width,
			height,
			bitrate,
			frameRate,
			fullCodecString,
			signal,
		});
	}
	try {
		const probe = () =>
			canEncodeVideo(codec, {
				width,
				height,
				bitrate,
				hardwareAcceleration: "prefer-software",
			});
		if (
			await (signal
				? waitForExportOperation({ signal, operation: probe })
				: probe())
		)
			return { codec, bitrate, hardwareAcceleration: "prefer-software" };
	} catch (error) {
		if (error instanceof ExportCancelledError) throw error;
		// A failed optional capability probe must not remove the prior encoder path.
	}
	return { codec, bitrate };
}
