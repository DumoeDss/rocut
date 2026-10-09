export const THREAD_EXPORT = {
	width: 1920,
	height: 1080,
	frames: 12,
	fps: 30,
	outputStep: 4000,
	sourceStep: 2000,
} as const;
export const THREAD_EXPORT_CLIPS = [
	{
		id: "default-tug",
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
		id: "explicit-arrival",
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
export function threadExportSample(frame: number) {
	if (
		!Number.isSafeInteger(frame) ||
		frame < 0 ||
		frame >= THREAD_EXPORT.frames
	)
		throw Error("Invalid Thread export frame");
	const clip = THREAD_EXPORT_CLIPS.find(
		(c) => frame >= c.start && frame < c.start + c.duration,
	);
	return clip
		? { clip, sourceIndex: clip.trimSourceFrame + (frame - clip.start) * 2 }
		: null;
}
