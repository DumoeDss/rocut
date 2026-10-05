import type { PlannedClipExport } from "opencut-wasm";
import type { ExportOptions, ExportResult } from ".";
import { mediaTime } from "../wasm/media-time";

/** Browser rendering/download orchestration; range selection and names come from Rust. */
export async function runClipExportBatch({
	clips,
	options,
	signal,
	assertCurrent,
	render,
	publish,
	onClip,
}: {
	clips: readonly PlannedClipExport[];
	options: Omit<ExportOptions, "range">;
	signal: AbortSignal;
	assertCurrent: () => void;
	render: (options: ExportOptions) => Promise<ExportResult>;
	publish: (output: { buffer: ArrayBuffer; filename: string }) => void;
	onClip: (progress: {
		index: number;
		completed: number;
		name: string;
	}) => void;
}): Promise<{ completed: number; cancelled: boolean; error?: string }> {
	let completed = 0;
	try {
		for (const [index, clip] of clips.entries()) {
			if (signal.aborted) return { completed, cancelled: true };
			assertCurrent();
			onClip({ index, completed, name: clip.name });
			const result = await render({
				...options,
				range: {
					startTime: mediaTime({ ticks: clip.startTime }),
					endTime: mediaTime({ ticks: clip.endTime }),
				},
			});
			if (signal.aborted || result.cancelled)
				return { completed, cancelled: true };
			assertCurrent();
			if (!result.success || !result.buffer)
				throw new Error(result.error ?? "Export produced no media");
			publish({
				buffer: result.buffer,
				filename: `${clip.filenameStem}.${options.format}`,
			});
			completed += 1;
		}
		return { completed, cancelled: false };
	} catch (error) {
		return {
			completed,
			cancelled: signal.aborted,
			error: error instanceof Error ? error.message : String(error),
		};
	}
}
