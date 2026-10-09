import { durationEditorOrdinarySample } from "./hyperframes-fractional-duration-editor-spec.mjs";

/** Independent inputs; source/export extend beyond the original terminal trim. */
export const exportTimingEditorSpec = Object.freeze({
	sampleRate: 44100,
	fps: 25,
	sourceFrames: 27,
	exportFrames: 30,
	clipStartFrame: 2,
	clipDurationFrames: 25,
	clipTrimFrame: 1,
	cropStartFrame: 22,
	cropFrames: 5,
	duration: 0.5 + 0.25 / 48000,
	mediaStart: 0.1 + 0.25 / 44100,
	trackGain: 0.75,
	sourceVolumeDb: -6,
});
export const exportTimingEditorCases = Object.freeze([
	Object.freeze({
		id: "aligned-default",
		start: 3529 / 44100,
		timing: undefined,
		encode: false,
	}),
	Object.freeze({
		id: "aligned-native",
		start: 3529 / 44100,
		timing: "native-exporter",
		encode: true,
	}),
	Object.freeze({
		id: "fractional-native",
		start: 0.08051,
		timing: "native-exporter",
		encode: true,
	}),
]);
export function exportTimingEditorCase(id) {
	const result = exportTimingEditorCases.find((item) => item.id === id);
	if (!result) throw Error("Unknown explicit timing editor case: " + id);
	return result;
}
export function exportTimingEditorTimelineSample(source, frame, channel) {
	let value = 0;
	// Source .04–1.04 appears at .08–1.08. Ordinary audio ends before the FX tail.
	if (frame >= 3528 && frame < 47628)
		value +=
			source.getFloat32((frame - 1764) * 8 + channel * 4, true) *
			10 ** (-6 / 20);
	if (frame >= 7056 && frame < 29988)
		value += durationEditorOrdinarySample(frame - 7056, channel);
	return Math.fround(value);
}
