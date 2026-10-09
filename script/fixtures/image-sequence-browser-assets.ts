import * as wasm from "opencut-wasm";
import type {
	ImageSequenceManifest,
	ImageSequenceManifestValidation,
	ProgrammaticResource,
	ProgrammaticSource,
	ResolvedProgrammaticResource,
} from "@opencut/editor-contracts";

export const WIDTH = 64,
	HEIGHT = 36;
export const color = (ordinal: number) => [
	ordinal,
	((ordinal * 7) % 200) + 20,
	((ordinal * 13) % 200) + 20,
];
export function check(value: unknown, message: string): asserts value {
	if (!value) throw Error(message);
}

export async function describe(
	id: string,
	kind: ProgrammaticResource["kind"],
	blob: Blob,
): Promise<ResolvedProgrammaticResource> {
	const body = await blob.arrayBuffer();
	const sha256 = [
		...new Uint8Array(await crypto.subtle.digest("SHA-256", body)),
	]
		.map((byte) => byte.toString(16).padStart(2, "0"))
		.join("");
	return {
		resource: {
			id,
			kind,
			mimeType: blob.type,
			byteLength: body.byteLength,
			sha256,
			attachmentKey: `${kind === "source" ? "programmatic-source-sha256-" : "programmatic-sha256-"}${sha256}`,
		},
		body,
	};
}

export async function makeSequenceAssets() {
	const blobs = new Map<string, Blob>(),
		frames: ProgrammaticResource[] = [];
	const canvas = new OffscreenCanvas(WIDTH, HEIGHT),
		ctx = canvas.getContext("2d")!;
	for (let ordinal = 0; ordinal < 222; ordinal++) {
		ctx.clearRect(0, 0, WIDTH, HEIGHT);
		ctx.fillStyle = `rgb(${color(ordinal).join(",")})`;
		ctx.fillRect(0, 0, 48, HEIGHT);
		ctx.fillStyle = "rgba(255,0,0,0.5)";
		ctx.fillRect(48, 0, 16, 18);
		const blob = await canvas.convertToBlob({ type: "image/png" });
		const resolved = await describe(`frames/${ordinal}.png`, "image", blob);
		frames.push(resolved.resource);
		blobs.set(resolved.resource.attachmentKey, blob);
	}
	const script = await describe(
		"source/render.js",
		"source",
		new Blob(["// Synthetic numbered-frame fixture, not a Blender render.\n"], {
			type: "application/octet-stream",
		}),
	);
	const original = await describe(
		"source/render.json",
		"source",
		new Blob(['{"fixture":"numbered-rgba","frames":222}'], {
			type: "application/octet-stream",
		}),
	);
	const manifest: ImageSequenceManifest = {
		version: 1,
		shotId: "shot-a",
		renderId: "fixture-222",
		width: WIDTH,
		height: HEIGHT,
		frameRate: { numerator: 24000, denominator: 1001 },
		firstFileFrame: 1001,
		alpha: "straight",
		colorSpace: "srgb",
		frames,
		provenance: {
			engine: "diagnostic-canvas",
			version: "1",
			entryFile: "render.js",
			parameters: {},
			originalManifest: original.resource,
			sourceFiles: [
				{
					path: "render.js",
					byteLength: script.body.byteLength,
					sha256: script.resource.sha256,
					parts: [script.resource],
				},
			],
		},
	};
	const validation: ImageSequenceManifestValidation & { error?: string } =
		JSON.parse(
			wasm.validateImageSequenceManifestJson(JSON.stringify(manifest)),
		);
	check(!validation.error, `Manifest admission failed: ${validation.error}`);
	const sequence = await describe(
		"shot/sequence.json",
		"imageSequence",
		new Blob([JSON.stringify(validation.manifest)], {
			type: "application/vnd.rocut.image-sequence+json",
		}),
	);
	const source: ProgrammaticSource = {
		version: 1,
		runtime: "canvas-worker",
		code: "",
		width: WIDTH,
		height: HEIGHT,
		frameRate: { numerator: 30000, denominator: 1001 },
		durationFrames: 600,
		seed: 7,
		resources: [sequence.resource],
		recipe: {
			version: 1,
			root: "frames",
			songStartSeconds: 50,
			outputRoles: ["background"],
			nodes: [
				{
					id: "frames",
					scene: {
						kind: "imageSequence",
						sequence: sequence.resource.id,
						originSourceTicks: 0,
						rate: { numerator: 1, denominator: 1 },
						role: "background",
						view: { x: 0, y: 0, zoom: 1 },
					},
				},
			],
		},
	};
	return { blobs, source, sequence, manifest: validation.manifest };
}

/** These are real Chromium encodes, never fabricated container headers. */
export async function makeOpaqueSequenceAssets(
	base: Awaited<ReturnType<typeof makeSequenceAssets>>,
	mimeType: "image/jpeg" | "image/webp",
) {
	const extension = mimeType === "image/jpeg" ? "jpg" : "webp";
	const expected = mimeType === "image/jpeg" ? [36, 156, 216] : [204, 92, 28];
	const canvas = new OffscreenCanvas(WIDTH, HEIGHT),
		ctx = canvas.getContext("2d")!;
	ctx.fillStyle = `rgb(${expected.join(",")})`;
	ctx.fillRect(0, 0, WIDTH, HEIGHT);
	const blob = await canvas.convertToBlob({ type: mimeType, quality: 0.95 });
	check(blob.type === mimeType, `Chromium did not encode ${mimeType}`);
	const frame = await describe(`frames/opaque.${extension}`, "image", blob);
	const authored = `const canvas = new OffscreenCanvas(${WIDTH}, ${HEIGHT});\nconst ctx = canvas.getContext("2d");\nctx.fillStyle = "rgb(${expected.join(",")})";\nctx.fillRect(0, 0, ${WIDTH}, ${HEIGHT});\nawait canvas.convertToBlob({type: "${mimeType}", quality: 0.95});\n`;
	const scriptBlob = new Blob([authored], { type: "application/octet-stream" });
	const script = await describe("source/render.js", "source", scriptBlob);
	const originalBlob = new Blob(
		[JSON.stringify({ fixture: `opaque-${extension}`, frames: 1, mimeType })],
		{ type: "application/octet-stream" },
	);
	const original = await describe("source/render.json", "source", originalBlob);
	const manifest: ImageSequenceManifest = {
		...base.manifest,
		shotId: `opaque-${extension}`,
		renderId: `fixture-${extension}-1`,
		alpha: "opaque",
		frames: [frame.resource],
		provenance: {
			...base.manifest.provenance,
			originalManifest: original.resource,
			sourceFiles: [
				{
					path: "render.js",
					byteLength: script.body.byteLength,
					sha256: script.resource.sha256,
					parts: [script.resource],
				},
			],
		},
	};
	const validation: ImageSequenceManifestValidation & { error?: string } =
		JSON.parse(
			wasm.validateImageSequenceManifestJson(JSON.stringify(manifest)),
		);
	check(
		!validation.error,
		`${mimeType} manifest rejected: ${validation.error}`,
	);
	const sequence = await describe(
		`opaque-${extension}/sequence.json`,
		"imageSequence",
		new Blob([JSON.stringify(validation.manifest)], {
			type: "application/vnd.rocut.image-sequence+json",
		}),
	);
	const recipe = base.source.recipe,
		node = recipe?.nodes[0];
	check(
		recipe && node?.scene.kind === "imageSequence",
		"Missing base sequence",
	);
	const source: ProgrammaticSource = {
		...base.source,
		resources: [sequence.resource],
		recipe: {
			...recipe,
			nodes: [
				{ ...node, scene: { ...node.scene, sequence: sequence.resource.id } },
			],
		},
	};
	return {
		source,
		sequence,
		expected,
		frame: frame.resource,
		blobs: new Map([
			[frame.resource.attachmentKey, blob],
			[script.resource.attachmentKey, scriptBlob],
			[original.resource.attachmentKey, originalBlob],
		]),
	};
}
