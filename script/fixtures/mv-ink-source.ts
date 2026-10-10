import type { InkFrame, InkSong } from "./mv-ink-contract";

/** Fixture timeline plumbing only. Quantization/beat-lurch remain in dark.js. */
export function inkSample({
	frame,
	index,
	fps = 60,
}: {
	frame: InkFrame;
	index: number;
	fps?: number;
}): InkFrame {
	if (
		!Number.isSafeInteger(index) ||
		index < 0 ||
		!Number.isFinite(fps) ||
		fps <= 0 ||
		index / fps >= frame.duration
	)
		throw Error("Ink sample is outside the explicit frame grid");
	return {
		...frame,
		time: frame.shotStart + index / fps,
		args: { ...frame.args },
	};
}
export function validateInkContext({
	frame,
	song,
}: {
	frame: InkFrame;
	song: InkSong;
}): void {
	if (
		!Number.isFinite(frame.shotStart) ||
		frame.shotStart < 0 ||
		!Number.isFinite(frame.duration) ||
		frame.duration <= 0 ||
		!Number.isFinite(frame.time) ||
		frame.time < frame.shotStart ||
		frame.time >= frame.shotStart + frame.duration
	)
		throw Error("Invalid explicit Ink shot context");
	if (
		!frame.args.char ||
		![frame.args.h, frame.args.x, frame.args.y].every(
			(value) => value === undefined || Number.isFinite(value),
		) ||
		(frame.args.h !== undefined && frame.args.h <= 0) ||
		(frame.args.seed !== undefined &&
			(!Number.isSafeInteger(frame.args.seed) ||
				frame.args.seed < 0 ||
				frame.args.seed > 0xffffffff))
	)
		throw Error("Invalid explicit Ink author arguments");
	if (
		!Number.isFinite(song.bpm) ||
		song.bpm <= 0 ||
		!Number.isSafeInteger(song.downbeatIndex0) ||
		song.beats.length === 0 ||
		!song.beats.every(
			(time, index) =>
				Number.isFinite(time) &&
				time >= 0 &&
				(index === 0 || time > song.beats[index - 1]!),
		)
	)
		throw Error("Invalid explicit Ink song clock");
}
