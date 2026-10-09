import { prepareMvAudioJson } from "opencut-wasm";
import type {
	ProgrammaticSource,
	ResolvedProgrammaticResource,
} from "@opencut/editor-contracts";
import { lightLeakSource } from "./mv-light-leak-source";

/** Explicitly synthetic reviewed half-level input, not an ASR/music analysis claim. */
export async function lightLeakAudioFixture() {
	const file = (c: string) => ({ sha256: c.repeat(64), byteLength: 100 });
	const prepared = JSON.parse(
		prepareMvAudioJson(
			JSON.stringify({
				manifest: {
					schema: "creator-mv-audio/1",
					time_coordinate: "source-audio-seconds",
					command: "analyze",
					status: "complete",
					review: "required",
					inputs: { audio: { sha256: "a".repeat(64), bytes: 100 } },
					outputs: {
						"music.json": { sha256: "b".repeat(64), bytes: 100 },
						"envelopes.json": { sha256: "c".repeat(64), bytes: 100 },
					},
				},
				music: {
					schema: "creator-mv-audio/1",
					time_coordinate: "source-audio-seconds",
					audio: { duration: 2 },
					review: "required",
					beats: [0, 1],
					downbeats: [0],
				},
				envelopes: {
					schema: "creator-mv-audio/1",
					time_coordinate: "source-audio-seconds",
					duration: 2,
					fps: 1,
					frame_count: 2,
					channels: {
						mix_rms: [0.5, 0.5],
						low_power: [1, 1],
						mid_power: [1, 1],
						high_power: [1, 1],
					},
					normalization: {
						method: "per-channel p95 (max if p95 is zero), clipped to [0,1]",
						scales: { mix_rms: 1, low_power: 1, mid_power: 1, high_power: 1 },
					},
				},
				manifestFile: file("d"),
				musicFile: file("b"),
				envelopesFile: file("c"),
				expectedAudioSha256: "a".repeat(64),
				review: {
					status: "accepted",
					reference: "synthetic light-leak unit fixture: constant half-level",
				},
			}),
		),
	);
	if (!prepared.data || prepared.error)
		throw Error(prepared.error ?? "Missing light-leak audio fixture");
	const body = new TextEncoder().encode(JSON.stringify(prepared.data)).buffer;
	const sha256 = [
		...new Uint8Array(await crypto.subtle.digest("SHA-256", body)),
	]
		.map((v) => v.toString(16).padStart(2, "0"))
		.join("");
	const resource: ResolvedProgrammaticResource = {
		body,
		resource: {
			id: "analysis/song.json",
			kind: "analysis",
			mimeType: "application/json",
			byteLength: body.byteLength,
			sha256,
			attachmentKey: `programmatic-sha256-${sha256}`,
		},
	};
	const base = lightLeakSource();
	const source: ProgrammaticSource = {
		...base,
		resources: [resource.resource],
		recipe: {
			...base.recipe!,
			songStartSeconds: 0,
			audio: { resource: resource.resource.id, inputSha256: "a".repeat(64) },
			post: [
				{
					stage: "composite",
					effects: [
						{ kind: "lightLeak", amount: 0.9, alpha: "expand", speed: 0 },
					],
					automation: [
						{
							effect: 0,
							keyframes: [{ frame: 0, value: 0.2, easing: "linear" }],
						},
					],
					audio: [
						{
							effect: 0,
							amount: 0.3,
							signal: {
								kind: "envelope",
								channel: "mix_rms",
								clock: "song",
								missing: "error",
							},
						},
					],
				},
			],
		},
	};
	return { source, resource, data: prepared.data, expectedAmount: 0.35 };
}
