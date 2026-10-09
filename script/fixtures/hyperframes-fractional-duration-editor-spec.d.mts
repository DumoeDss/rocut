export const durationEditorSpec: Readonly<{
	sampleRate: number;
	fps: number;
	sourceFrames: number;
	exportFrames: number;
	clipStartFrame: number;
	clipDurationFrames: number;
	clipTrimFrame: number;
	audioStart: number;
	duration: number;
	mediaStart: number;
	trackGain: number;
	sourceVolumeDb: number;
}>;
export const durationEditorRate: {
	target: "rate";
	points: { t: number; v: number; curve?: number }[];
};
export const durationEditorFx: {
	type: string;
	params: Record<string, number>;
}[];
export function durationEditorSourceSample(
	frame: number,
	channel: number,
): number;
export function durationEditorOrdinarySample(
	frame: number,
	channel: number,
): number;
export function durationEditorTimelineSample(
	source: DataView,
	frame: number,
	channel: number,
): number;
