import { expect, test } from "bun:test";
import { join } from "node:path";
import { mkdir, rename, symlink, writeFile } from "node:fs/promises";
import {
	imageSequenceRelativePath,
	openImageSequenceRoot,
	readImageSequenceFile,
} from "../programmatic/image-sequence-files";
import { imageSequenceFixture } from "./image-sequence-fixture";

test("safe sequence file IO rejects root/nested junctions, traversal and out-of-root manifests", async () => {
	const fixture = await imageSequenceFixture(1);
	try {
		const root = await openImageSequenceRoot(fixture.rootDirectory);
		const description = {
			id: "source",
			kind: "source" as const,
			mimeType: "application/octet-stream",
		};
		const part = fixture.manifest.provenance.sourceFiles[0].parts[0];
		expect(
			new Uint8Array(
				(await readImageSequenceFile({ root, path: part.id, description }))
					.body,
			),
		).toEqual(new Uint8Array([1, 2, 3]));
		for (const path of [
			"../secret",
			"a/../../secret",
			"C:/private",
			"frames\\000000.png",
			"/absolute",
			"frames/../sequence.json",
			"a/./file",
			"a//file",
			"CON",
			"frames/nul.png",
			"archive/COM1.blend",
			"frame.",
		]) {
			await expect(
				readImageSequenceFile({ root, path, description }),
			).rejects.toThrow("portable relative");
		}
		expect(() =>
			imageSequenceRelativePath({
				root,
				absolutePath: join(fixture.directory, "outside.json"),
			}),
		).toThrow("inside rootDirectory");
		const outside = join(fixture.directory, "outside");
		await mkdir(outside);
		await writeFile(join(outside, "part"), new Uint8Array([9]));
		await symlink(outside, join(fixture.rootDirectory, "link"), "junction");
		await expect(
			readImageSequenceFile({ root, path: "link/part", description }),
		).rejects.toThrow("symlinks or junctions");
		await symlink(
			fixture.rootDirectory,
			join(fixture.directory, "linked-root"),
			"junction",
		);
		await expect(
			openImageSequenceRoot(join(fixture.directory, "linked-root")),
		).rejects.toThrow("symlinks or junctions");
		await expect(
			readImageSequenceFile({
				root,
				path: part.id,
				description,
				signal: AbortSignal.abort(),
			}),
		).rejects.toThrow();
	} finally {
		await fixture.cleanup();
	}
});

test("sequence file IO rejects a replaced root identity after admission", async () => {
	const fixture = await imageSequenceFixture(1);
	try {
		const root = await openImageSequenceRoot(fixture.rootDirectory);
		await rename(
			fixture.rootDirectory,
			join(fixture.directory, "retained-author"),
		);
		await mkdir(fixture.rootDirectory);
		await writeFile(join(fixture.rootDirectory, "part"), new Uint8Array([9]));
		await expect(
			readImageSequenceFile({
				root,
				path: "part",
				description: {
					id: "part",
					kind: "source",
					mimeType: "application/octet-stream",
				},
			}),
		).rejects.toThrow("path changed while importing");
	} finally {
		await fixture.cleanup();
	}
});
