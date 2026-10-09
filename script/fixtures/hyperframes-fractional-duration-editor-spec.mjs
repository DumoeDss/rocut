/** Independent fixture inputs and timeline arithmetic. No production kernels. */
export const durationEditorSpec = Object.freeze({
	sampleRate: 44100,
	fps: 25,
	sourceFrames: 18,
	exportFrames: 21,
	clipStartFrame: 2,
	clipDurationFrames: 16,
	clipTrimFrame: 1,
	audioStart: 0.08,
	duration: 0.5 + 0.25 / 48000,
	mediaStart: 0.1 + 0.25 / 44100,
	trackGain: 0.75,
	sourceVolumeDb: -6,
});
export const durationEditorRate = {
	target: "rate",
	points: [
		{ t: 0, v: 0.7, curve: 0.4 },
		{ t: 0.81, v: 1.8 },
	],
};
export const durationEditorFx = [
	{ type: "saturate", params: { threshold: -20 } },
	{ type: "delay", params: { time: 70, feedback: 0.25, mix: 0.7 } },
];
export function durationEditorSourceSample(frame, channel) {
	return (
		0.22 * Math.sin(frame * (channel ? 1.173 : 0.781)) +
		0.13 * Math.sin(frame * frame * 0.000041) +
		(frame % 97 === 0 ? 0.12 : 0)
	);
}
export function durationEditorOrdinarySample(frame, channel) {
	return Math.fround(
		Math.sin((frame * 997 * 2 * Math.PI) / 44100) * (channel ? 0.015 : 0.03),
	);
}
export function durationEditorTimelineSample(source, frame, channel) {
	let value = 0;
	// Source .04-.68 appears at timeline .08-.72; .16-.68 has ordinary audio.
	if (frame >= 3528 && frame < 31752)
		value +=
			source.getFloat32((frame - 1764) * 8 + channel * 4, true) *
			10 ** (-6 / 20);
	if (frame >= 7056 && frame < 29988)
		value += durationEditorOrdinarySample(frame - 7056, channel);
	return Math.fround(value);
}
