import { deflateSync } from "node:zlib";

// Genuine 2x2 RGBA PNG: opaque red/green, half-transparent blue, transparent white.
export function particleAlphaPng() {
	const crc = (bytes: Uint8Array) => {
		let value = 0xffffffff;
		for (const byte of bytes) {
			value ^= byte;
			for (let bit = 0; bit < 8; bit++)
				value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
		}
		return (value ^ 0xffffffff) >>> 0;
	};
	const chunk = (type: string, body: Buffer) => {
		const name = Buffer.from(type),
			out = Buffer.alloc(body.length + 12);
		out.writeUInt32BE(body.length);
		name.copy(out, 4);
		body.copy(out, 8);
		out.writeUInt32BE(crc(Buffer.concat([name, body])), out.length - 4);
		return out;
	};
	const header = Buffer.alloc(13);
	header.writeUInt32BE(2);
	header.writeUInt32BE(2, 4);
	header[8] = 8;
	header[9] = 6;
	return Buffer.concat([
		Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
		chunk("IHDR", header),
		chunk(
			"IDAT",
			deflateSync(
				Buffer.from([
					0, 255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 0, 255, 128, 255, 255, 255,
					0,
				]),
			),
		),
		chunk("IEND", Buffer.alloc(0)),
	]);
}

// One real mesh combining node translation, one-bone skin and a morph target.
// The named clip drives all three channels, useful for downstream pose diagnostics.
export function particlePoseGlb() {
	const chunks: Buffer[] = [],
		views: object[] = [],
		accessors: object[] = [];
	let offset = 0;
	const add = (
		data: number[],
		type: string,
		count: number,
		min?: number[],
		max?: number[],
	) => {
		const body = Buffer.alloc(data.length * 4);
		data.forEach((value, index) => body.writeFloatLE(value, index * 4));
		views.push({ buffer: 0, byteOffset: offset, byteLength: body.length });
		chunks.push(body);
		offset += body.length;
		accessors.push({
			bufferView: views.length - 1,
			componentType: 5126,
			count,
			type,
			...(min ? { min, max } : {}),
		});
		return accessors.length - 1;
	};
	const position = add(
		[0, 0, 0, 1, 0, 0, 0, 1, 0],
		"VEC3",
		3,
		[0, 0, 0],
		[1, 1, 0],
	);
	const jointsBody = Buffer.alloc(24);
	views.push({ buffer: 0, byteOffset: offset, byteLength: 24 });
	chunks.push(jointsBody);
	offset += 24;
	accessors.push({
		bufferView: views.length - 1,
		componentType: 5123,
		count: 3,
		type: "VEC4",
	});
	const joints = accessors.length - 1;
	const weights = add([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0], "VEC4", 3);
	const morph = add(
		[0, 0, 0, 0, 0, 0, 0, 0, 1],
		"VEC3",
		3,
		[0, 0, 0],
		[0, 0, 1],
	);
	const inverse = add(
		[1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
		"MAT4",
		1,
	);
	const times = add([0, 1], "SCALAR", 2, [0], [1]);
	const translation = add([0, 0, 0, 0.5, 0, 0], "VEC3", 2);
	const bone = add([0, 0, 0, 0, 0.25, 0], "VEC3", 2);
	const morphAnimation = add([0, 1], "SCALAR", 2);
	const document = {
		asset: { version: "2.0" },
		scene: 0,
		scenes: [{ nodes: [0, 1] }],
		nodes: [{ name: "surface", mesh: 0, skin: 0 }, { name: "joint" }],
		meshes: [
			{
				weights: [0],
				primitives: [
					{
						attributes: {
							POSITION: position,
							JOINTS_0: joints,
							WEIGHTS_0: weights,
						},
						targets: [{ POSITION: morph }],
					},
				],
			},
		],
		skins: [{ joints: [1], skeleton: 1, inverseBindMatrices: inverse }],
		animations: [
			{
				name: "pose",
				samplers: [translation, bone, morphAnimation].map((output) => ({
					input: times,
					output,
					interpolation: "LINEAR",
				})),
				channels: [
					{ sampler: 0, target: { node: 0, path: "translation" } },
					{ sampler: 1, target: { node: 1, path: "translation" } },
					{ sampler: 2, target: { node: 0, path: "weights" } },
				],
			},
		],
		buffers: [{ byteLength: offset }],
		bufferViews: views,
		accessors,
	};
	const json = Buffer.from(JSON.stringify(document)),
		padded = Buffer.alloc(Math.ceil(json.length / 4) * 4, 32);
	json.copy(padded);
	const binary = Buffer.concat(chunks),
		result = Buffer.alloc(28 + padded.length + binary.length);
	result.writeUInt32LE(0x46546c67);
	result.writeUInt32LE(2, 4);
	result.writeUInt32LE(result.length, 8);
	result.writeUInt32LE(padded.length, 12);
	result.writeUInt32LE(0x4e4f534a, 16);
	padded.copy(result, 20);
	result.writeUInt32LE(binary.length, 20 + padded.length);
	result.writeUInt32LE(0x004e4942, 24 + padded.length);
	binary.copy(result, 28 + padded.length);
	return result;
}
