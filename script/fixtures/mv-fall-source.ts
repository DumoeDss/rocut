import type {
	ProgrammaticSource,
	ResolvedProgrammaticResource,
} from "@opencut/editor-contracts";
import type { FallFrame, FallSong } from "./mv-fall-contract";
import { kanjiDigest as digest } from "./mv-kanji-slam-reference-realm";
async function attachment(
	id: string,
	kind: "image" | "analysis",
	mimeType: string,
	body: ArrayBuffer,
): Promise<ResolvedProgrammaticResource> {
	const sha256 = await digest(body);
	return {
		body,
		resource: {
			id,
			kind,
			mimeType,
			byteLength: body.byteLength,
			sha256,
			attachmentKey: `programmatic-sha256-${sha256}`,
		},
	};
}
export async function fallCharacter(): Promise<ResolvedProgrammaticResource> {
	const canvas = document.createElement("canvas");
	canvas.width = 960;
	canvas.height = 1600;
	try {
		const x = canvas.getContext("2d")!;
		// Synthetic alpha/edge marker exercises all 30 warped top strips, the
		// rounded split, lit body, both inner rims and original ribbon landmark.
		x.fillStyle = "#355f9b";
		x.beginPath();
		x.ellipse(450, 900, 250, 620, -0.1, 0, Math.PI * 2);
		x.fill();
		x.fillStyle = "rgba(231,162,112,.82)";
		x.beginPath();
		x.ellipse(458, 382, 180, 212, 0.1, 0, Math.PI * 2);
		x.fill();
		for (let i = 0; i < 24; i++) {
			x.fillStyle = i % 2 ? "#dbbfe9" : "#333855";
			x.fillRect(
				180 + i * 24,
				28 + (i % 4) * 11,
				9 + (i % 3) * 3,
				440 - (i % 5) * 27,
			);
		}
		x.strokeStyle = "#e0434d";
		x.lineWidth = 31;
		x.beginPath();
		x.moveTo(573, 551);
		x.lineTo(793, 502);
		x.lineTo(890, 584);
		x.stroke();
		for (let i = 0; i < 9; i++) {
			x.fillStyle = i % 2 ? "rgba(248,232,206,.65)" : "#1a3246";
			x.fillRect(274 + i * 35, 715 + i * 9, 13, 410);
		}
		const blob = await new Promise<Blob>((resolve, reject) =>
			canvas.toBlob(
				(v) => (v ? resolve(v) : reject(Error("Fall marker PNG failed"))),
				"image/png",
			),
		);
		return await attachment(
			"fall-char",
			"image",
			"image/png",
			await blob.arrayBuffer(),
		);
	} finally {
		canvas.width = canvas.height = 1;
	}
}
export async function fallAnalysis(
	song: FallSong,
): Promise<ResolvedProgrammaticResource> {
	const zeros = Array.from({ length: 24 }, () => 0);
	const value = {
		schema: "rocut-mv-audio/1",
		duration: 24,
		fps: 1,
		provenance: {
			schema: "creator-mv-audio/1",
			inputSha256: "a".repeat(64),
			manifestSha256: "b".repeat(64),
			musicSha256: "c".repeat(64),
			envelopesSha256: "d".repeat(64),
			review: {
				status: "accepted",
				reference: "synthetic Fall stop regression fixture",
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
		},
		scales: { mix_rms: 0, low_power: 0, mid_power: 0, high_power: 0 },
	};
	return attachment(
		"fall-analysis",
		"analysis",
		"application/json",
		new TextEncoder().encode(JSON.stringify(value)).buffer,
	);
}
/** Authoring/tick adapter only. All Fall scene math is native or original. */
export function fallSource(
	frame: FallFrame,
	song: FallSong,
	resources: readonly ResolvedProgrammaticResource[],
): ProgrammaticSource {
	const durationFrames = frame.duration * 60;
	if (!Number.isSafeInteger(durationFrames) || durationFrames <= 0)
		throw Error("Fall duration must be positive on the60fps grid");
	if (
		!resources.some(
			(r) => r.resource.id === frame.args.char && r.resource.kind === "image",
		)
	)
		throw Error("Missing Fall character declaration");
	const analysis = resources.find((r) => r.resource.id === "fall-analysis");
	return {
		version: 1,
		runtime: "canvas-worker",
		code: "",
		width: 1920,
		height: 1080,
		frameRate: { numerator: 60, denominator: 1 },
		durationFrames,
		seed: 173,
		resources: resources.map((r) => r.resource),
		recipe: {
			version: 1,
			root: "fall",
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
					id: "fall",
					scene: {
						kind: "fall",
						role: "background",
						span: { startFrame: 0, durationFrames },
						settings: {
							...frame.args,
							beats: analysis
								? { kind: "analysis" }
								: {
										kind: "manual",
										songTicks: song.beats.map((t) => Math.round(t * 120000)),
									},
						},
					},
				},
			],
		},
	};
}
export function fallSample(frame: FallFrame, index: number): FallFrame {
	if (!Number.isSafeInteger(index) || index < 0 || index >= frame.duration * 60)
		throw Error("Invalid Fall frame index");
	return {
		...frame,
		time: (Math.round(frame.shotStart * 120000) + index * 2000) / 120000,
	};
}
