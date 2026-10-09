export interface ExportTimingEditorCase {
	readonly id: string;
	readonly start: number;
	readonly timing: "native-exporter" | undefined;
	readonly encode: boolean;
}
export const exportTimingEditorSpec: Readonly<{
	sampleRate: number;
	fps: number;
	sourceFrames: number;
	exportFrames: number;
	clipStartFrame: number;
	clipDurationFrames: number;
	clipTrimFrame: number;
	cropStartFrame: number;
	cropFrames: number;
	duration: number;
	mediaStart: number;
	trackGain: number;
	sourceVolumeDb: number;
}>;
export const exportTimingEditorCases: readonly ExportTimingEditorCase[];
export function exportTimingEditorCase(id: string): ExportTimingEditorCase;
export function exportTimingEditorTimelineSample(
	source: DataView,
	frame: number,
	channel: number,
): number;
