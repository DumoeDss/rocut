import type {
	MvHeartRecipeScene,
	ProgrammaticSource,
	ResolvedProgrammaticResource,
} from "@opencut/editor-contracts";

export const HEART_NATIVE_KINDS = [
	"heartShatter",
	"heartShatterBurn",
	"heartGather",
	"sunBloom",
	"skyShatter",
] as const;
export type HeartNativeKind = (typeof HEART_NATIVE_KINDS)[number];

export async function heartNativeDigest(bytes: ArrayBuffer) {
	return [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))]
		.map((n) => n.toString(16).padStart(2, "0"))
		.join("");
}
async function attachment({
	id,
	kind,
	mimeType,
	body,
}: {
	id: string;
	kind: "image" | "analysis";
	mimeType: string;
	body: ArrayBuffer;
}): Promise<ResolvedProgrammaticResource> {
	const sha256 = await heartNativeDigest(body);
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
async function image({
	id,
	size,
	color,
}: {
	id: string;
	size: number;
	color: string;
}) {
	const canvas = document.createElement("canvas");
	canvas.width = canvas.height = size;
	try {
		const ctx = canvas.getContext("2d");
		if (!ctx) throw Error("Native Heart fixture requires Canvas2D");
		ctx.fillStyle = color;
		ctx.fillRect(0, 0, size, size);
		const blob = await new Promise<Blob>((resolve, reject) =>
			canvas.toBlob(
				(value) =>
					value ? resolve(value) : reject(Error("PNG encoding failed")),
				"image/png",
			),
		);
		return await attachment({
			id,
			kind: "image",
			mimeType: "image/png",
			body: await blob.arrayBuffer(),
		});
	} finally {
		canvas.width = canvas.height = 1;
	}
}
function scene(kind: HeartNativeKind): MvHeartRecipeScene {
	const common = {
		role: "subject",
		span: { startFrame: 0, durationFrames: 150 },
		bpm: 120,
	} as const;
	switch (kind) {
		case "heartShatter":
			return { ...common, kind, settings: { heart: "heart" } };
		case "heartShatterBurn":
			return { ...common, kind, settings: { heart: "heart" } };
		case "heartGather":
			return {
				...common,
				kind,
				settings: { heart: "heart", char: "character", bg: "background" },
			};
		case "sunBloom":
			return {
				...common,
				kind,
				settings: { heart: "heart", char: "character" },
			};
		case "skyShatter":
			return {
				...common,
				kind,
				settings: { bg: "background", char: "character" },
			};
	}
}
/** Real native-encoded1024 input, not authored dimensions/pixels or resized art. */
export async function heartNativeFixture() {
	const resources = [
		await image({ id: "heart", size: 1024, color: "#fff" }),
		await image({ id: "character", size: 64, color: "#ec5588" }),
		await image({ id: "background", size: 64, color: "#273863" }),
	];
	const audio = {
		schema: "rocut-mv-audio/1",
		duration: 10,
		fps: 1,
		provenance: {
			schema: "creator-mv-audio/1",
			inputSha256: "a".repeat(64),
			vocalSha256: null,
			manifestSha256: "b".repeat(64),
			musicSha256: "c".repeat(64),
			envelopesSha256: "d".repeat(64),
			review: {
				status: "accepted",
				reference:
					"dedicated synthetic whole-song native Heart acceptance fixture",
			},
		},
		beats: Array.from({ length: 20 }, (_, i) => i * 60000),
		downbeats: [0, 240000, 480000, 720000, 960000],
		channels: {
			mix_rms: Array(10).fill(0),
			low_power: Array(10).fill(0),
			mid_power: Array(10).fill(0),
			high_power: Array(10).fill(0),
		},
		scales: { mix_rms: 1, low_power: 1, mid_power: 1, high_power: 1 },
	};
	resources.push(
		await attachment({
			id: "analysis",
			kind: "analysis",
			mimeType: "application/json",
			body: new TextEncoder().encode(JSON.stringify(audio)).buffer,
		}),
	);
	return {
		resources,
		source(kind: HeartNativeKind): ProgrammaticSource {
			return {
				version: 1,
				runtime: "canvas-worker",
				code: "",
				width: 1920,
				height: 1080,
				frameRate: { numerator: 30, denominator: 1 },
				durationFrames: 150,
				seed: 17,
				resources: resources.map((item) => item.resource),
				recipe: {
					version: 1,
					songStartSeconds: 0,
					root: "heart",
					outputRoles: ["subject"],
					post: [],
					audio: {
						resource: "analysis",
						inputSha256: audio.provenance.inputSha256,
					},
					nodes: [{ id: "heart", scene: scene(kind) }],
				},
			};
		},
	};
}
