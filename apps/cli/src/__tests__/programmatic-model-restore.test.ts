import { expect, spyOn, test } from "bun:test";
import {
	mkdtemp,
	mkdir,
	readFile,
	readdir,
	rm,
	symlink,
	writeFile,
} from "node:fs/promises";
import { join, resolve } from "node:path";
import { FileProjectStore } from "../file-store";
import { importProgrammaticResource } from "../programmatic/resource-import";
import {
	restoreModelSource,
	ModelRestoreIncompleteError,
} from "../programmatic/model-restore";
import { modelRestoreIo } from "../programmatic/model-restore-files";
import {
	describeResource,
	saveResourceBytes,
} from "../programmatic/resource-bytes";
import { resourceDigest } from "../programmatic/resources";

async function fixture() {
	const root = await mkdtemp("C:/tmps/rocut-model-restore-");
	const sourceDirectory = join(root, "author");
	await mkdir(join(sourceDirectory, "assets"), { recursive: true });
	const gltf = Buffer.from(
		JSON.stringify(
			{
				asset: { version: "2.0" },
				buffers: [{ uri: "assets/mesh.bin", byteLength: 4 }],
				bufferViews: [{ buffer: 0, byteLength: 4 }],
			},
			null,
			2,
		),
	);
	const bin = Buffer.from([1, 2, 3, 4]);
	await writeFile(join(sourceDirectory, "scene.gltf"), gltf);
	await writeFile(join(sourceDirectory, "assets", "mesh.bin"), bin);
	const context = {
		store: new FileProjectStore({
			root: join(root, "project"),
			schemaVersion: 1,
		}),
		projectId: "fixture",
	};
	const saved = await importProgrammaticResource({
		...context,
		input: {
			id: "scene.glb",
			kind: "model",
			mimeType: "model/gltf-binary",
			sourceDirectory,
			entryFile: "scene.gltf",
			files: ["scene.gltf", "assets/mesh.bin"],
		},
	});
	if (!("archive" in saved)) throw Error("Missing archive");
	const outputParent = join(root, "output");
	await mkdir(outputParent);
	return {
		root,
		sourceDirectory,
		gltf,
		bin,
		context,
		saved,
		outputParent,
		input: {
			resource: saved.archive.resource,
			outputDirectory: join(outputParent, "recovered"),
		},
	};
}

test("model source restores exact archive bytes with author directory unavailable and never overwrites output", async () => {
	const f = await fixture();
	try {
		await rm(f.sourceDirectory, { recursive: true });
		const result = await restoreModelSource({ ...f.context, input: f.input });
		expect(result.status).toBe("complete");
		expect(result.incomplete).toBe(false);
		expect(result.sourceFileCount).toBe(2);
		expect(await readFile(join(result.sourceDirectory, "scene.gltf"))).toEqual(
			f.gltf,
		);
		expect(
			await readFile(join(result.sourceDirectory, "assets", "mesh.bin")),
		).toEqual(f.bin);
		expect(JSON.parse(await readFile(result.archivePath, "utf8"))).toEqual(
			f.saved.archive.manifest,
		);
		expect(JSON.parse(await readFile(result.receiptPath, "utf8")).status).toBe(
			"complete",
		);
		expect(await f.context.store.load({ id: f.context.projectId })).toBeNull();
		await expect(
			restoreModelSource({ ...f.context, input: f.input }),
		).rejects.toThrow("EEXIST");
		expect(await readFile(join(result.sourceDirectory, "scene.gltf"))).toEqual(
			f.gltf,
		);
	} finally {
		await rm(resolve(f.root), { recursive: true, force: true });
	}
});

test("tampered closure, invalid archive and output links reject before output publication", async () => {
	const f = await fixture();
	try {
		for (const input of [
			{ ...f.input, outputDirectory: "relative" },
			{ ...f.input, extra: true },
			{ ...f.input, resource: f.saved.resource },
		])
			await expect(
				restoreModelSource({ ...f.context, input }),
			).rejects.toThrow();
		const manifest = structuredClone(f.saved.archive.manifest);
		manifest.files[1].path = "../escape.bin";
		const body = new TextEncoder().encode(JSON.stringify(manifest)).buffer;
		const forged = describeResource(
			{
				id: "invalid-model-archive.json",
				kind: "source",
				mimeType: "application/octet-stream",
			},
			body.byteLength,
			resourceDigest(body),
		);
		await saveResourceBytes(f.context, { resource: forged, body });
		await expect(
			restoreModelSource({
				...f.context,
				input: { ...f.input, resource: forged },
			}),
		).rejects.toThrow("portable relative paths");
		expect(await readdir(f.outputParent)).toEqual([]);
		await mkdir(join(f.root, "outside"));
		await symlink(
			join(f.root, "outside"),
			join(f.outputParent, "link"),
			"junction",
		);
		await expect(
			restoreModelSource({
				...f.context,
				input: {
					...f.input,
					outputDirectory: join(f.outputParent, "link", "escape"),
				},
			}),
		).rejects.toThrow("symlinks or junctions");
		expect(await readdir(join(f.root, "outside"))).toEqual([]);
		const dependency = f.saved.archive.manifest.files[1].resource;
		const attachment = await f.context.store.loadAttachment({
			projectId: f.context.projectId,
			key: dependency.attachmentKey,
		});
		if (!attachment) throw Error("Missing fixture attachment");
		await f.context.store.saveAttachment({
			projectId: f.context.projectId,
			key: dependency.attachmentKey,
			metadata: attachment.metadata,
			body: new Uint8Array([9, 9, 9, 9]).buffer,
		});
		await expect(
			restoreModelSource({ ...f.context, input: f.input }),
		).rejects.toThrow("integrity mismatch");
		expect(await readdir(f.outputParent)).toEqual(["link"]);
	} finally {
		await rm(resolve(f.root), { recursive: true, force: true });
	}
});

test("post-publication restore failure reports incomplete and retains written source without cleanup", async () => {
	const f = await fixture();
	const write = modelRestoreIo.writeFile;
	let writes = 0;
	const spy = spyOn(modelRestoreIo, "writeFile").mockImplementation(
		async (args) => {
			if (++writes === 2) throw Error("Deterministic output failure");
			return write(args);
		},
	);
	try {
		const result = await restoreModelSource({
			...f.context,
			input: f.input,
		}).catch((error) => error);
		expect(result instanceof ModelRestoreIncompleteError).toBe(true);
		expect(result.status).toBe("incomplete");
		expect(result.code).toBe("MODEL_RESTORE_INCOMPLETE");
		expect(result.directory).toBe(f.input.outputDirectory);
		expect(
			await readFile(join(result.directory, "source", "scene.gltf")),
		).toEqual(f.gltf);
		expect(await readdir(result.directory)).toEqual(["source"]);
	} finally {
		spy.mockRestore();
		await rm(resolve(f.root), { recursive: true, force: true });
	}
});
