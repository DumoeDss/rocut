/** Fixture-only independent scalar oracle. Never imports production timing,
 * discovery, gain, FX executor, mixing, or graph assembly helpers.
 * The 8192-entry curve reproduces the pinned upstream WaveShaper definition;
 * browser interpolation may differ by float32 ulps, so comparisons are bounded.
 */
const f = Math.fround;
const rate = 44100,
	period = 3528;
const gainA = f(10 ** (6 / 20)),
	busOutput = f(10 ** (-3 / 20));
const sourceGain = 10 ** (-6 / 20);
const curves = new Map();
function saturate(value, thresholdDb) {
	let curve = curves.get(thresholdDb);
	if (!curve) {
		const threshold = 10 ** (thresholdDb / 20);
		curve = Float32Array.from(
			{ length: 8192 },
			(_, i) => Math.tanh(((i / 8191) * 2 - 1) / threshold) * threshold,
		);
		curves.set(thresholdDb, curve);
	}
	const coordinate = (Math.max(-1, Math.min(1, value)) + 1) * 0.5 * 8191;
	const lower = Math.floor(coordinate),
		upper = Math.min(lower + 1, 8191);
	return f(curve[lower] + (curve[upper] - curve[lower]) * (coordinate - lower));
}
export function graphToneSample(frame, channel) {
	const t = (frame / rate) * 2 * Math.PI;
	return f(
		channel
			? -0.4 * Math.sin(t * 875) + 0.1 * Math.sin(t * 1125)
			: 0.55 * Math.sin(t * 625) + 0.15 * Math.sin(t * 1000),
	);
}
export function graphNativeSample(frame, channel, order = "correct") {
	const dry = graphToneSample(frame % period, channel);
	const a = f(f(dry * gainA) * 0.75);
	let b = 0;
	if (frame >= 3528 && frame < 10584)
		b =
			order === "track-gain-first"
				? saturate(f(dry * 0.5), -12)
				: f(saturate(dry, -12) * 0.5);
	const sum = f(a + b);
	const effected =
		order === "bus-before-sum"
			? f(saturate(a, -9) + saturate(b, -9))
			: saturate(order === "bus-gain-first" ? f(sum * 0.5) : sum, -9);
	const postFx = f(effected * busOutput);
	return order === "bus-gain-first" ? postFx : f(postFx * 0.5);
}
export function ordinarySample(frame, channel) {
	return f(
		Math.sin((frame * 997 * 2 * Math.PI) / rate) * (channel ? 0.015 : 0.03),
	);
}
export function expectedTimelineSample(frame, channel) {
	let sample = 0;
	// Editor clip starts at frame 1 and trims source frame 1: sample indices align.
	if (frame >= 1764 && frame < 12348)
		sample += graphNativeSample(frame, channel) * sourceGain;
	if (frame >= 3528 && frame < 12348)
		sample += ordinarySample(frame - 3528, channel);
	return f(sample);
}
