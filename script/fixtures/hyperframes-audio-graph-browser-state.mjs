import { chainTailSeconds } from "/upstream/audio/audioFxTail.js";
import {
	chain,
	check,
	distance,
	nativeRender,
	pcmArtifact,
	rate,
	slice,
	source,
} from "./hyperframes-audio-graph-browser-support.mjs";

async function primitiveFeedbackControl(channels, frames) {
	const context = new OfflineAudioContext(2, frames, rate);
	const input = source(context, channels),
		delay = context.createDelay(5),
		feedback = context.createGain();
	delay.delayTime.value = 0.1;
	feedback.gain.value = 0.5;
	input.connect(delay);
	delay.connect(feedback).connect(delay);
	delay.connect(context.destination);
	input.start();
	try {
		const output = await context.startRendering();
		return [output.getChannelData(0).slice(), output.getChannelData(1).slice()];
	} finally {
		input.disconnect();
		delay.disconnect();
		feedback.disconnect();
	}
}

export async function verifyState() {
	const dry = [new Float32Array(rate), new Float32Array(rate)];
	dry[0][0] = 1;
	dry[1][0] = -0.5;
	const delay = chain([
		{ type: "delay", params: { time: 100, feedback: 0.5, mix: 1 } },
	]);
	const tail = chainTailSeconds(delay),
		full = await nativeRender(dry, delay);
	check(
		tail === 1 && full[0].length === rate + Math.ceil(tail * rate),
		"Native delay tail budget/PCM extent changed",
	);
	const start = 7200,
		end = 16800,
		cropped = slice(full, start, end);
	const warmedPrefix = await nativeRender(slice(dry, 0, end), delay);
	check(
		distance(cropped, slice(warmedPrefix, start, end)).max === 0,
		"Warm-from-zero prefix crop differs from complete stateful output",
	);
	const reset = await nativeRender(slice(dry, start, end), delay),
		resetCrop = slice(reset, 0, end - start);
	const resetDifference = distance(cropped, resetCrop);
	check(
		resetDifference.max > 0.49,
		"Reset local render incorrectly appeared equivalent to preserved delay history",
	);
	const peak = (pcm, around) =>
		Math.max(...pcm.subarray(around - 2, around + 3));
	const nativePeaks = [];
	for (let i = 1; i + 1 < full[0].length; i++)
		if (
			full[0][i] > 0.0001 &&
			full[0][i] > full[0][i - 1] &&
			full[0][i] >= full[0][i + 1]
		)
			nativePeaks.push({ sample: i, value: full[0][i] });
	const primitive = await primitiveFeedbackControl(dry, full[0].length);
	const primitiveError = distance(full, primitive);
	check(
		primitiveError.max === 0,
		`Native feedback differs from independent bare WebAudio control: ${JSON.stringify(primitiveError)}`,
	);
	// A real feedback cycle in this Chromium adds one 128-sample quantum per
	// repeat. Keep the observed limitation explicit; do not pretend the ideal
	// arithmetic positions (4800, 9600, 14400) described the browser PCM.
	for (const [i, sample] of [4800, 9728, 14656].entries())
		check(
			nativePeaks[i]?.sample === sample && nativePeaks[i]?.value === 0.5 ** i,
			`Observed feedback quantum/amplitude changed at ${i}: ${JSON.stringify(nativePeaks.slice(0, 12))}`,
		);
	const shortInput = slice(dry, 0, 2400),
		tailed = await nativeRender(shortInput, delay);
	check(
		tailed[0].length === 2400 + rate,
		"Short source did not retain native tail allocation",
	);
	check(
		peak(tailed[0], 4800) > 0.99,
		"Tail was cut at the end of the dry source",
	);
	const repeated = await nativeRender(dry, delay);
	check(
		distance(repeated, full).max === 0,
		"Native stateful offline render is not deterministic across new contexts",
	);
	return {
		name: "stateful-warm-crop-and-native-tail",
		tailSeconds: tail,
		fullFrames: full[0].length,
		shortDryFrames: 2400,
		shortWithTailFrames: tailed[0].length,
		crop: { start, end, warmError: 0, resetDifference },
		nativePeaks: nativePeaks.slice(0, 12),
		primitiveControlError: primitiveError,
		feedbackQuantumExtraSamples: 128,
		upstreamLimit:
			"Native tail math budgets ideal delay repeats; actual Chromium feedback adds 128 samples per repeat. The -60 dB/capped allocation neither models that overhead nor proves an infinite feedback process reaches exact zero.",
		artifacts: [
			await pcmArtifact("delay-full.f32", full),
			await pcmArtifact("delay-correct-crop.f32", cropped),
			await pcmArtifact("delay-reset-window.f32", resetCrop),
		],
	};
}
