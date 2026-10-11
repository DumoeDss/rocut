import { posix } from "node:path";

function record(value: unknown): Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value))
		throw Error("Invalid glTF object");
	return value as Record<string, unknown>;
}
function integer(value: unknown): number {
	if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0)
		throw Error("Invalid glTF byte range");
	return value;
}
export function gltfFilePath(path: unknown): string {
	if (
		typeof path !== "string" ||
		!path ||
		/[\\:%?#<>"|*\u0000-\u001f\u007f]/.test(path) ||
		path
			.split("/")
			.some(
				(part) =>
					!part ||
					part === "." ||
					part === ".." ||
					/[. ]$/.test(part) ||
					/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part),
			)
	)
		throw Error(
			"glTF files and URIs must be plain portable relative paths (URLs, encoded paths and data URIs are unsupported)",
		);
	return path;
}

/** Packaging only: no author code, decoders, network requests or disk reads. */
export function archiveGltf({
	entryFile,
	files,
	admitBytes,
}: {
	entryFile: string;
	files: ReadonlyMap<string, ArrayBuffer>;
	admitBytes: (byteLength: number) => void;
}): ArrayBuffer {
	const original = files.get(entryFile);
	if (!original) throw Error("Missing declared glTF entry");
	const document = record(
		JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(original)),
	);
	const asset = record(document.asset);
	if (
		asset.version !== "2.0" ||
		(asset.minVersion !== undefined && asset.minVersion !== "2.0")
	)
		throw Error("Only glTF 2.0 is supported");
	const supportedExtensions = new Set([
		"KHR_texture_basisu",
		"EXT_texture_webp",
		"KHR_texture_transform",
		"KHR_materials_unlit",
		"KHR_materials_clearcoat",
		"KHR_materials_transmission",
		"KHR_materials_volume",
		"KHR_materials_ior",
		"KHR_materials_specular",
		"KHR_materials_sheen",
		"KHR_materials_emissive_strength",
		"KHR_materials_iridescence",
		"KHR_materials_anisotropy",
		"KHR_lights_punctual",
	]);
	for (const key of ["extensionsUsed", "extensionsRequired"]) {
		if (
			document[key] !== undefined &&
			(!Array.isArray(document[key]) ||
				document[key].some(
					(value) =>
						typeof value !== "string" || !supportedExtensions.has(value),
				))
		)
			throw Error(
				`Unsupported external glTF ${key}; import a self-contained GLB`,
			);
	}
	// Packaging transport caps: match Rust's 100,000-object decode ceiling,
	// and limit JSON depth without using the JavaScript call stack.
	const pending = [{ value: document as unknown, path: "", depth: 0 }];
	let objects = 0;
	while (pending.length) {
		const { value, path, depth } = pending.pop()!;
		if (!value || typeof value !== "object") continue;
		if (depth > 128 || ++objects > 100000)
			throw Error("glTF JSON exceeds packaging depth/object budget");
		for (const [key, item] of Object.entries(value)) {
			if (
				key === "extensions" &&
				Object.keys(record(item)).some((name) => !supportedExtensions.has(name))
			)
				throw Error(`Unsupported glTF extension at ${path}`);
			if (key === "uri" && !/^\/(buffers|images)\/\d+$/.test(path))
				throw Error(`Unsupported glTF dependency at ${path}/uri`);
			if (key === "EXT_meshopt_compression")
				throw Error(
					"External glTF EXT_meshopt_compression conversion is unsupported; import a self-contained GLB",
				);
			if (item && typeof item === "object") {
				if (objects + pending.length >= 100000)
					throw Error("glTF JSON exceeds packaging object budget");
				pending.push({ value: item, path: `${path}/${key}`, depth: depth + 1 });
			}
		}
	}
	const list = (key: string): Record<string, unknown>[] => {
		const value = document[key] ?? [];
		if (!Array.isArray(value)) throw Error(`glTF ${key} must be an array`);
		return value.map(record);
	};
	const used = new Set([entryFile]);
	const dependency = (uri: unknown): { path: string; bytes: Buffer } => {
		const path = posix.join(posix.dirname(entryFile), gltfFilePath(uri));
		const body = files.get(path);
		if (!body) throw Error(`Undeclared or missing glTF dependency: ${path}`);
		used.add(path);
		return { path, bytes: Buffer.from(body) };
	};
	const parts: Buffer[] = [];
	let byteLength = 0;
	const append = (bytes: Buffer): number => {
		const offset = byteLength;
		parts.push(bytes);
		const padding = (4 - (bytes.byteLength % 4)) % 4;
		if (padding) parts.push(Buffer.alloc(padding));
		byteLength += bytes.byteLength + padding;
		return offset;
	};
	const buffers = list("buffers");
	const offsets = buffers.map((buffer) => {
		const { bytes } = dependency(buffer.uri);
		if (integer(buffer.byteLength) !== bytes.byteLength)
			throw Error(
				"glTF buffer byteLength must exactly match its declared file",
			);
		return append(bytes);
	});
	const views = list("bufferViews");
	for (const view of views) {
		const buffer = integer(view.buffer);
		const offset = integer(view.byteOffset ?? 0);
		const length = integer(view.byteLength);
		if (
			!buffers[buffer] ||
			offset + length > integer(buffers[buffer].byteLength)
		)
			throw Error("glTF bufferView exceeds its buffer");
		view.buffer = 0;
		view.byteOffset = offsets[buffer] + offset;
	}
	for (const image of list("images")) {
		if (image.uri !== undefined) {
			if (image.bufferView !== undefined)
				throw Error("glTF image cannot contain both URI and bufferView");
			const { path, bytes } = dependency(image.uri);
			const mime = (
				{
					".png": "image/png",
					".jpg": "image/jpeg",
					".jpeg": "image/jpeg",
					".webp": "image/webp",
					".ktx2": "image/ktx2",
				} as Record<string, string>
			)[posix.extname(path).toLowerCase()];
			if (!mime || (image.mimeType !== undefined && image.mimeType !== mime))
				throw Error(`Unsupported or mismatched glTF image type: ${path}`);
			const valid =
				mime === "image/png"
					? bytes
							.subarray(0, 8)
							.equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
					: mime === "image/jpeg"
						? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
						: mime === "image/webp"
							? bytes.toString("ascii", 0, 4) === "RIFF" &&
								bytes.toString("ascii", 8, 12) === "WEBP"
							: bytes
									.subarray(0, 12)
									.equals(
										Buffer.from([
											171, 75, 84, 88, 32, 50, 48, 187, 13, 10, 26, 10,
										]),
									);
			if (!valid) throw Error(`glTF image signature mismatch: ${path}`);
			image.bufferView = views.length;
			views.push({
				buffer: 0,
				byteOffset: append(bytes),
				byteLength: bytes.byteLength,
			});
			image.mimeType = mime;
			delete image.uri;
		} else if (
			!views[integer(image.bufferView)] ||
			!["image/png", "image/jpeg", "image/webp", "image/ktx2"].includes(
				String(image.mimeType),
			)
		)
			throw Error("Invalid or unsupported glTF embedded image");
	}
	if (used.size !== files.size)
		throw Error("Declared glTF closure contains unused files");
	document.buffers = byteLength ? [{ byteLength }] : [];
	document.bufferViews = views;
	const json = Buffer.from(JSON.stringify(document));
	const jsonLength = Math.ceil(json.byteLength / 4) * 4;
	const total = 12 + 8 + jsonLength + (byteLength ? 8 + byteLength : 0);
	admitBytes(total);
	const result = Buffer.alloc(total);
	result.writeUInt32LE(0x46546c67, 0);
	result.writeUInt32LE(2, 4);
	result.writeUInt32LE(total, 8);
	result.writeUInt32LE(jsonLength, 12);
	result.writeUInt32LE(0x4e4f534a, 16);
	result.fill(32, 20, 20 + jsonLength);
	json.copy(result, 20);
	if (byteLength) {
		result.writeUInt32LE(byteLength, 20 + jsonLength);
		result.writeUInt32LE(0x004e4942, 24 + jsonLength);
		Buffer.concat(parts, byteLength).copy(result, 28 + jsonLength);
	}
	return result.buffer.slice(
		result.byteOffset,
		result.byteOffset + result.byteLength,
	);
}
