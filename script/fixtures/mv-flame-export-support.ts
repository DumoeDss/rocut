import { flameCases } from "./mv-flame-cases";

export const FLAME_EXPORT = {
	width: 1920,
	height: 1080,
	frames: 165,
	fps: 60,
	outputStep: 2000,
	sourceStep: 2000,
} as const;
export const FLAME_EXPORT_BLANKS = [0, 41, 82, 123, 164] as const;
export const FLAME_EXPORT_CLIPS = flameCases().flatMap((item, caseIndex) =>
	item.indices.map((sourceIndex, sampleIndex) => ({
		id: `flame-${caseIndex}-${sampleIndex}`,
		label: item.label,
		caseIndex,
		start: 1 + caseIndex * 10 + Math.floor(caseIndex / 4) + sampleIndex,
		duration: 1,
		trimSourceFrame: sourceIndex,
	})),
);

export function flameExportSample(frame: number) {
	if (!Number.isSafeInteger(frame) || frame < 0 || frame >= FLAME_EXPORT.frames)
		throw Error("Invalid Flame export frame");
	const clip = FLAME_EXPORT_CLIPS.find((c) => frame === c.start);
	return clip ? { clip, sourceIndex: clip.trimSourceFrame } : null;
}
