import { createHash } from "node:crypto";
import type { VariableRateCase } from "./hyperframes-variable-rate-cases";
import type { RateSpec } from "./hyperframes-variable-rate-native";

/** Trusted test declarations; browser collection is tested separately. */
export function variableRateGraphFixture(
	body: Buffer,
	mimeType: string,
	test: VariableRateCase,
	rate: RateSpec,
	sampleRate: number,
	fxNodes: unknown[] = [],
) {
	const id = createHash("sha256")
		.update(mimeType)
		.update("\0")
		.update(body)
		.digest("hex");
	const gain = 0.75,
		start = 0.1,
		observedAt = 0.11;
	const fades = { fadeIn: 0, fadeOut: 0 };
	const gainPoints = [
		{ t: 0, v: gain },
		{ t: test.duration, v: gain },
	];
	const request = {
		version: 1,
		faderObservations: [],
		graph: {
			version: 1,
			semanticsProfile: "rocut-hyperframes-0.8.139-audio-graph-v1",
			frameRate: { numerator: 100, denominator: 1 },
			sampleRate,
			firstFrame: 0,
			frameCount: Math.round(test.duration * 100) + 20,
			durationFrames: Math.round(test.duration * 100) + 20,
			sources: [{ id, mimeType, byteLength: body.length }],
			snapshot: {
				version: 1,
				nativeVersion: "0.8.139",
				time: observedAt,
				tracks: [
					{
						instanceId: "track#rate",
						authorId: "rate",
						resourceId: id,
						type: mimeType.startsWith("video/") ? "video" : "audio",
						authoredMuted: false,
						ancestorHidden: false,
						observedAt,
						native: {
							start,
							end: start + test.duration,
							duration: test.duration,
							mediaStart: test.mediaStart,
							sourceDuration: 4,
							playbackRate: 1,
							rate,
							loop: false,
							volume: gain,
							fades,
							volumeKeyframes: [],
						},
						resolvedAuthorGain: {
							state: "observed",
							observedAt,
							gainBeforeFades: gain,
							source: "normalized-volume-lane",
							points: gainPoints,
							fades,
							fallback: null,
						},
						attributes: {
							groupRenderId: null,
							groupAuthorId: null,
							fxChain: fxNodes.length
								? JSON.stringify({ version: 1, nodes: fxNodes })
								: null,
							automation: JSON.stringify({
								version: 1,
								lanes: [
									...(typeof rate === "object" ? [rate] : []),
									{ target: "volume", points: gainPoints },
								],
							}),
							muted: false,
							hasAudio: mimeType.startsWith("video/") ? "true" : null,
						},
					},
				],
				buses: [],
			},
		},
	};
	return {
		request,
		sources: [
			{ id, mimeType, body, src: `https://rocut.invalid/__resource/${id}` },
		],
		gain,
		start,
	};
}
