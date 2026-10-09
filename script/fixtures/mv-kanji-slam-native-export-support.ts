/** Output30fps/native60fps; odd trim frames expose accidental frame rounding. */
export const KANJI_SLAM_EXPORT = {
	width: 1920,
	height: 1080,
	frames: 12,
	fps: 30,
	outputStep: 4000,
	sourceStep: 2000,
} as const;
export const KANJI_SLAM_EXPORT_CLIPS = [
	{
		id: "default-small-kana",
		variant: "default",
		start: 1,
		duration: 2,
		trimSourceFrame: 47,
	},
	{
		id: "night-shock",
		variant: "night",
		start: 3,
		duration: 2,
		trimSourceFrame: 31,
	},
	{
		id: "hand-fire-kana",
		variant: "hand",
		start: 6,
		duration: 2,
		trimSourceFrame: 97,
	},
	{
		id: "default-rekick",
		variant: "default",
		start: 8,
		duration: 2,
		trimSourceFrame: 131,
	},
] as const;
export function kanjiSlamExportSampleAt(frame: number) {
	if (
		!Number.isSafeInteger(frame) ||
		frame < 0 ||
		frame >= KANJI_SLAM_EXPORT.frames
	)
		throw Error("Invalid kanjiSlam export fixture frame");
	const clip = KANJI_SLAM_EXPORT_CLIPS.find(
		(item) => frame >= item.start && frame < item.start + item.duration,
	);
	if (!clip) return null;
	return {
		clip,
		sourceIndex:
			clip.trimSourceFrame +
			(frame - clip.start) *
				(KANJI_SLAM_EXPORT.outputStep / KANJI_SLAM_EXPORT.sourceStep),
	};
}
