import { resolveVideoExportJson, type FrameRate } from "opencut-wasm";
import type { ExportQuality } from "../../export";

export function resolveExportVideoBitrate(request: {
	codec: "avc" | "vp9";
	quality: ExportQuality;
	width: number;
	height: number;
	frameRate: FrameRate;
}): number {
	const result: { bitrate?: number; error?: string } = JSON.parse(
		resolveVideoExportJson(JSON.stringify(request)),
	);
	if (result.error || typeof result.bitrate !== "number")
		throw new Error(result.error ?? "Missing video export bitrate");
	return result.bitrate;
}
