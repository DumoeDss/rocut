import { createHash } from "node:crypto";
import type {
	HyperframesFxExecutor,
	HyperframesFxStage,
} from "../../apps/cli/src/programmatic/hyperframes-fx-types";

export const CHAIN_RATE = 48000;
export const CHAIN_FRAMES = 15360;
export const CHAIN_FX_A = [
	{ type: "delay", params: { time: 20, feedback: 0.2, mix: 0.6 } },
];
export const CHAIN_FX_B = [{ type: "saturate", params: { threshold: -12 } }];
export const CHAIN_FX_BUS = [{ type: "saturate", params: { threshold: -9 } }];

export function graphChainFixture() {
	const pcm = Buffer.alloc(1920 * 8);
	for (let frame = 0; frame < 1920; frame++) {
		pcm.writeFloatLE(0.7 * Math.sin((2 * Math.PI * frame) / 240), frame * 8);
		pcm.writeFloatLE(
			0.35 * Math.cos((2 * Math.PI * frame) / 96),
			frame * 8 + 4,
		);
	}
	const body = Buffer.alloc(44 + pcm.length);
	body.write("RIFF");
	body.writeUInt32LE(body.length - 8, 4);
	body.write("WAVEfmt ", 8);
	body.writeUInt32LE(16, 16);
	body.writeUInt16LE(3, 20);
	body.writeUInt16LE(2, 22);
	body.writeUInt32LE(CHAIN_RATE, 24);
	body.writeUInt32LE(CHAIN_RATE * 8, 28);
	body.writeUInt16LE(8, 32);
	body.writeUInt16LE(32, 34);
	body.write("data", 36);
	body.writeUInt32LE(pcm.length, 40);
	pcm.copy(body, 44);
	const mimeType = "audio/wav";
	const id = createHash("sha256")
		.update(mimeType)
		.update("\0")
		.update(body)
		.digest("hex");
	function track(
		instanceId: string,
		start: number,
		duration: number,
		trim: number,
		gain: number,
		endGain: number,
		grouped: boolean,
		fx: unknown[],
		muted = false,
	) {
		const fades = { fadeIn: instanceId === "track#a" ? 0.02 : 0, fadeOut: 0 };
		return {
			instanceId,
			authorId: "duplicate-author",
			resourceId: id,
			type: "audio",
			authoredMuted: muted,
			ancestorHidden: false,
			observedAt: 0.1,
			native: {
				start,
				end: start + duration,
				duration,
				mediaStart: trim,
				sourceDuration: 0.04,
				playbackRate: 1,
				rate: 1,
				loop: true,
				volume: gain,
				fades,
				volumeKeyframes: [
					{ time: 0, volume: gain },
					{ time: duration, volume: endGain },
				],
			},
			resolvedAuthorGain: {
				state: "observed",
				observedAt: 0.1,
				gainBeforeFades: gain + ((endGain - gain) * (0.1 - start)) / duration,
				source: "normalized-GSAP",
				points: [
					{ t: 0, v: gain },
					{ t: duration, v: endGain },
				],
				fades,
				fallback: null,
			},
			attributes: {
				groupRenderId: grouped ? "bus#1" : null,
				groupAuthorId: null,
				fxChain: fx.length ? JSON.stringify({ version: 1, nodes: fx }) : null,
				automation: null,
				muted,
				hasAudio: null,
			},
		};
	}
	const request = {
		version: 1,
		faderObservations: [],
		graph: {
			version: 1,
			semanticsProfile: "rocut-hyperframes-0.8.139-audio-graph-v1",
			frameRate: { numerator: 25, denominator: 1 },
			sampleRate: CHAIN_RATE,
			firstFrame: 0,
			frameCount: 8,
			durationFrames: 8,
			sources: [{ id, mimeType, byteLength: body.length }],
			snapshot: {
				version: 1,
				nativeVersion: "0.8.139",
				time: 0.1,
				tracks: [
					track("track#a", 0.04, 0.16, 0.01, 0.5, 1, true, CHAIN_FX_A),
					track("track#b", 0.08, 0.16, 0, 0.75, 0.75, true, CHAIN_FX_B),
					track("track#c", 0, 0.32, 0, 3, 3, false, []),
					track("track#muted", 0, 0.32, 0, 3, 3, true, [], true),
				],
				buses: [
					{
						instanceId: "bus#1",
						authorId: "music",
						hidden: false,
						attributes: {
							volume: "0.6suffix",
							fxChain: JSON.stringify({ version: 1, nodes: CHAIN_FX_BUS }),
							automation: null,
						},
					},
				],
			},
		},
	};
	return {
		request,
		sources: [
			{ id, mimeType, body, src: `https://rocut.invalid/__resource/${id}` },
		],
		pcm,
	};
}

/** Independent fixture arithmetic, never using production Rust plan geometry,
 * dry kernels, fader kernels or bus/master kernels to calculate expected PCM. */
export function fixtureLoop(pcm: Buffer, frames: number, trimFrames: number) {
	const output = Buffer.alloc(frames * 8);
	const period = pcm.length / 8 - trimFrames;
	for (let frame = 0; frame < frames; frame++) {
		const from = (trimFrames + (frame % period)) * 8;
		pcm.copy(output, frame * 8, from, from + 8);
	}
	return output;
}

export function fixtureGain(pcm: Buffer, gain: (frame: number) => number) {
	const output = Buffer.alloc(pcm.length);
	for (let frame = 0; frame < pcm.length / 8; frame++) {
		for (let channel = 0; channel < 2; channel++) {
			const byte = frame * 8 + channel * 4;
			output.writeFloatLE(
				Math.fround(pcm.readFloatLE(byte) * Math.fround(gain(frame))),
				byte,
			);
		}
	}
	return output;
}

export function fixtureAdd(output: Buffer, input: Buffer, start: number) {
	for (
		let byte = 0;
		byte < input.length && byte + start * 8 < output.length;
		byte += 4
	) {
		const target = byte + start * 8;
		output.writeFloatLE(
			Math.fround(output.readFloatLE(target) + input.readFloatLE(byte)),
			target,
		);
	}
}

export function pcmError(actual: Buffer, expected: Buffer) {
	if (actual.length !== expected.length)
		throw Error("Oracle PCM length mismatch");
	let max = 0;
	for (let byte = 0; byte < actual.length; byte += 4)
		max = Math.max(
			max,
			Math.abs(actual.readFloatLE(byte) - expected.readFloatLE(byte)),
		);
	return max;
}

export async function graphChainOracle(
	pcm: Buffer,
	executor: HyperframesFxExecutor,
	stage: (nodes: readonly unknown[], frames: number) => HyperframesFxStage,
) {
	const dryA = fixtureLoop(pcm, 7680, 480),
		dryB = fixtureLoop(pcm, 7680, 0);
	const gainA = (frame: number) =>
		(0.5 + 0.5 * Math.min(frame / 7680, 1)) * Math.min(frame / 960, 1);
	const effectedA = await executor.run(stage(CHAIN_FX_A, 7680), dryA);
	const effectedB = await executor.run(stage(CHAIN_FX_B, 7680), dryB);
	const summed = Buffer.alloc(CHAIN_FRAMES * 8);
	fixtureAdd(summed, fixtureGain(effectedA.pcm, gainA), 1920);
	fixtureAdd(
		summed,
		fixtureGain(effectedB.pcm, () => 0.75),
		3840,
	);
	const bus = await executor.run(stage(CHAIN_FX_BUS, CHAIN_FRAMES), summed);
	const expected = fixtureGain(fixtureLoop(pcm, CHAIN_FRAMES, 0), () => 3);
	fixtureAdd(
		expected,
		fixtureGain(bus.pcm, () => 0.6),
		0,
	);
	// Wrong-order control: faders before track FX must not accidentally pass.
	const wrongA = await executor.run(
		stage(CHAIN_FX_A, 7680),
		fixtureGain(dryA, gainA),
	);
	const wrongB = await executor.run(
		stage(CHAIN_FX_B, 7680),
		fixtureGain(dryB, () => 0.75),
	);
	const wrongSum = Buffer.alloc(CHAIN_FRAMES * 8);
	fixtureAdd(wrongSum, wrongA.pcm, 1920);
	fixtureAdd(wrongSum, wrongB.pcm, 3840);
	const wrongBus = await executor.run(
		stage(CHAIN_FX_BUS, CHAIN_FRAMES),
		wrongSum,
	);
	const wrong = fixtureGain(fixtureLoop(pcm, CHAIN_FRAMES, 0), () => 3);
	fixtureAdd(
		wrong,
		fixtureGain(wrongBus.pcm, () => 0.6),
		0,
	);
	return { expected, wrongOrderError: pcmError(expected, wrong) };
}
