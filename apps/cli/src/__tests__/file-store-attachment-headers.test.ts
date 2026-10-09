import { expect, spyOn, test } from "bun:test";
import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { projectId } from "@opencut/editor-contracts";
import { FileProjectStore } from "../file-store";

const id = projectId("attachment-headers");
const tempParent = tmpdir();

async function fixture(
	run: (store: FileProjectStore, root: string) => Promise<void>,
) {
	const parent = await fs.realpath(tempParent);
	const root = await fs.mkdtemp(path.join(parent, "rocut-attachment-headers-"));
	try {
		const store = new FileProjectStore({ root, schemaVersion: 1 });
		await store.save({
			record: { id, schemaVersion: 1, data: {} },
			summary: { id, name: "headers", createdAt: "", updatedAt: "" },
		});
		await run(store, root);
	} finally {
		expect(await fs.realpath(root)).toBe(root);
		expect(path.dirname(root)).toBe(parent);
		expect(path.basename(root).startsWith("rocut-attachment-headers-")).toBe(
			true,
		);
		await fs.rm(root, { recursive: true, force: true });
	}
}

test("222 headers read zero attachment bodies and cannot imply body integrity", async () => {
	await fixture(async (store, root) => {
		for (let index = 0; index < 222; index += 1) {
			await store.saveAttachment({
				projectId: id,
				key: `frame-${String(index).padStart(3, "0")}`,
				metadata: { index, private: { keep: true } },
				body: new Uint8Array([index % 256]).buffer,
			});
		}
		// Metadata survives a missing body, but a full load must not succeed.
		await fs.rm(path.join(root, "attachments/frame-000/body.bin"));
		const reads = spyOn(fs, "readFile");
		const legacy = spyOn(store, "listAttachments").mockRejectedValue(
			new Error("legacy body enumeration"),
		);
		try {
			const headers = await store.listAttachmentHeaders({ projectId: id });
			expect(headers).toHaveLength(222);
			expect(headers.every((header) => !("body" in header))).toBe(true);
			expect(headers.find((header) => header.key === "frame-000")).toEqual({
				projectId: id,
				key: "frame-000",
				metadata: { index: 0, private: { keep: true } },
			});
			expect(legacy).not.toHaveBeenCalled();
			expect(
				reads.mock.calls.filter(([file]) =>
					String(file).endsWith("metadata.json"),
				),
			).toHaveLength(222);
			expect(
				reads.mock.calls.filter(([file]) => String(file).endsWith("body.bin")),
			).toHaveLength(0);
			(headers[0].metadata as { private: { keep: boolean } }).private.keep =
				false;
			expect(
				(await store.listAttachmentHeaders({ projectId: id }))[0].metadata,
			).toMatchObject({ private: { keep: true } });
			expect(
				await store.loadAttachment({ projectId: id, key: "frame-000" }),
			).toBeNull();
		} finally {
			reads.mockRestore();
			legacy.mockRestore();
		}
		expect(await store.listAttachments({ projectId: id })).toHaveLength(221);
	});
});

test("headers retain typed project authority, cancellation and corruption failures", async () => {
	await fixture(async (store, root) => {
		const other = projectId("other");
		await expect(
			store.listAttachmentHeaders({ projectId: other }),
		).rejects.toMatchObject({
			code: "conflict",
			operation: "list-attachments",
			scope: { kind: "project", projectId: other },
		});
		const controller = new AbortController();
		controller.abort();
		const reads = spyOn(fs, "readFile");
		try {
			await expect(
				store.listAttachmentHeaders({
					projectId: id,
					signal: controller.signal,
				}),
			).rejects.toMatchObject({
				code: "aborted",
				operation: "list-attachments",
				scope: { kind: "project", projectId: id },
			});
			expect(reads).not.toHaveBeenCalled();
		} finally {
			reads.mockRestore();
		}
		const during = new AbortController();
		const listing = store.listAttachmentHeaders({
			projectId: id,
			signal: during.signal,
		});
		during.abort();
		await expect(listing).rejects.toMatchObject({
			code: "aborted",
			operation: "list-attachments",
		});
		await store.saveAttachment({
			projectId: id,
			key: "broken",
			metadata: {},
			body: new ArrayBuffer(0),
		});
		await fs.writeFile(
			path.join(root, "attachments/broken/metadata.json"),
			"{",
			"utf8",
		);
		await expect(
			store.listAttachmentHeaders({ projectId: id }),
		).rejects.toMatchObject({
			code: "corrupt",
			operation: "list-attachments",
			scope: { kind: "project", projectId: id },
		});
		await fs.writeFile(path.join(root, "project.json"), "{", "utf8");
		await expect(
			store.listAttachmentHeaders({ projectId: id }),
		).rejects.toMatchObject({
			code: "corrupt",
			operation: "list-attachments",
			scope: { kind: "project", projectId: id },
		});
	});
});

test("deleted projects and attachments do not reappear through header enumeration", async () => {
	await fixture(async (store, root) => {
		expect(await store.listAttachmentHeaders({ projectId: id })).toEqual([]);
		await store.saveAttachment({
			projectId: id,
			key: "owned",
			metadata: {},
			body: new ArrayBuffer(0),
		});
		await store.removeAttachment({ projectId: id, key: "owned" });
		expect(await store.listAttachmentHeaders({ projectId: id })).toEqual([]);
		await store.saveAttachment({
			projectId: id,
			key: "orphan",
			metadata: {},
			body: new ArrayBuffer(0),
		});
		await store.remove({ id });
		expect(await fs.readdir(path.join(root, "attachments"))).toEqual([
			"orphan",
		]);
		expect(await store.listAttachmentHeaders({ projectId: id })).toEqual([]);
	});
});

test("enumeration ignores redirected child trees and refuses a redirected attachment root", async () => {
	await fixture(async (store, root) => {
		await fs.mkdir(path.join(root, "outside"));
		await fs.writeFile(
			path.join(root, "outside/metadata.json"),
			'{"outside":true}',
			"utf8",
		);
		await fs.mkdir(path.join(root, "attachments"));
		await fs.symlink(
			path.join(root, "outside"),
			path.join(root, "attachments/redirect"),
			"junction",
		);
		expect(await store.listAttachmentHeaders({ projectId: id })).toEqual([]);
		// Remove only the verified junction, never recursively remove its target.
		const redirected = path.join(root, "attachments/redirect");
		expect((await fs.lstat(redirected)).isSymbolicLink()).toBe(true);
		await fs.unlink(redirected);
		await fs.rmdir(path.join(root, "attachments"));
		await fs.symlink(
			path.join(root, "outside"),
			path.join(root, "attachments"),
			"junction",
		);
		try {
			await expect(
				store.listAttachmentHeaders({ projectId: id }),
			).rejects.toMatchObject({
				code: "corrupt",
				operation: "list-attachments",
				scope: { kind: "project", projectId: id },
			});
		} finally {
			await fs.unlink(path.join(root, "attachments"));
		}
	});
});
