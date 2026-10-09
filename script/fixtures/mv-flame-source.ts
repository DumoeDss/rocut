import type {
	ProgrammaticSource,
	ResolvedProgrammaticResource,
} from "@opencut/editor-contracts";
import type { FlameOracleFrame, FlameSong } from "./mv-flame-oracle-contract";
import { kanjiDigest as digest } from "./mv-kanji-slam-reference-realm";

export async function flameAnalysis(
	song: FlameSong,
): Promise<ResolvedProgrammaticResource> {
	const fps = song.envelope?.fps ?? 1;
	const vocal = song.envelope?.vocal ?? Array.from({ length: 24 }, () => 0);
	const zeros = vocal.map(() => 0);
	const vocalSha256 = await digest(
		new TextEncoder().encode(JSON.stringify(vocal)).buffer,
	);
	const body = new TextEncoder().encode(
		JSON.stringify({
			schema: "rocut-mv-audio/1",
			duration: vocal.length / fps,
			fps,
			provenance: {
				schema: "creator-mv-audio/1",
				inputSha256: "a".repeat(64),
				vocalSha256,
				manifestSha256: "b".repeat(64),
				musicSha256: "c".repeat(64),
				envelopesSha256: "d".repeat(64),
				review: {
					status: "accepted",
					reference: "synthetic Flame parity fixture",
				},
			},
			beats: song.beats.map((t) => Math.round(t * 120000)),
			downbeats: [],
			...(song.stops === undefined ? {} : { stops: song.stops }),
			channels: {
				mix_rms: zeros,
				low_power: zeros,
				mid_power: zeros,
				high_power: zeros,
				vocal_rms: vocal,
			},
			scales: {
				mix_rms: 0,
				low_power: 0,
				mid_power: 0,
				high_power: 0,
				vocal_rms: 1,
			},
		}),
	).buffer;
	const sha256 = await digest(body);
	return {
		body,
		resource: {
			id: "flame-analysis",
			kind: "analysis",
			mimeType: "application/json",
			byteLength: body.byteLength,
			sha256,
			attachmentKey: `programmatic-sha256-${sha256}`,
		},
	};
}

/** Tick/author adapter only: no scene or preprocessing math. */
export function flameSource({
	frame,
	song,
	resources,
	options = {},
}: {
	frame: FlameOracleFrame;
	song: FlameSong;
	resources: readonly ResolvedProgrammaticResource[];
	options?: {
		vocal?: "analysis" | "zero";
		width?: number;
		height?: number;
	};
}): ProgrammaticSource {
	const durationFrames = frame.duration * 60;
	if (!Number.isSafeInteger(durationFrames) || durationFrames <= 0)
		throw Error("Flame duration must be positive on the 60fps grid");
	const analysis = resources.find((r) => r.resource.id === "flame-analysis");
	return {
		version: 1,
		runtime: "canvas-worker",
		code: "",
		width: options.width ?? 1920,
		height: options.height ?? 1080,
		frameRate: { numerator: 60, denominator: 1 },
		durationFrames,
		seed: 173,
		resources: resources.map((r) => r.resource),
		recipe: {
			version: 1,
			root: "flame",
			songStartSeconds: frame.shotStart,
			outputRoles: ["background"],
			...(analysis
				? {
						audio: {
							resource: analysis.resource.id,
							inputSha256: "a".repeat(64),
						},
					}
				: {}),
			nodes: [
				{
					id: "flame",
					scene: {
						kind: "flame",
						role: "background",
						span: { startFrame: 0, durationFrames },
						settings: {
							...frame.args,
							bpm: song.bpm,
							downbeatIndex0: song.downbeatIndex0,
							beats: analysis
								? { kind: "analysis" }
								: {
										kind: "manual",
										songTicks: song.beats.map((t) => Math.round(t * 120000)),
									},
							...(options.vocal ? { vocal: options.vocal } : {}),
						},
					},
				},
			],
		},
	};
}

export function flameSample({
	frame,
	index,
}: {
	frame: FlameOracleFrame;
	index: number;
}): FlameOracleFrame {
	if (!Number.isSafeInteger(index) || index < 0 || index >= frame.duration * 60)
		throw Error("Invalid Flame frame index");
	return {
		...frame,
		time: (Math.round(frame.shotStart * 120000) + index * 2000) / 120000,
	};
}
