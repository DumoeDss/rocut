import { expect, spyOn, test } from "bun:test";
import { InMemoryProjectStore } from "../in-memory";

test("in-memory header enumeration clones only identity and opaque metadata", async () => {
	const store = new InMemoryProjectStore();
	await store.saveAttachment({
		projectId: "sequence",
		key: "b",
		metadata: new Map([["opaque", 7]]),
		body: new Uint8Array([1, 2, 3]).buffer,
	});
	await store.saveAttachment({
		projectId: "sequence",
		key: "a",
		metadata: { label: "frame" },
		body: new Uint8Array([4]).buffer,
	});
	const clone = globalThis.structuredClone;
	const copiedRoots: unknown[] = [];
	const cloning = spyOn(globalThis, "structuredClone").mockImplementation(
		(value) => {
			copiedRoots.push(value);
			if (typeof value === "object" && value !== null && "body" in value) {
				throw new Error("body must not enter the metadata clone");
			}
			return clone(value);
		},
	);
	try {
		const headers = await store.listAttachmentHeaders({
			projectId: "sequence",
		});
		expect(headers).toEqual([
			{ projectId: "sequence", key: "a", metadata: { label: "frame" } },
			{ projectId: "sequence", key: "b", metadata: new Map([["opaque", 7]]) },
		]);
		expect(copiedRoots).toHaveLength(2);
		if (!(headers[1].metadata instanceof Map))
			throw new Error("opaque map missing");
		headers[1].metadata.clear();
		expect(
			(await store.listAttachmentHeaders({ projectId: "sequence" }))[1]
				.metadata,
		).toEqual(new Map([["opaque", 7]]));
	} finally {
		cloning.mockRestore();
	}
	await store.removeAttachment({ projectId: "sequence", key: "a" });
	await store.remove({ id: "sequence" });
	expect(await store.listAttachmentHeaders({ projectId: "sequence" })).toEqual(
		[],
	);
});

test("in-memory headers retain the existing list-attachments cancellation identity", async () => {
	const store = new InMemoryProjectStore();
	const abort = new AbortController();
	abort.abort();
	await expect(
		store.listAttachmentHeaders({
			projectId: "sequence",
			signal: abort.signal,
		}),
	).rejects.toMatchObject({
		code: "aborted",
		operation: "list-attachments",
		scope: { kind: "project", projectId: "sequence" },
	});
});
