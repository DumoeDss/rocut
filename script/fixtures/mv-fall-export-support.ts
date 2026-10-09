export const FALL_EXPORT = {
	width: 1920,
	height: 1080,
	frames: 12,
	fps: 30,
	outputStep: 4000,
	sourceStep: 2000,
} as const;
export const FALL_EXPORT_CLIPS = [
	{
		id: "default-fall",
		label: "default",
		start: 1,
		duration: 2,
		trimSourceFrame: 177,
	},
	{
		id: "reviewed-hold",
		label: "reviewed-stops",
		start: 3,
		duration: 2,
		trimSourceFrame: 83,
	},
	{
		id: "explicit-pulses",
		label: "explicit-placement",
		start: 6,
		duration: 2,
		trimSourceFrame: 151,
	},
	{
		id: "overlap-release",
		label: "overlapping-unsorted",
		start: 8,
		duration: 2,
		trimSourceFrame: 167,
	},
] as const;
export function fallExportSample(frame: number) {
	if (!Number.isSafeInteger(frame) || frame < 0 || frame >= FALL_EXPORT.frames)
		throw Error("Invalid Fall export frame");
	const clip = FALL_EXPORT_CLIPS.find(
		(c) => frame >= c.start && frame < c.start + c.duration,
	);
	return clip
		? { clip, sourceIndex: clip.trimSourceFrame + (frame - clip.start) * 2 }
		: null;
}
