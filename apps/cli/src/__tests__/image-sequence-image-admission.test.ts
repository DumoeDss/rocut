import { expect, test } from "bun:test";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
	imageSequencePng,
	imageSequencePngWithHeader,
} from "../../../../script/fixtures/image-sequence-png";
import { importImageSequence } from "../programmatic/image-sequence-import";
import {
	loadImageSequenceClosure,
	saveImageSequenceResource,
	IMAGE_SEQUENCE_MIME,
} from "../programmatic/image-sequence-closure";
import { describeResource } from "../programmatic/resource-bytes";
import {
	descriptor,
	digest,
	imageSequenceFixture,
	ObservedSequenceStore,
} from "./image-sequence-fixture";

test("encoded image admission imports and reopens a real 2x1 PNG", async () => {
	const fixture = await imageSequenceFixture(1);
	try {
		const store = new ObservedSequenceStore();
		const context = { store, projectId: "valid-image-admission" };
		const imported = await importImageSequence({
			...context,
			input: fixture.input,
		});
		expect(imported.manifest.width).toBe(2);
		expect(imported.manifest.height).toBe(1);
		expect(store.saves).toContain(fixture.manifest.frames[0].attachmentKey);
		expect(store.saves.at(-1)).toBe(imported.resource.attachmentKey);
		const loaded = await loadImageSequenceClosure({
			...context,
			resource: imported.resource,
		});
		expect(loaded.manifest).toEqual(fixture.manifest);
	} finally {
		await fixture.cleanup();
	}
});

for (const failure of [
	"lying-manifest",
	"oversized-header",
	"truncated-frame",
] as const) {
	test(`encoded image admission rejects ${failure} before frame save or manifest publication`, async () => {
		const fixture = await imageSequenceFixture(1);
		try {
			const store = new ObservedSequenceStore();
			const original = fixture.manifest.frames[0];
			const bytes =
				failure === "oversized-header"
					? imageSequencePngWithHeader({ width: 8192, height: 8192 })
					: failure === "truncated-frame"
						? imageSequencePng(0).slice(0, 24)
						: imageSequencePng(0);
			const frame = descriptor(original.id, bytes, "image");
			await writeFile(join(fixture.rootDirectory, frame.id), bytes);
			await fixture.writeManifest({
				...fixture.manifest,
				width: failure === "lying-manifest" ? 1 : 2,
				frames: [frame],
			});
			await expect(
				importImageSequence({
					store,
					projectId: "image-admission",
					input: fixture.input,
				}),
			).rejects.toThrow();
			expect(store.saves).not.toContain(frame.attachmentKey);
			expect(
				(
					await store.listAttachmentHeaders({ projectId: "image-admission" })
				).some((header) =>
					JSON.stringify(header.metadata).includes(IMAGE_SEQUENCE_MIME),
				),
			).toBe(false);
		} finally {
			await fixture.cleanup();
		}
	});
}

test("full closure reopen verifies actual frame geometry even for a digest-correct preexisting archive", async () => {
	const fixture = await imageSequenceFixture(1);
	try {
		const store = new ObservedSequenceStore();
		const context = { store, projectId: "old-unchecked-archive" };
		for (const resource of [
			fixture.manifest.frames[0],
			fixture.manifest.provenance.originalManifest,
			...fixture.manifest.provenance.sourceFiles[0].parts,
		]) {
			const bytes = fixture.files.get(resource.id)!;
			await saveImageSequenceResource({
				...context,
				resource,
				body: bytes.slice().buffer,
			});
		}
		const bytes = new TextEncoder().encode(
			JSON.stringify({ ...fixture.manifest, width: 1 }),
		);
		const resource = describeResource(
			{
				id: "sequence/main",
				kind: "imageSequence",
				mimeType: IMAGE_SEQUENCE_MIME,
			},
			bytes.byteLength,
			digest(bytes),
		);
		await saveImageSequenceResource({
			...context,
			resource,
			body: bytes.buffer,
		});
		await expect(
			loadImageSequenceClosure({ ...context, resource }),
		).rejects.toThrow();
		// Admission failure is read-only; no automatic cleanup of shared bytes.
		expect(
			(await store.listAttachmentHeaders({ projectId: context.projectId }))
				.length,
		).toBe(5);
	} finally {
		await fixture.cleanup();
	}
});
