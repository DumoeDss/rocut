import type {
	EmberAudioFacts,
	EmberReferenceFrame,
} from "./mv-ember-reference-contract";

/** Test-oracle inputs are explicit snapshots, not production author defaults. */
export function snapshotEmberAudio(input: EmberAudioFacts): EmberAudioFacts {
	const audio = structuredClone(input);
	if (
		!Number.isInteger(audio.envelopes.fps) ||
		audio.envelopes.fps < 1 ||
		audio.envelopes.fps > 120
	)
		throw Error("Ember oracle requires explicit envelope fps");
	const channels = [
		audio.envelopes.rms,
		audio.envelopes.low,
		audio.envelopes.mid,
		audio.envelopes.high,
		...(audio.envelopes.vocal ? [audio.envelopes.vocal] : []),
	];
	if (
		channels.some(
			(values) =>
				!Array.isArray(values) ||
				!values.length ||
				values.length !== audio.envelopes.rms.length ||
				values.length > 216000 ||
				values.some((value) => !Number.isFinite(value)),
		)
	)
		throw Error(
			"Ember oracle requires complete bounded measured envelope arrays",
		);
	for (const points of [
		audio.beats,
		audio.strongOnsets.map((point) => point.t),
	])
		if (
			points.length > 21600 ||
			points.some(
				(time, index) =>
					!Number.isFinite(time) ||
					time < 0 ||
					(index > 0 && time <= points[index - 1]!),
			)
		)
			throw Error("Ember oracle requires ordered source-second audio events");
	if (
		audio.strongOnsets.some(
			(point) => !Number.isFinite(point.strength) || point.strength > 1,
		)
	)
		throw Error(
			"Ember oracle requires reference-normalized onset strength, not raw magnitude",
		);
	return audio;
}

export function snapshotEmberFrame(
	input: EmberReferenceFrame,
): EmberReferenceFrame {
	const frame = structuredClone(input),
		{ time, shotStart, duration, args } = frame;
	if (
		![time, shotStart, duration, shotStart + duration, args.grain].every(
			Number.isFinite,
		) ||
		shotStart < 0 ||
		duration <= 0 ||
		time < shotStart ||
		time > shotStart + duration ||
		args.grain < 0 ||
		args.grain > 1
	)
		throw Error("Ember oracle requires bounded explicit frame times and grain");
	if (args.mode === "collapse") {
		if (
			!args.bg ||
			!Number.isFinite(args.end) ||
			args.end <= shotStart ||
			args.focus.length !== 2 ||
			!args.focus.every(Number.isFinite)
		)
			throw Error("Ember collapse requires explicit image, focus and end cue");
		if (
			args.keys &&
			(args.keys.length < 3 ||
				args.keys.length > 128 ||
				args.keys.some(
					(key) =>
						!Number.isFinite(key[0]) ||
						!Number.isFinite(key[1]) ||
						key[0] < 0 ||
						key[1] < 0 ||
						key[1] > 1 ||
						(key[2] !== undefined &&
							!["out", "in", "soft", "io"].includes(key[2])) ||
						(key[3] !== undefined && ![0, 1].includes(key[3])),
				))
		)
			throw Error("Ember collapse oracle requires explicit finite manual keys");
		// Do not sort derived/manual keys: the unaltered original iterates authored order.
	} else if (args.mode === "breathe" || args.mode === "ignite") {
		const intervals = [
			...args.stops,
			...(args.mode === "breathe" ? args.flares : []),
		];
		if (
			intervals.length > 128 ||
			intervals.some(
				([start, end]) =>
					!Number.isFinite(start) ||
					!Number.isFinite(end) ||
					start < 0 ||
					end <= start,
			)
		)
			throw Error(
				"Ember oracle requires bounded explicit stop/flare intervals",
			);
		if (
			args.mode === "breathe" &&
			(args.thumps.length > 128 ||
				args.thumps.some((t) => !Number.isFinite(t) || t < 0))
		)
			throw Error("Ember oracle requires explicit thump times");
		if (
			args.mode === "ignite" &&
			(![args.crackAt, args.ring].every(Number.isFinite) ||
				(args.blackFrom !== undefined &&
					(!Number.isFinite(args.blackFrom) || args.blackFrom <= shotStart)) ||
				args.crackAt < 0 ||
				args.ring <= 0 ||
				!Number.isInteger(args.seed) ||
				args.seed < 0 ||
				args.seed > 0xffffffff)
		)
			throw Error(
				"Ember ignite requires explicit cues, radius and an unsigned 32-bit seed",
			);
	} else throw Error("Unknown original Ember mode");
	return frame;
}
