import type { InkReference } from "./mv-ink-contract";
import { exportInk } from "./mv-ink-export-render";
import {
	publishInkExportVideo,
	type InkExportVideoMetadata,
} from "./mv-ink-export-video";
declare global {
	interface Window {
		__inkExportReference: InkReference;
		__inkExportProgress?: unknown;
		__inkExportResult?: unknown;
		__writeInkExportOraclePng: (frame: number, base64: string) => Promise<void>;
		__acceptInkExportDownload: (
			metadata: InkExportVideoMetadata,
		) => Promise<void>;
	}
}
const progress: {
	current: string;
	gpuCompleted: number;
	lastGpuFrame: number | null;
	encoderFrame: number | null;
} = {
	current: "export/assets",
	gpuCompleted: 0,
	lastGpuFrame: null,
	encoderFrame: null,
};
window.__inkExportProgress = progress;
void exportInk({
	reference: window.__inkExportReference,
	writePng: window.__writeInkExportOraclePng,
	advance: (message) => {
		progress.current = message;
	},
	onProgress: (state) => {
		Object.assign(progress, state);
	},
}).then(
	async (result) => {
		try {
			progress.current = "export/binary-download";
			const { bytes, ...metadata } = result;
			const encodedVideo = await publishInkExportVideo({
				buffer: bytes,
				accept: window.__acceptInkExportDownload,
			});
			window.__inkExportResult = { ...metadata, encodedVideo };
		} catch (error) {
			window.__inkExportResult = {
				passed: false,
				encodedByteLength: result.bytes.byteLength,
				completedBrowserStages: {
					gpuFrames: result.gpuObservations.length,
					encodedFrames: result.frameCount,
					width: result.exportSize.width,
					height: result.exportSize.height,
					fps: result.fps,
					sourceFrames: result.sourceFrames,
					repeats: result.repeats,
				},
				error: String(
					error instanceof Error ? (error.stack ?? error.message) : error,
				).slice(0, 4000),
				progress: { ...progress },
			};
		}
	},
	(error) => {
		window.__inkExportResult = {
			passed: false,
			encodedByteLength: null,
			error: String(error?.stack ?? error).slice(0, 4000),
			progress: { ...progress },
		};
	},
);
