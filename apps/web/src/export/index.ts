import type { FrameRate } from "opencut-wasm";
import type { SessionResources } from "@/editor/session/resources";
import { EXPORT_MIME_TYPES } from "./mime-types";

export const EXPORT_QUALITY_VALUES = [
	"low",
	"medium",
	"high",
	"very_high",
] as const;

export const EXPORT_FORMAT_VALUES = ["mp4", "webm"] as const;

export type ExportFormat = (typeof EXPORT_FORMAT_VALUES)[number];
export type ExportQuality = (typeof EXPORT_QUALITY_VALUES)[number];

export interface ExportOptions {
	format: ExportFormat;
	quality: ExportQuality;
	fps?: FrameRate;
	includeAudio?: boolean;
}

export interface ExportResult {
	success: boolean;
	buffer?: ArrayBuffer;
	error?: string;
	cancelled?: boolean;
}

export interface ExportState {
	isExporting: boolean;
	progress: number;
	result: ExportResult | null;
}

export function getExportMimeType({
	format,
}: {
	format: ExportFormat;
}): string {
	return EXPORT_MIME_TYPES[format];
}

export function getExportFileExtension({
	format,
}: {
	format: ExportFormat;
}): string {
	return `.${format}`;
}

export function downloadBuffer({
	buffer,
	filename,
	mimeType,
	resources,
}: {
	buffer: ArrayBuffer;
	filename: string;
	mimeType: string;
	resources: Pick<SessionResources, "createObjectUrl">;
}): void {
	const blob = new Blob([buffer], { type: mimeType });
	const urlHandle = resources.createObjectUrl({ blob });
	let downloadLink: HTMLAnchorElement | null = null;
	try {
		downloadLink = document.createElement("a");
		downloadLink.href = urlHandle.url;
		downloadLink.download = filename;
		document.body.appendChild(downloadLink);
		downloadLink.click();
	} finally {
		try {
			if (downloadLink?.parentNode === document.body) {
				document.body.removeChild(downloadLink);
			}
		} finally {
			urlHandle.revoke();
		}
	}
}
