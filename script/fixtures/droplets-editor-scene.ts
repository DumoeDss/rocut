import { deflateSync } from "node:zlib";
import type {
	ProgrammaticResource,
	ProgrammaticSource,
} from "@opencut/editor-contracts";
import { dropletsParameters, dropletsSource } from "./droplets-cases";

export const editorSize = { width: 640, height: 360 };
export const editorParams = { ...dropletsParameters };
export const opticalChannels = {
	amount: [0.25, 0.75],
	refraction: [0.025, 0.08],
	highlight: [0.2, 0.7],
};
export const editorChanges = [
	{ key: "amount", label: "Amount", value: 0.65 },
	{ key: "count", label: "Droplet count", value: 20 },
	{ key: "radius", label: "Radius (short-side fraction)", value: 0.075 },
	{ key: "speed", label: "Fall cycles per second", value: 1.25 },
	{ key: "elongation", label: "Vertical elongation", value: 2.5 },
	{ key: "refraction", label: "Refraction (short-side fraction)", value: 0.04 },
	{ key: "highlight", label: "Highlight", value: 0.2 },
	{ key: "seed", label: "Seed", value: 27182 },
];

function chunk(kind: string, bytes: Buffer) {
	const name = Buffer.from(kind),
		data = Buffer.concat([name, bytes]);
	let crc = 0xffffffff;
	for (const byte of data) {
		crc ^= byte;
		for (let bit = 0; bit < 8; bit++)
			crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
	}
	const head = Buffer.alloc(4),
		tail = Buffer.alloc(4);
	head.writeUInt32BE(bytes.length);
	tail.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
	return Buffer.concat([head, data, tail]);
}

export function editorImage() {
	const { width, height } = editorSize;
	const pixels = dropletsSource(width, height, "holes");
	const rows = Buffer.alloc(height * (1 + width * 4));
	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			const source = (y * width + x) * 4;
			const target = y * (1 + width * 4) + 1 + x * 4;
			// Wider than the maximum accepted short-side refraction displacement.
			if (x < 32 || y < 32 || x >= width - 32 || y >= height - 32) continue;
			for (let c = 0; c < 4; c++) rows[target + c] = pixels[source + c];
		}
	}
	const header = Buffer.alloc(13);
	header.writeUInt32BE(width, 0);
	header.writeUInt32BE(height, 4);
	header[8] = 8;
	header[9] = 6;
	return Buffer.concat([
		Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
		chunk("IHDR", header),
		chunk("IDAT", deflateSync(rows)),
		chunk("IEND", Buffer.alloc(0)),
	]);
}

export function editorSource(image: ProgrammaticResource): ProgrammaticSource {
	return {
		version: 1,
		runtime: "canvas-worker",
		code: "",
		...editorSize,
		frameRate: { numerator: 30, denominator: 1 },
		durationFrames: 30,
		seed: 97,
		resources: [image],
		recipe: {
			version: 1,
			root: "shot",
			songStartSeconds: 0,
			outputRoles: ["background", "subject", "graphics", "foreground"],
			nodes: [
				{
					id: "shot",
					scene: {
						kind: "illust",
						sprites: [],
						easing: "linear",
						motion: { startFrame: 0, durationFrames: 29 },
						background: {
							image: image.id,
							from: { x: 0.5, y: 0.5, zoom: 1 },
							to: { x: 0.5, y: 0.5, zoom: 1 },
						},
					},
				},
			],
		},
	};
}
