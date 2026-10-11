import { deflateSync } from "node:zlib";

// Small GLB, texture and environment fixtures generated locally.
const u32 = (value: number) => {
	const b = Buffer.alloc(4);
	b.writeUInt32LE(value);
	return b;
};
const f32 = (value: number) => {
	const b = Buffer.alloc(4);
	b.writeFloatLE(value);
	return b;
};
const cstring = (value: string) => Buffer.from(value + "\0");

function pngChunk(name: string, body: Buffer) {
	const data = Buffer.concat([Buffer.from(name), body]);
	let crc = 0xffffffff;
	for (const byte of data) {
		crc ^= byte;
		for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
	}
	const header = Buffer.alloc(4),
		trailer = Buffer.alloc(4);
	header.writeUInt32BE(body.length);
	trailer.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
	return Buffer.concat([header, data, trailer]);
}

export function threePalette() {
	const header = Buffer.alloc(13);
	header.writeUInt32BE(2, 0);
	header.writeUInt32BE(2, 4);
	header[8] = 8;
	header[9] = 6;
	const pixels = Buffer.from([
		0, 255, 32, 16, 255, 16, 255, 32, 255, 0, 16, 32, 255, 255, 255, 255, 32,
		255,
	]);
	return Buffer.concat([
		Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
		pngChunk("IHDR", header),
		pngChunk("IDAT", deflateSync(pixels)),
		pngChunk("IEND", Buffer.alloc(0)),
	]);
}

export function threeModel(scale = 1) {
	const arrays = [
		new Float32Array([-0.6, -0.6, 0, 0.6, -0.6, 0, 0.6, 0.6, 0, -0.6, 0.6, 0]),
		new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]),
		new Float32Array([0, 1, 1, 1, 1, 0, 0, 0]),
		new Uint16Array([0, 1, 2, 0, 2, 3]),
	];
	for (let i = 0; i < arrays[0].length; i++) arrays[0][i] *= scale;
	const parts = arrays.map((value) => Buffer.from(value.buffer));
	parts.push(threePalette());
	let offset = 0;
	const bufferViews = parts.map((part) => {
		const view = { buffer: 0, byteOffset: offset, byteLength: part.length };
		offset += part.length;
		return view;
	});
	const binary = Buffer.concat(parts),
		bin = Buffer.alloc(Math.ceil(binary.length / 4) * 4);
	binary.copy(bin);
	const model = {
		asset: { version: "2.0", generator: "Rocut fixture" },
		scene: 0,
		scenes: [{ nodes: [0] }],
		nodes: [{ mesh: 0 }],
		buffers: [{ byteLength: binary.length }],
		bufferViews,
		accessors: [
			{
				bufferView: 0,
				componentType: 5126,
				count: 4,
				type: "VEC3",
				min: [-0.6, -0.6, 0],
				max: [0.6, 0.6, 0],
			},
			{ bufferView: 1, componentType: 5126, count: 4, type: "VEC3" },
			{ bufferView: 2, componentType: 5126, count: 4, type: "VEC2" },
			{ bufferView: 3, componentType: 5123, count: 6, type: "SCALAR" },
		],
		meshes: [
			{
				primitives: [
					{
						attributes: { POSITION: 0, NORMAL: 1, TEXCOORD_0: 2 },
						indices: 3,
						material: 0,
					},
				],
			},
		],
		images: [{ bufferView: 4, mimeType: "image/png" }],
		samplers: [{ magFilter: 9728, minFilter: 9728 }],
		textures: [{ source: 0, sampler: 0 }],
		materials: [
			{
				doubleSided: true,
				pbrMetallicRoughness: {
					baseColorTexture: { index: 0 },
					metallicFactor: 0,
					roughnessFactor: 1,
				},
			},
		],
	};
	const text = Buffer.from(JSON.stringify(model)),
		json = Buffer.alloc(Math.ceil(text.length / 4) * 4, 32);
	text.copy(json);
	return Buffer.concat([
		u32(0x46546c67),
		u32(2),
		u32(28 + json.length + bin.length),
		u32(json.length),
		u32(0x4e4f534a),
		json,
		u32(bin.length),
		u32(0x004e4942),
		bin,
	]);
}


// KHR_meshopt_compression GLB built from the fixed upstream meshoptimizer
// decoder test vectors (ATTRIBUTES v1 stream), matching the shared producer
// and consumer acceptance fixtures. Decoded positions are [0,0,0],[300,0,0],
// [0,300,0],[300,300,0] under KHR_mesh_quantization.
const meshoptVertexV1 = Buffer.from([
	0xa1,0xee,0xaa,0xee,0,0x4b,0x4b,0x4b,0,0,0x4b,0,
	0,0x7d,0x7d,0x7d,0,0,0x7d,0,0,0,0,0,
	0,0,0,0,0,0,0,0,0,0,0,0,
	0,0,0,0,0,0x62,0,0x62,
]);
export function meshoptModel(extension = "KHR_meshopt_compression") {
	if (extension !== "KHR_meshopt_compression" && extension !== "EXT_meshopt_compression")
		throw Error(`Unsupported meshopt extension fixture: ${extension}`);
	const encoded = extension === "EXT_meshopt_compression"
		? Buffer.from([
			0xa0,1,0x3f,0,0,0,0x58,0x57,0x58,1,0x26,0,
			0,0,1,0x0c,0,0,0,0x58,1,8,0,0,
			0,0,0,0,0,1,0x3f,0,0,0,0x17,0x18,
			0x17,1,0x26,0,0,0,1,0x0c,0,0,0,0x17,
			1,8,0,0,0,0,0,0,0,0,0,0,
			0,0,0,0,0,0,0,0,0,0,0,0,
			0,0,0,0,0,0,0,0,0,0,0,0,
			0
		])
		: meshoptVertexV1;
	const json = {
		asset: { version: "2.0", generator: "Rocut meshopt fixture" },
		scene: 0,
		scenes: [{ nodes: [0] }],
		nodes: [{ mesh: 0 }],
		extensionsUsed: [extension, "KHR_mesh_quantization"],
		extensionsRequired: [extension, "KHR_mesh_quantization"],
		buffers: [
			{ byteLength: Math.ceil(encoded.length / 4) * 4 },
			{ byteLength: 48 },
		],
		bufferViews: [
			{
				buffer: 1,
				byteOffset: 0,
				byteLength: 48,
				byteStride: 12,
				extensions: {
					[extension]: {
						buffer: 0,
						byteOffset: 0,
						byteLength: encoded.length,
						byteStride: 12,
						count: 4,
						mode: "ATTRIBUTES",
					},
				},
			},
		],
		accessors: [{
			bufferView: 0,
			componentType: 5123,
			count: 4,
			type: "VEC3",
			min: [0, 0, 0],
			max: [300, 300, 0],
		}],
		meshes: [{ primitives: [{ mode: 5, attributes: { POSITION: 0 } }] }],
	};
	const text = Buffer.from(JSON.stringify(json));
	const jsonChunk = Buffer.alloc(Math.ceil(text.length / 4) * 4, 32);
	text.copy(jsonChunk);
	const bin = encoded;
	const binChunk = Buffer.alloc(Math.ceil(bin.length / 4) * 4);
	bin.copy(binChunk);
	return Buffer.concat([
		u32(0x46546c67),
		u32(2),
		u32(28 + jsonChunk.length + binChunk.length),
		u32(jsonChunk.length),
		u32(0x4e4f534a),
		jsonChunk,
		u32(binChunk.length),
		u32(0x004e4942),
		binChunk,
	]);
}

export function meshoptExpectedPositions() {
	return [0, 0, 0, 300, 0, 0, 0, 300, 0, 300, 300, 0];
}

export function threeEnvironment(exr: boolean, width = 64, height = 32) {
	if (!exr)
		return Buffer.concat([
			Buffer.from(
				`#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n-Y ${height} +X ${width}\n`,
			),
			Buffer.concat(
				Array.from({ length: width * height }, () =>
					// r185 HDRLoader divides RGBE mantissas by 255; this is exactly linear 1.
					Buffer.from([255, 255, 255, 128]),
				),
			),
		]);
	const attr = (name: string, type: string, value: Buffer) =>
		Buffer.concat([cstring(name), cstring(type), u32(value.length), value]);
	const box = Buffer.concat([u32(0), u32(0), u32(width - 1), u32(height - 1)]);
	const channels = Buffer.concat([
		...["B", "G", "R"].map((name) =>
			Buffer.concat([cstring(name), u32(2), u32(0), u32(1), u32(1)]),
		),
		Buffer.from([0]),
	]);
	const header = Buffer.concat([
		u32(20000630),
		u32(2),
		attr("channels", "chlist", channels),
		attr("compression", "compression", Buffer.from([0])),
		attr("dataWindow", "box2i", box),
		attr("displayWindow", "box2i", box),
		attr("lineOrder", "lineOrder", Buffer.from([0])),
		attr("pixelAspectRatio", "float", f32(1)),
		attr("screenWindowCenter", "v2f", Buffer.alloc(8)),
		attr("screenWindowWidth", "float", f32(1)),
		Buffer.from([0]),
	]);
	const rows = Array.from({ length: height }, (_, y) =>
		Buffer.concat([
			u32(y),
			u32(width * 12),
			...Array.from({ length: width * 3 }, () => f32(1)),
		]),
	);
	const offsets = Buffer.alloc(height * 8);
	for (let y = 0; y < height; y++)
		offsets.writeBigUInt64LE(
			BigInt(header.length + offsets.length + y * rows[0].length),
			y * 8,
		);
	return Buffer.concat([header, offsets, ...rows]);
}
