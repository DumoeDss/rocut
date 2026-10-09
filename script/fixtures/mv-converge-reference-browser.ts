import type {
	ConvergeReference,
	ConvergeReferenceFrame,
} from "./mv-converge-reference-contract";
import {
	openConvergeRealm,
	convergeReferenceDigest,
} from "./mv-converge-reference-realm";
import { traceConvergeCanvas } from "./mv-converge-trace";

export function snapshotConvergeFrame(input: ConvergeReferenceFrame) {
	const { time, shotStart, duration } = input,
		args = { ...input.args };
	if (
		![
			time,
			shotStart,
			duration,
			shotStart + duration,
			args.whiteAt,
			args.grain,
		].every(Number.isFinite) ||
		shotStart < 0 ||
		duration <= 0 ||
		time < shotStart ||
		time > shotStart + duration ||
		args.whiteAt <= shotStart ||
		args.whiteAt > Number.MAX_SAFE_INTEGER / 120000
	)
		throw Error(
			"Use explicit finite converge time, duration and future white boundary",
		);
	if (
		!Number.isInteger(args.seed) ||
		args.seed < 1 ||
		args.seed > 0xffffffff ||
		args.grain < 0 ||
		args.grain > 1 ||
		Object.keys(args).some((key) => !["seed", "grain", "whiteAt"].includes(key))
	)
		throw Error("Use explicit bounded original converge seed/grain arguments");
	return { time, shotStart, duration, args };
}

/** Each independent beat list gets a fresh original realm: upstream beatsFrom
 * caches by shot time only. Both Z.audio.beats and S.clock use the same snapshot. */
export async function createConvergeReference({
	reference,
	beats,
	bpm = 120,
}: {
	reference: ConvergeReference;
	beats: readonly number[];
	bpm?: number;
}) {
	if (
		!Array.isArray(beats) ||
		beats.length > 100000 ||
		beats.some(
			(beat, i) =>
				!Number.isFinite(beat) || beat < 0 || (i > 0 && beat <= beats[i - 1]!),
		) ||
		!Number.isFinite(bpm) ||
		bpm <= 0
	)
		throw Error(
			"Supply an ordered unique explicit converge beat list and finite positive clock BPM",
		);
	const originalBeats = [...beats];
	const realm = await openConvergeRealm(reference);
	const beatIdentity = await convergeReferenceDigest(
		new TextEncoder().encode(JSON.stringify(originalBeats)).buffer,
	);
	let disposed = false;
	const dispose = () => {
		if (!disposed) {
			disposed = true;
			realm.iframe.remove();
		}
	};
	try {
		realm.engine.audio = { beats: originalBeats };
		const clock = realm.engine.makeClock(originalBeats, bpm, 0);
		realm.engine.clock = clock;
		await realm.scene.init(); // Original init only preloads fonts; converge itself draws no text.
		return {
			dispose,
			async render(
				input: ConvergeReferenceFrame,
				options: { trace?: boolean } = {},
			) {
				if (disposed) throw Error("Converge reference disposed");
				const frame = snapshotConvergeFrame(input),
					{ time, shotStart, duration, args } = frame;
				const canvas = realm.engine.canvas(1920, 1080),
					context = canvas.getContext("2d");
				if (!context) throw Error("Converge reference Canvas2D unavailable");
				const tape = options.trace ? traceConvergeCanvas(context) : null;
				await realm.scene.draw(tape?.context ?? context, {
					args,
					t: time,
					lt: time - shotStart,
					dur: duration,
					p: (time - shotStart) / duration,
					clock,
					shot: { t0: shotStart, t1: shotStart + duration },
				});
				const bitmap = await realm.realm.createImageBitmap(canvas);
				if (disposed) {
					bitmap.close();
					canvas.width = canvas.height = 1;
					throw Error("Converge disposed while rendering");
				}
				return {
					canvas,
					bitmap,
					...(tape ? { trace: tape.paints } : {}),
					provenance: {
						version: 1,
						scope: "complete-original-converge-draw; no-gl.js-post-processing",
						width: 1920,
						height: 1080,
						scripts: realm.scripts,
						args,
						time,
						shotStart,
						duration,
						beats: originalBeats,
						bpm,
						beatIdentity,
						clock: {
							implementation: "unaltered util.js Z.makeClock",
							index: clock.idx(time),
							since: clock.since(time),
							pulse8: clock.pulse(time, 8),
						},
						resourceNote:
							"Converge draws no text, images or audio waveform; original helper code and original clock both execute without network resources",
					},
				};
			},
		};
	} catch (error) {
		dispose();
		throw error;
	}
}
