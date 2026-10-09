import type {
	ProgrammaticSource,
	ResolvedProgrammaticResource,
} from "@opencut/editor-contracts";
import type { ThreadFrame, ThreadSong } from "./mv-thread-contract";
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
export async function threadHand(): Promise<ResolvedProgrammaticResource> {
	const canvas = document.createElement("canvas");
	canvas.width = 960;
	canvas.height = 1600;
	try {
		const ctx = canvas.getContext("2d")!;
		ctx.fillStyle = "#55b5c9";
		ctx.beginPath();
		ctx.moveTo(65, 1590);
		ctx.lineTo(550, 600);
		ctx.lineTo(790, 460);
		ctx.lineTo(915, 690);
		ctx.lineTo(410, 1590);
		ctx.closePath();
		ctx.fill();
		ctx.fillStyle = "rgba(235,140,98,.77)";
		ctx.beginPath();
		ctx.ellipse(730, 660, 155, 190, -0.3, 0, Math.PI * 2);
		ctx.fill();
		ctx.strokeStyle = "#f35854";
		ctx.lineWidth = 32;
		ctx.beginPath();
		ctx.moveTo(625, 845);
		ctx.lineTo(845, 968);
		ctx.stroke();
		for (let i = 0; i < 8; i++) {
			ctx.fillStyle = i % 2 ? "#eeeeff" : "#275069";
			ctx.fillRect(245 + i * 18, 1160, 9, 165);
		}
		const blob = await new Promise<Blob>((resolve, reject) =>
			canvas.toBlob(
				(v) => (v ? resolve(v) : reject(Error("Thread marker PNG failed"))),
				"image/png",
			),
		);
		return await attachment(
			"thread-hand",
			"image",
			"image/png",
			await blob.arrayBuffer(),
		);
	} finally {
		canvas.width = canvas.height = 1;
	}
}
export async function threadAnalysis(
	song: ThreadSong,
): Promise<ResolvedProgrammaticResource> {
	// Synthetic reviewed test evidence, not a claimed automatic analysis result.
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
				reference: "synthetic thread stop regression fixture",
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
		"thread-analysis",
		"analysis",
		"application/json",
		new TextEncoder().encode(JSON.stringify(value)).buffer,
	);
}
/** Only authoring conversion and integer tick mapping; no scene geometry/math. */
export function threadSource(
	frame: ThreadFrame,
	song: ThreadSong,
	resources: readonly ResolvedProgrammaticResource[],
): ProgrammaticSource {
	const durationFrames = frame.duration * 60;
	if (!Number.isSafeInteger(durationFrames) || durationFrames <= 0)
		throw Error("Thread fixture duration must be positive on the 60fps grid");
	if (
		!resources.some(
			(r) => r.resource.id === frame.args.hand && r.resource.kind === "image",
		)
	)
		throw Error("Missing thread hand declaration");
	const analysis = resources.find((r) => r.resource.id === "thread-analysis");
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
			root: "thread",
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
					id: "thread",
					scene: {
						kind: "thread",
						role: "background",
						span: { startFrame: 0, durationFrames },
						settings: {
							...frame.args,
							beats: {
								kind: "manual",
								songTicks: song.beats.map((t) => Math.round(t * 120000)),
							},
							bpm: song.bpm,
							downbeatIndex0: song.downbeatIndex0,
						},
					},
				},
			],
		},
	};
}
export function threadSample(frame: ThreadFrame, index: number): ThreadFrame {
	if (!Number.isSafeInteger(index) || index < 0 || index >= frame.duration * 60)
		throw Error("Invalid thread frame index");
	return {
		...frame,
		time: (Math.round(frame.shotStart * 120000) + index * 2000) / 120000,
	};
}
