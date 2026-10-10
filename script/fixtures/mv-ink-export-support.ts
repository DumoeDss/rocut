import { inkCases } from "./mv-ink-cases";
export const INK_EXPORT = {
	width: 1920,
	height: 1080,
	frames: 421,
	fps: 60,
	outputStep: 2000,
	sourceStep: 2000,
} as const;
export const INK_EXPORT_BLANKS = Array.from(
	{ length: 13 },
	(_, index) => index * 35,
);
export const INK_EXPORT_CLIPS = inkCases().flatMap((item, caseIndex) =>
	item.indices.map((sourceIndex, sampleIndex) => ({
		id: `ink-${caseIndex}-${sampleIndex}`,
		label: item.label,
		caseIndex,
		start: 1 + caseIndex * 35 + sampleIndex,
		duration: 1,
		trimSourceFrame: sourceIndex,
	})),
);
export function inkExportSample(frame: number) {
	if (!Number.isSafeInteger(frame) || frame < 0 || frame >= INK_EXPORT.frames)
		throw Error("Invalid Ink export frame");
	const clip = INK_EXPORT_CLIPS.find((item) => item.start === frame);
	return clip ? { clip, sourceIndex: clip.trimSourceFrame } : null;
}
