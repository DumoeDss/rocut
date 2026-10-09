import { prepareMvAudioJson } from "opencut-wasm";
import type { ResolvedProgrammaticResource } from "@opencut/editor-contracts";
import type { EmberAudioFacts } from "./mv-ember-reference-contract";
import { convergeReferenceDigest } from "./mv-converge-reference-realm";

export const EMBER_INPUT_SHA = "e".repeat(64);

// These authored fixture beats live on the 120000-tick lattice. Construct ticks
// first, then give the same seconds value to the original oracle and importer.
// Repeated binary multiplication (24 * 0.46) produces 11.040000000000001,
// whereas the native imported boundary is 1324800 / 120000 === 11.04.
// This fixes fixture input identity, not arbitrary sub-tick analyzer compatibility.
const fixtureBeatSeconds = (ordinal: number) => (ordinal * 55200) / 120000;

/** Deliberately synthetic reviewed test signals, not claimed analyzer output.
 * Both implementations receive these same samples/events as input data. */
export function emberAudioFacts(
	options: { vocal?: boolean; sparse?: boolean; fallback?: boolean } = {},
): EmberAudioFacts {
	const samples = (gain: number, offset: number) =>
		Array.from(
			{ length: 901 },
			(_, i) => gain * (0.5 + 0.5 * Math.sin(i * 0.17 + offset)),
		);
	return {
		beats: options.sparse
			? [1, 2].map(fixtureBeatSeconds)
			: Array.from({ length: 65 }, (_, i) => fixtureBeatSeconds(i)),
		strongOnsets: options.fallback
			? [{ t: 19.2, strength: 0.85 }]
			: [
					{ t: 18.05, strength: 0.49 },
					{ t: 18.25, strength: 0.5 },
					{ t: 18.45, strength: 0.9 },
					{ t: 18.65, strength: 1 },
					{ t: 19.0, strength: 0.95 },
				],
		envelopes: {
			fps: 30,
			rms: samples(0.8, 0),
			low: samples(0.4, 0.7),
			mid: samples(0.6, 1.7),
			high: samples(0.2, 2.1),
			...(options.vocal ? { vocal: samples(0.7, 2.9) } : {}),
		},
	};
}

async function encoded(value: unknown) {
	const body = new TextEncoder().encode(JSON.stringify(value)).buffer;
	return {
		body,
		sha256: await convergeReferenceDigest(body),
		byteLength: body.byteLength,
	};
}

/** Exercise the real public importer and bind truthful JSON attachment hashes.
 * The review string makes explicit that these are authored test signals. */
export async function emberAnalysis(
	facts: EmberAudioFacts,
): Promise<ResolvedProgrammaticResource> {
	const duration = facts.envelopes.rms.length / facts.envelopes.fps;
	const music = {
		schema: "creator-mv-audio/1",
		time_coordinate: "source-audio-seconds",
		review: "required",
		audio: { duration },
		beats: facts.beats,
		downbeats: [],
		strong_onsets: {
			method: "reference-onset-residual-p99-v1",
			normalization_scale: facts.strongOnsets.length ? 1 : 0,
			events: facts.strongOnsets.map((o) => ({
				time: o.t,
				strength: o.strength,
			})),
		},
	};
	const channels = {
		mix_rms: facts.envelopes.rms,
		low_power: facts.envelopes.low,
		mid_power: facts.envelopes.mid,
		high_power: facts.envelopes.high,
		...(facts.envelopes.vocal ? { vocal_rms: facts.envelopes.vocal } : {}),
	};
	const envelopes = {
		schema: "creator-mv-audio/1",
		time_coordinate: "source-audio-seconds",
		duration,
		fps: facts.envelopes.fps,
		frame_count: facts.envelopes.rms.length,
		channels,
		normalization: {
			method: "per-channel p95 (max if p95 is zero), clipped to [0,1]",
			scales: Object.fromEntries(
				Object.keys(channels).map((channel) => [channel, 1]),
			),
		},
	};
	const musicFile = await encoded(music),
		envelopesFile = await encoded(envelopes);
	const manifest = {
		schema: "creator-mv-audio/1",
		time_coordinate: "source-audio-seconds",
		status: "complete",
		command: "analyze",
		review: "required",
		inputs: {
			audio: { sha256: EMBER_INPUT_SHA },
			...(facts.envelopes.vocal ? { vocals: { sha256: "f".repeat(64) } } : {}),
		},
		outputs: {
			"music.json": { sha256: musicFile.sha256, bytes: musicFile.byteLength },
			"envelopes.json": {
				sha256: envelopesFile.sha256,
				bytes: envelopesFile.byteLength,
			},
		},
	};
	const manifestFile = await encoded(manifest);
	const result = JSON.parse(
		prepareMvAudioJson(
			JSON.stringify({
				manifest,
				music,
				envelopes,
				manifestFile: {
					sha256: manifestFile.sha256,
					byteLength: manifestFile.byteLength,
				},
				musicFile: {
					sha256: musicFile.sha256,
					byteLength: musicFile.byteLength,
				},
				envelopesFile: {
					sha256: envelopesFile.sha256,
					byteLength: envelopesFile.byteLength,
				},
				expectedAudioSha256: EMBER_INPUT_SHA,
				review: {
					status: "accepted",
					reference:
						"Explicit synthetic Ember parity-fixture channels/events; not native analyzer acceptance",
				},
			}),
		),
	) as { data?: unknown; error?: string };
	if (result.error || !result.data)
		throw Error(result.error ?? "Missing imported Ember test analysis");
	const { body, sha256, byteLength } = await encoded(result.data);
	return {
		body,
		resource: {
			id: "ember-analysis.json",
			kind: "analysis",
			mimeType: "application/json",
			byteLength,
			sha256,
			attachmentKey: `programmatic-sha256-${sha256}`,
		},
	};
}
