import { expect, test } from "bun:test";
import {
	mkdtemp,
	mkdir,
	writeFile,
	rm,
	symlink,
	truncate,
} from "node:fs/promises";
import { join, resolve } from "node:path";
import { FileProjectStore } from "../file-store";
import { importProgrammaticResource } from "../programmatic/resource-import";
import { loadProgrammaticResource } from "../programmatic/resources";
import { archiveGltf } from "../programmatic/gltf-archive";

const png = Buffer.from(
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aM6kAAAAASUVORK5CYII=",
	"base64",
);
const document = () => ({
	asset: { version: "2.0" },
	buffers: [{ uri: "mesh.bin", byteLength: 4 }],
	bufferViews: [{ buffer: 0, byteOffset: 1, byteLength: 2 }],
	images: [{ uri: "image.png" }],
});

test("glTF packaging rejects deep JSON, object floods and unsupported extension dependencies", () => {
	const packageDocument = (value: unknown) =>
		archiveGltf({
			entryFile: "scene.gltf",
			files: new Map([
				["scene.gltf", new TextEncoder().encode(JSON.stringify(value)).buffer],
			]),
			admitBytes: () => {},
		});
	let nested: unknown = {};
	for (let index = 0; index < 130; index++) nested = { nested };
	expect(() =>
		packageDocument({ asset: { version: "2.0" }, extras: nested }),
	).toThrow("depth/object budget");
	expect(() =>
		packageDocument({
			asset: { version: "2.0" },
			extras: Array.from({ length: 100001 }, () => ({})),
		}),
	).toThrow("object budget");
	expect(() =>
		packageDocument({
			asset: { version: "2.0" },
			extensionsRequired: ["EXT_meshopt_compression"],
		}),
	).toThrow("Unsupported");
	expect(() =>
		packageDocument({
			asset: { version: "2.0" },
			extras: { uri: "hidden.bin" },
		}),
	).toThrow("Unsupported glTF dependency");
});

test("GLB packaging aligns multiple buffers and accepts explicit png/jpeg/webp/ktx2 image dependencies", () => {
	const bytes = (value: Uint8Array): ArrayBuffer =>
		Uint8Array.from(value).buffer;
	const images = [
		["a.png", png],
		["b.jpeg", Buffer.from([255, 216, 255, 217])],
		["c.webp", Buffer.from("RIFF0000WEBP")],
		["d.ktx2", Buffer.from([171, 75, 84, 88, 32, 50, 48, 187, 13, 10, 26, 10])],
	] as const;
	const gltf = {
		asset: { version: "2.0" },
		buffers: [
			{ uri: "a.bin", byteLength: 3 },
			{ uri: "b.bin", byteLength: 2 },
		],
		bufferViews: [
			{ buffer: 0, byteLength: 3 },
			{ buffer: 1, byteOffset: 1, byteLength: 1 },
		],
		images: images.map(([uri]) => ({ uri })),
	};
	const files = new Map<string, ArrayBuffer>([
		["scene.gltf", new TextEncoder().encode(JSON.stringify(gltf)).buffer],
		["a.bin", bytes(Buffer.from([1, 2, 3]))],
		["b.bin", bytes(Buffer.from([4, 5]))],
		...images.map(([path, body]): [string, ArrayBuffer] => [path, bytes(body)]),
	]);
	let admitted = 0;
	const body = Buffer.from(
		archiveGltf({
			entryFile: "scene.gltf",
			files,
			admitBytes: (value) => {
				admitted = value;
			},
		}),
	);
	expect(admitted).toBe(body.byteLength);
	const length = body.readUInt32LE(12);
	const parsed = JSON.parse(body.toString("utf8", 20, 20 + length));
	expect(parsed.bufferViews[1].byteOffset).toBe(5);
	expect(
		parsed.images.map((image: { mimeType: string }) => image.mimeType),
	).toEqual(["image/png", "image/jpeg", "image/webp", "image/ktx2"]);
	expect(body.subarray(28 + length, 36 + length)).toEqual(
		Buffer.from([1, 2, 3, 0, 4, 5, 0, 0]),
	);
	expect(() =>
		archiveGltf({
			entryFile: "scene.gltf",
			files,
			admitBytes: () => {
				throw Error("Rust byte budget denied");
			},
		}),
	).toThrow("Rust byte budget denied");
	files.set("unused.bin", bytes(Buffer.from([1])));
	expect(() =>
		archiveGltf({ entryFile: "scene.gltf", files, admitBytes: () => {} }),
	).toThrow("unused files");
});

test("external glTF import prepares one self-contained GLB and restores every original author byte on reopen", async () => {
	const root = await mkdtemp("C:/tmps/rocut-gltf-import-");
	try {
		const sourceDirectory = join(root, "author");
		await mkdir(sourceDirectory);
		const original = Buffer.from(JSON.stringify(document(), null, 2));
		await writeFile(join(sourceDirectory, "scene.gltf"), original);
		await writeFile(
			join(sourceDirectory, "mesh.bin"),
			Buffer.from([1, 2, 3, 4]),
		);
		await writeFile(join(sourceDirectory, "image.png"), png);
		const options = { root: join(root, "project"), schemaVersion: 1 };
		const context = {
			store: new FileProjectStore(options),
			projectId: "fixture",
		};
		const input = {
			id: "scene.glb",
			kind: "model",
			mimeType: "model/gltf-binary",
			sourceDirectory,
			entryFile: "scene.gltf",
			files: ["scene.gltf", "mesh.bin", "image.png"],
		};
		const saved = await importProgrammaticResource({ ...context, input });
		if (!("archive" in saved)) throw Error("Missing model archive");
		const reopened = { ...context, store: new FileProjectStore(options) };
		const bytes = Buffer.from(
			(
				await loadProgrammaticResource({
					...reopened,
					resource: saved.resource,
				})
			).body,
		);
		expect(bytes.readUInt32LE(0)).toBe(0x46546c67);
		expect(bytes.readUInt32LE(4)).toBe(2);
		expect(bytes.readUInt32LE(8)).toBe(bytes.byteLength);
		const jsonLength = bytes.readUInt32LE(12);
		const gltf = JSON.parse(bytes.toString("utf8", 20, 20 + jsonLength));
		expect(gltf.buffers).toEqual([
			{ byteLength: 4 + Math.ceil(png.byteLength / 4) * 4 },
		]);
		expect(gltf.images).toEqual([{ bufferView: 1, mimeType: "image/png" }]);
		expect(gltf.bufferViews[0]).toEqual({
			buffer: 0,
			byteOffset: 1,
			byteLength: 2,
		});
		expect(bytes.subarray(28 + jsonLength, 32 + jsonLength)).toEqual(
			Buffer.from([1, 2, 3, 4]),
		);
		for (const file of saved.archive.manifest.files) {
			const archived = await loadProgrammaticResource({
				...reopened,
				resource: file.resource,
			});
			expect(Buffer.from(archived.body)).toEqual(
				file.path === "scene.gltf"
					? original
					: file.path === "image.png"
						? png
						: Buffer.from([1, 2, 3, 4]),
			);
		}
		const manifest = await loadProgrammaticResource({
			...reopened,
			resource: saved.archive.resource,
		});
		expect(JSON.parse(new TextDecoder().decode(manifest.body))).toEqual(
			saved.archive.manifest,
		);
		expect(
			(await importProgrammaticResource({ ...context, input })).reused,
		).toBe(true);
	} finally {
		await rm(resolve(root), { recursive: true, force: true });
	}
});

test("external glTF import rejects malicious or incomplete closures before publishing attachments", async () => {
	const root = await mkdtemp("C:/tmps/rocut-gltf-denied-");
	try {
		const sourceDirectory = join(root, "author");
		await mkdir(sourceDirectory);
		await writeFile(
			join(sourceDirectory, "mesh.bin"),
			Buffer.from([1, 2, 3, 4]),
		);
		await writeFile(join(sourceDirectory, "image.png"), png);
		const context = {
			store: new FileProjectStore({
				root: join(root, "project"),
				schemaVersion: 1,
			}),
			projectId: "fixture",
		};
		const input = {
			id: "scene.glb",
			kind: "model",
			mimeType: "model/gltf-binary",
			sourceDirectory,
			entryFile: "scene.gltf",
			files: ["scene.gltf", "mesh.bin", "image.png"],
		};
		for (const uri of [
			"../private.bin",
			"https://example.com/mesh.bin",
			"file:///private.bin",
			"data:application/octet-stream;base64,AQIDBA==",
			"%2e%2e/private.bin",
			"missing.bin",
			"a\\mesh.bin",
		]) {
			const bad = document();
			bad.buffers[0].uri = uri;
			await writeFile(join(sourceDirectory, "scene.gltf"), JSON.stringify(bad));
			await expect(
				importProgrammaticResource({ ...context, input }),
			).rejects.toThrow();
		}
		await writeFile(
			join(sourceDirectory, "scene.gltf"),
			JSON.stringify(document()),
		);
		for (const files of [
			["scene.gltf", "mesh.bin"],
			["scene.gltf", "mesh.bin", "image.png", "image.png"],
			["scene.gltf", "../private"],
			Array.from({ length: 100 }, (_, index) => `input${index}.bin`).concat(
				"scene.gltf",
			),
		])
			await expect(
				importProgrammaticResource({ ...context, input: { ...input, files } }),
			).rejects.toThrow();
		await mkdir(join(root, "outside"));
		await writeFile(
			join(root, "outside", "mesh.bin"),
			Buffer.from([1, 2, 3, 4]),
		);
		await symlink(
			join(root, "outside"),
			join(sourceDirectory, "linked"),
			"junction",
		);
		const linked = document();
		linked.buffers[0].uri = "linked/mesh.bin";
		await writeFile(
			join(sourceDirectory, "scene.gltf"),
			JSON.stringify(linked),
		);
		await expect(
			importProgrammaticResource({
				...context,
				input: {
					...input,
					files: ["scene.gltf", "linked/mesh.bin", "image.png"],
				},
			}),
		).rejects.toThrow("redirects");
		await writeFile(
			join(sourceDirectory, "scene.gltf"),
			JSON.stringify(document()),
		);
		await truncate(join(sourceDirectory, "mesh.bin"), 16777217);
		await expect(
			importProgrammaticResource({ ...context, input }),
		).rejects.toThrow("16777216");
		expect(
			await context.store.listAttachmentHeaders?.({
				projectId: context.projectId,
			}),
		).toEqual([]);
	} finally {
		await rm(resolve(root), { recursive: true, force: true });
	}
});
