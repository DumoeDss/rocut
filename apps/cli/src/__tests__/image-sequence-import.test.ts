import { expect, test } from "bun:test";
import { join } from "node:path";
import { rename, writeFile } from "node:fs/promises";
import { InMemoryProjectStore } from "@opencut/editor-ports/in-memory";
import { importImageSequence } from "../programmatic/image-sequence-import";
import {
	loadImageSequenceClosure,
	saveImageSequenceResource,
} from "../programmatic/image-sequence-closure";
import { importProgrammaticResource } from "../programmatic/resource-import";
import {
	imageSequenceFixture,
	ObservedSequenceStore,
} from "./image-sequence-fixture";

test("222-frame import publishes manifest last, readbacks each dependency and reopens after source removal", async () => {
	const fixture = await imageSequenceFixture(222);
	try {
		const store = new ObservedSequenceStore();
		const context = { store, projectId: "sequence-project" };
		const imported = await importImageSequence({
			...context,
			input: fixture.input,
		});
		expect(imported.dependencies).toBe(225);
		expect(imported.reusedDependencies).toBe(0);
		expect(store.saves).toHaveLength(226);
		expect(store.saves.at(-1)).toBe(imported.resource.attachmentKey);
		expect(store.maxConcurrentLoads).toBe(1);
		for (const key of store.saves) {
			const save = store.events.indexOf(`save:${key}`);
			expect(store.events[save + 1]).toBe(`load:${key}`);
		}
		expect(JSON.stringify(imported)).not.toContain('"body"');
		const again = await importImageSequence({
			...context,
			input: fixture.input,
		});
		expect(again.reused).toBe(true);
		expect(again.reusedDependencies).toBe(225);
		expect(store.saves).toHaveLength(226);
		await rename(
			fixture.rootDirectory,
			join(fixture.directory, "author-moved"),
		);
		const loaded = await loadImageSequenceClosure({
			...context,
			resource: imported.resource,
		});
		expect(loaded.manifest).toEqual(fixture.manifest);
		const restored = new InMemoryProjectStore();
		for (const header of await store.listAttachmentHeaders({
			projectId: context.projectId,
		})) {
			const attachment = await store.loadAttachment({
				projectId: context.projectId,
				key: header.key,
			});
			if (!attachment) throw Error("Fixture copy lost attachment");
			await restored.saveAttachment({ ...attachment, projectId: "restored" });
		}
		expect(
			(
				await loadImageSequenceClosure({
					store: restored,
					projectId: "restored",
					resource: imported.resource,
				})
			).manifest,
		).toEqual(fixture.manifest);
	} finally {
		await fixture.cleanup();
	}
});

for (const failure of [
	"file-digest",
	"source-order",
	"save",
	"readback",
	"cancel",
] as const) {
	test(`failed ${failure} import publishes no manifest and never deletes shared attachments`, async () => {
		const fixture = await imageSequenceFixture();
		try {
			const store = new ObservedSequenceStore();
			const context = { store, projectId: "sequence-project" };
			const first = fixture.manifest.frames[0];
			const bytes = fixture.files.get(first.id)!;
			await saveImageSequenceResource({
				...context,
				resource: first,
				body: bytes.slice().buffer,
			});
			const controller = new AbortController();
			if (failure === "file-digest")
				await writeFile(
					join(fixture.rootDirectory, fixture.manifest.frames[1].id),
					new Uint8Array([7]),
				);
			if (failure === "source-order")
				await fixture.writeManifest({
					...fixture.manifest,
					provenance: {
						...fixture.manifest.provenance,
						sourceFiles: fixture.manifest.provenance.sourceFiles.map(
							(file) => ({ ...file, parts: [...file.parts].reverse() }),
						),
					},
				});
			if (failure === "save")
				store.failSaveKey = fixture.manifest.frames[1].attachmentKey;
			if (failure === "readback")
				store.corruptReadbackKey = fixture.manifest.frames[1].attachmentKey;
			if (failure === "cancel") store.cancelAfterSave = controller;
			await expect(
				importImageSequence({
					...context,
					input: fixture.input,
					signal: controller.signal,
				}),
			).rejects.toThrow();
			const headers = await store.listAttachmentHeaders({
				projectId: context.projectId,
			});
			expect(headers.length).toBeGreaterThan(0);
			expect(
				headers.some((header) =>
					JSON.stringify(header.metadata).includes("vnd.rocut.image-sequence"),
				),
			).toBe(false);
			const retained = await store.loadAttachment({
				projectId: context.projectId,
				key: first.attachmentKey,
			});
			expect(new Uint8Array(retained!.body)).toEqual(bytes);
			expect(store.maxConcurrentLoads).toBe(1);
		} finally {
			await fixture.cleanup();
		}
	});
}

test("reopened closure rejects missing frame, changed frame bytes and corrupted source archive parts", async () => {
	const fixture = await imageSequenceFixture();
	try {
		const store = new InMemoryProjectStore();
		const context = { store, projectId: "sequence-project" };
		const imported = await importImageSequence({
			...context,
			input: fixture.input,
		});
		for (const resource of [
			fixture.manifest.frames[1],
			fixture.manifest.provenance.sourceFiles[0].parts[0],
		]) {
			const attachment = await store.loadAttachment({
				projectId: context.projectId,
				key: resource.attachmentKey,
			});
			if (!attachment) throw Error("Fixture attachment missing");
			await store.removeAttachment({
				projectId: context.projectId,
				key: resource.attachmentKey,
			});
			await expect(
				loadImageSequenceClosure({ ...context, resource: imported.resource }),
			).rejects.toThrow("Missing image sequence resource");
			await store.saveAttachment({
				...attachment,
				body: new Uint8Array([90]).buffer,
			});
			await expect(
				loadImageSequenceClosure({ ...context, resource: imported.resource }),
			).rejects.toThrow("integrity mismatch");
			await store.saveAttachment(attachment);
		}
		expect(
			(
				await loadImageSequenceClosure({
					...context,
					resource: imported.resource,
				})
			).manifest.frames,
		).toHaveLength(3);
		await expect(
			loadImageSequenceClosure({
				...context,
				resource: imported.resource,
				signal: AbortSignal.abort(),
			}),
		).rejects.toThrow();
	} finally {
		await fixture.cleanup();
	}
});

test("generic resource import cannot bypass image sequence closure admission", async () => {
	const store = new ObservedSequenceStore();
	await expect(
		importProgrammaticResource({
			store,
			projectId: "sequence-project",
			input: {
				id: "seq",
				kind: "imageSequence",
				filePath: "C:/must-not-open.json",
				mimeType: "application/vnd.rocut.image-sequence+json",
			},
		}),
	).rejects.toThrow("complete dependency closure");
	expect(store.events).toEqual([]);
});

test("legacy stores are rejected before filesystem IO or bulk body enumeration", async () => {
	const store = new ObservedSequenceStore();
	Object.defineProperty(store, "listAttachmentHeaders", { value: undefined });
	await expect(
		importImageSequence({
			store,
			projectId: "sequence-project",
			input: {
				id: "seq",
				rootDirectory: "C:/must-not-access",
				manifestPath: "C:/must-not-access/manifest.json",
			},
		}),
	).rejects.toThrow("metadata-only attachment enumeration");
	expect(store.events).toEqual([]);
});

test("original render manifest cannot self-reference the canonical import document", async () => {
	const fixture = await imageSequenceFixture();
	try {
		const store = new ObservedSequenceStore();
		await fixture.writeManifest({
			...fixture.manifest,
			provenance: {
				...fixture.manifest.provenance,
				originalManifest: {
					...fixture.manifest.provenance.originalManifest,
					id: "sequence.json",
				},
			},
		});
		await expect(
			importImageSequence({
				store,
				projectId: "sequence-project",
				input: fixture.input,
			}),
		).rejects.toThrow("must not refer to the canonical import manifest");
		expect(store.events).toEqual([]);
	} finally {
		await fixture.cleanup();
	}
});

test("cancelled imports and unknown transport fields fail before any attachment IO", async () => {
	const store = new ObservedSequenceStore();
	const input = {
		id: "seq",
		rootDirectory: "C:/must-not-access",
		manifestPath: "C:/must-not-access/manifest.json",
	};
	await expect(
		importImageSequence({
			store,
			projectId: "sequence-project",
			input,
			signal: AbortSignal.abort(),
		}),
	).rejects.toThrow();
	await expect(
		importImageSequence({
			store,
			projectId: "sequence-project",
			input: { ...input, files: [] },
		}),
	).rejects.toThrow("requires only id, manifestPath and rootDirectory");
	expect(store.events).toEqual([]);
});
