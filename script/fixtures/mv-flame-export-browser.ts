import type { FlameReference } from "./mv-flame-oracle-contract";
import { exportFlame } from "./mv-flame-export-render";
import {
	publishFlameExportVideo,
	type FlameExportVideoMetadata,
} from "./mv-flame-export-video";
declare global {
	interface Window {
		__flameExportReference: FlameReference;
		__flameExportProgress?: unknown;
		__flameExportResult?: unknown;
		__writeFlameExportOraclePng: (
			frame: number,
			base64: string,
		) => Promise<void>;
		__acceptFlameExportDownload: (
			metadata: FlameExportVideoMetadata,
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
window.__flameExportProgress = progress;
void exportFlame({
	reference: window.__flameExportReference,
	writePng: window.__writeFlameExportOraclePng,
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
			const encodedVideo = await publishFlameExportVideo({
				buffer: bytes,
				accept: window.__acceptFlameExportDownload,
			});
			window.__flameExportResult = { ...metadata, encodedVideo };
		} catch (error) {
			window.__flameExportResult = {
				passed: false,
				error: String(
					error instanceof Error ? (error.stack ?? error.message) : error,
				).slice(0, 4000),
				progress,
			};
		}
	},
	(error) => {
		window.__flameExportResult = {
			passed: false,
			error: String(error?.stack ?? error),
			progress,
		};
	},
);
