import type { ExportOptions, ExportVideoChroma } from "./index";

export const DEFAULT_VIDEO_CHROMA: ExportVideoChroma = "420";

/** UI default omits the new option, preserving the existing export path. */
export function selectedVideoChroma(
	videoChroma: ExportVideoChroma,
): Pick<ExportOptions, "videoChroma"> {
	return videoChroma === "444" ? { videoChroma } : {};
}

export const DEFAULT_EXPORT_OPTIONS = {
	format: "mp4",
	quality: "high",
	includeAudio: true,
} satisfies ExportOptions;
