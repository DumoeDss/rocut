import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { deflateSync } from "node:zlib";
import type {
	ImageSequenceManifest,
	ProgrammaticResource,
	ProgrammaticSource,
} from "@opencut/editor-contracts";

const WIDTH = 64,
	HEIGHT = 36,
	FRAME_COUNT = 222;

function crc32(bytes: Uint8Array): number {
	let value = 0xffffffff;
	for (const byte of bytes) {
		value ^= byte;
		for (let bit = 0; bit < 8; bit++)
			value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
	}
	return (value ^ 0xffffffff) >>> 0;
}

function chunk(type: string, body: Uint8Array): Buffer<ArrayBuffer> {
	const bytes = Buffer.alloc(body.byteLength + 12);
	bytes.writeUInt32BE(body.byteLength, 0);
	bytes.write(type, 4, 4, "ascii");
	bytes.set(body, 8);
	bytes.writeUInt32BE(crc32(bytes.subarray(4, -4)), bytes.byteLength - 4);
	return bytes;
}

/** Exact RGBA oracle shared by contract with image-sequence-browser-assets. */
export function hostSequencePng(ordinal: number): Uint8Array<ArrayBuffer> {
	if (!Number.isInteger(ordinal) || ordinal < 0 || ordinal >= FRAME_COUNT)
		throw Error("Invalid numbered-frame fixture ordinal");
	const pixels = Buffer.alloc(HEIGHT * (1 + WIDTH * 4));
	const color = [
		ordinal,
		((ordinal * 7) % 200) + 20,
		((ordinal * 13) % 200) + 20,
	];
	for (let y = 0; y < HEIGHT; y++) {
		for (let x = 0; x < WIDTH; x++) {
			const offset = y * (1 + WIDTH * 4) + 1 + x * 4;
			if (x < 48) pixels.set([...color, 255], offset);
			else if (y < 18) pixels.set([255, 0, 0, 128], offset);
		}
	}
	const header = Buffer.alloc(13);
	header.writeUInt32BE(WIDTH, 0);
	header.writeUInt32BE(HEIGHT, 4);
	header[8] = 8;
	header[9] = 6;
	return Buffer.concat([
		Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
		chunk("IHDR", header),
		chunk("IDAT", deflateSync(pixels)),
		chunk("IEND", new Uint8Array()),
	]);
}

const AUTHORED_SOURCE = `// Synthetic diagnostic fixture, not a Blender render.
export async function renderFrame(ordinal) {
  const canvas = new OffscreenCanvas(64, 36);
  const context = canvas.getContext("2d");
  const pixels = context.createImageData(64, 36);
  const color = [ordinal, ((ordinal * 7) % 200) + 20, ((ordinal * 13) % 200) + 20];
  for (let y = 0; y < 36; y++) {
    for (let x = 0; x < 64; x++) {
      const offset = (y * 64 + x) * 4;
      if (x < 48) pixels.data.set([...color, 255], offset);
      else if (y < 18) pixels.data.set([255, 0, 0, 128], offset);
    }
  }
  context.putImageData(pixels, 0, 0);
  return canvas.convertToBlob({type: "image/png"});
}
`;

/** Writes actual inputs before the production HTTP importer ever sees them. */
export async function writeHostSequenceAssets(rootDirectory: string) {
	const save = async (
		id: string,
		kind: "image" | "source",
		bytes: Uint8Array,
	): Promise<ProgrammaticResource> => {
		const path = join(rootDirectory, id);
		await mkdir(dirname(path), { recursive: true });
		await writeFile(path, bytes, { flag: "wx" });
		const sha256 = createHash("sha256").update(bytes).digest("hex");
		return {
			id,
			kind,
			mimeType: kind === "image" ? "image/png" : "application/octet-stream",
			byteLength: bytes.byteLength,
			sha256,
			attachmentKey: `${kind === "source" ? "programmatic-source-sha256-" : "programmatic-sha256-"}${sha256}`,
		};
	};
	const frames: ProgrammaticResource[] = [];
	for (let ordinal = 0; ordinal < FRAME_COUNT; ordinal++)
		frames.push(
			await save(`frames/${ordinal}.png`, "image", hostSequencePng(ordinal)),
		);
	const script = await save(
		"source/render.js",
		"source",
		new TextEncoder().encode(AUTHORED_SOURCE),
	);
	const originalManifest = await save(
		"source/render.json",
		"source",
		new TextEncoder().encode(
			JSON.stringify({
				fixture: "numbered-rgba",
				frames: FRAME_COUNT,
				width: WIDTH,
				height: HEIGHT,
				frameRate: { numerator: 24000, denominator: 1001 },
				firstFileFrame: 1001,
				alpha: "straight",
				colorSpace: "srgb",
				entryFile: "render.js",
			}),
		),
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
			originalManifest,
			sourceFiles: [
				{
					path: "render.js",
					byteLength: script.byteLength,
					sha256: script.sha256,
					parts: [script],
				},
			],
		},
	};
	const manifestPath = join(rootDirectory, "sequence.json");
	await writeFile(manifestPath, JSON.stringify(manifest), {
		encoding: "utf8",
		flag: "wx",
	});
	return {
		manifest,
		input: { id: "shot/sequence.json", rootDirectory, manifestPath },
	};
}

/** Matches the source clock, recipe and seed of image-sequence-browser-assets. */
export function hostSequenceSource(
	resource: ProgrammaticResource,
): ProgrammaticSource {
	return {
		version: 1,
		runtime: "canvas-worker",
		code: "",
		width: WIDTH,
		height: HEIGHT,
		frameRate: { numerator: 30000, denominator: 1001 },
		durationFrames: 600,
		seed: 7,
		resources: [resource],
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
						sequence: resource.id,
						originSourceTicks: 0,
						rate: { numerator: 1, denominator: 1 },
						role: "background",
						view: { x: 0, y: 0, zoom: 1 },
					},
				},
			],
		},
	};
}
