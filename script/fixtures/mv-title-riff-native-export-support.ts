/** Fixture schedule only: output is30fps, native sources/oracle are60fps. */
export const TITLE_RIFF_EXPORT = {
	width: 1920,
	height: 1080,
	frames: 12,
	fps: 30,
	outputStep: 4000,
	sourceStep: 2000,
} as const;

export const TITLE_RIFF_EXPORT_CLIPS = [
	{
		id: "intro-monument",
		variant: "intro",
		start: 1,
		duration: 1,
		trimSourceFrame: 107,
	},
	{
		id: "intro-split",
		variant: "intro",
		start: 2,
		duration: 1,
		trimSourceFrame: 229,
	},
	{
		id: "intro-silhouette",
		variant: "intro",
		start: 3,
		duration: 2,
		trimSourceFrame: 413,
	},
	{
		id: "outro-recap",
		variant: "outro",
		start: 6,
		duration: 2,
		trimSourceFrame: 163,
	},
	{
		id: "outro-lockup-final",
		variant: "outro",
		start: 8,
		duration: 2,
		trimSourceFrame: 293,
	},
] as const;

export function titleRiffExportSampleAt(frame: number) {
	if (
		!Number.isSafeInteger(frame) ||
		frame < 0 ||
		frame >= TITLE_RIFF_EXPORT.frames
	)
		throw Error("Invalid titleRiff export fixture frame");
	const clip = TITLE_RIFF_EXPORT_CLIPS.find(
		(item) => frame >= item.start && frame < item.start + item.duration,
	);
	if (!clip) return null;
	return {
		clip,
		sourceIndex:
			clip.trimSourceFrame +
			(frame - clip.start) *
				(TITLE_RIFF_EXPORT.outputStep / TITLE_RIFF_EXPORT.sourceStep),
	};
}
