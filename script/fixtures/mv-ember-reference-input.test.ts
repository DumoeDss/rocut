import { expect, test } from "bun:test";
import {
	snapshotEmberAudio,
	snapshotEmberFrame,
} from "./mv-ember-reference-input";
import type {
	EmberAudioFacts,
	EmberReferenceFrame,
} from "./mv-ember-reference-contract";

const audio = (): EmberAudioFacts => ({
	beats: [0, 0.5, 1],
	strongOnsets: [{ t: 0.8, strength: -0.1 }],
	envelopes: {
		fps: 30,
		rms: [0.1, 0.8],
		low: [0, 0.2],
		mid: [0.5, 0.9],
		high: [0.2, 0.4],
	},
});
const breathe = (): EmberReferenceFrame => ({
	time: 0.5,
	shotStart: 0,
	duration: 2,
	args: { mode: "breathe", stops: [], flares: [], thumps: [], grain: 0.07 },
});

test("oracle snapshots complete audio and authored inputs without aliasing", () => {
	const input = audio(),
		frame = breathe();
	const facts = snapshotEmberAudio(input),
		shot = snapshotEmberFrame(frame);
	expect(facts).toEqual(input);
	expect(shot).toEqual(frame);
	(input.envelopes.rms as number[])[0] = 0.7;
	(input.beats as number[])[1] = 0.4;
	(frame.args as { grain: number }).grain = 0;
	expect(facts.envelopes.rms[0]).toBe(0.1);
	expect(facts.beats[1]).toBe(0.5);
	expect(shot.args.grain).toBe(0.07);
});

test("oracle rejects missing channel, malformed events and raw onset magnitude", () => {
	for (const mutate of [
		(a: any) => {
			delete a.envelopes.mid;
		},
		(a: any) => {
			a.envelopes.rms = [];
		},
		(a: any) => {
			a.envelopes.fps = 0;
		},
		(a: any) => {
			a.envelopes.low[0] = NaN;
		},
		(a: any) => {
			a.beats = [0.5, 0.5];
		},
		(a: any) => {
			a.strongOnsets[0].strength = 7.5;
		},
		(a: any) => {
			a.strongOnsets[0].t = Infinity;
		},
	]) {
		const input = audio();
		mutate(input);
		expect(() => snapshotEmberAudio(input)).toThrow();
	}
});

test("oracle never fills omitted scene-specific song defaults", () => {
	for (const args of [
		{ mode: "breathe", grain: 0 },
		{ mode: "ignite", grain: 0, stops: [] },
		{ mode: "collapse", grain: 0, bg: "image.png", focus: [0, 0] },
	])
		expect(() =>
			snapshotEmberFrame({
				...breathe(),
				args,
			} as unknown as EmberReferenceFrame),
		).toThrow();
});

test("oracle bounds authored source times and keeps original manual key order", () => {
	for (const time of [-1, 2.1, NaN, Infinity])
		expect(() => snapshotEmberFrame({ ...breathe(), time })).toThrow();
	const frame: EmberReferenceFrame = {
		time: 1,
		shotStart: 0,
		duration: 2,
		args: {
			mode: "collapse",
			bg: "marker.png",
			focus: [200, 40],
			end: 2,
			grain: 0.06,
			keys: [
				[0, 1],
				[1.5, 0.6, "out", 1],
				[1.2, 0.3, "soft", 1],
			],
		},
	};
	expect(snapshotEmberFrame(frame)).toEqual(frame);
});

test("oracle preserves omitted ignite blackFrom for the actual beat-derived original default", () => {
	const frame = {
		time: 7,
		shotStart: 6.1,
		duration: 5,
		args: {
			mode: "ignite",
			grain: 0.07,
			stops: [],
			crackAt: 8.44,
			ring: 176,
			seed: 5,
		},
	} satisfies EmberReferenceFrame;
	expect(snapshotEmberFrame(frame)).toEqual(frame);
	expect(snapshotEmberFrame(frame).args).not.toHaveProperty("blackFrom");
	for (const seed of [0, 5, 0xffffffff]) {
		const seeded = { ...frame, args: { ...frame.args, seed } };
		// Preserve zero for the unchanged original scene's `seed || 5` fallback;
		// the oracle adapter must neither reject it nor substitute its own seed.
		expect(snapshotEmberFrame(seeded)).toEqual(seeded);
	}
	for (const seed of [-1, 0.5, NaN, Infinity, 0x100000000])
		expect(() =>
			snapshotEmberFrame({ ...frame, args: { ...frame.args, seed } }),
		).toThrow();
	for (const invalid of [NaN, Infinity, 6.1])
		expect(() =>
			snapshotEmberFrame({
				...frame,
				args: { ...frame.args, blackFrom: invalid } as Extract<
					EmberReferenceFrame["args"],
					{ mode: "ignite" }
				>,
			}),
		).toThrow();
});
