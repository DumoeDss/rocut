import { expect, test } from "bun:test";
import { InMemoryProjectStore } from "@opencut/editor-ports/in-memory";
import { SessionPersistenceCoordinator } from "../../editor/persistence";
import { mediaAttachmentsForHydration } from "../persistence";

test("media hydration excludes but preserves programmatic resources and source archives", async () => {
	const store = new InMemoryProjectStore();
	const persistence = new SessionPersistenceCoordinator(store);
	await store.saveAttachment({
		projectId: "mixed",
		key: "song",
		body: new Uint8Array([1, 2]).buffer,
		metadata: {
			id: "song",
			name: "original.wav",
			type: "audio",
			mimeType: "audio/wav",
			duration: 10,
		},
	});
	for (const prefix of [
		"programmatic-sha256-",
		"programmatic-source-sha256-",
	]) {
		await store.saveAttachment({
			projectId: "mixed",
			key: prefix + "a".repeat(64),
			body: new Uint8Array([3, 4]).buffer,
			metadata: {
				kind: "programmatic-resource",
				version: 1,
				sha256: "a".repeat(64),
				byteLength: 2,
				mimeType: prefix.includes("source")
					? "application/octet-stream"
					: "model/gltf-binary",
			},
		});
	}
	const before = await persistence.listAttachments({ projectId: "mixed" });
	const hydrated = mediaAttachmentsForHydration(before);
	expect(hydrated).toHaveLength(1);
	expect(hydrated[0].metadata).toMatchObject({
		id: "song",
		type: "audio",
		duration: 10,
	});
	expect([...new Uint8Array(hydrated[0].body)]).toEqual([1, 2]);
	expect(await persistence.listAttachments({ projectId: "mixed" })).toEqual(
		before,
	);
});

test("attachment prefixes alone and unknown tags do not hide corrupt media", () => {
	for (const metadata of [
		{},
		{ kind: "unknown-resource" },
		{ id: "bad", name: "bad", type: "model" },
	]) {
		expect(() =>
			mediaAttachmentsForHydration([
				{
					projectId: "mixed",
					key: "programmatic-sha256-" + "a".repeat(64),
					metadata,
					body: new ArrayBuffer(0),
				},
			]),
		).toThrow("Persisted media attachment metadata is corrupt");
	}
});
