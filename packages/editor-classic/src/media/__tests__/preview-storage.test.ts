import { expect, test } from "bun:test";
import { fileURLToPath } from "node:url";

if (process.env.EDITOR_PREVIEW_STORAGE_TEST !== "1") {
	test("derived preview storage stays bounded and isolated", () => {
		const result = Bun.spawnSync({
			cmd: [process.execPath, "test", fileURLToPath(import.meta.url)],
			cwd: process.cwd(),
			env: { ...process.env, EDITOR_PREVIEW_STORAGE_TEST: "1" },
			stdout: "pipe",
			stderr: "pipe",
		});
		if (result.exitCode !== 0)
			throw new Error(result.stdout.toString() + result.stderr.toString());
	});
} else {
	const entries = new Map<string, string>();
	const request = (value: unknown) => {
		const result = {
			result: value,
			onsuccess: undefined as undefined | (() => void),
		};
		queueMicrotask(() => result.onsuccess?.());
		return result;
	};
	Object.defineProperty(globalThis, "indexedDB", {
		configurable: true,
		value: {
			open: () => {
				const result = {
					result: {
						transaction: () => {
							const transaction = {
								oncomplete: undefined as undefined | (() => void),
								objectStore: () => ({
									put: (...args: [string, string]) =>
										entries.set(args[1], args[0]),
									get: (key: string) => request(entries.get(key)),
									getAllKeys: () => request([...entries.keys()].sort()),
									getAll: () =>
										request(
											[...entries.keys()].sort().map((key) => entries.get(key)),
										),
									delete: (key: string) => entries.delete(key),
								}),
							};
							setTimeout(() => transaction.oncomplete?.(), 0);
							return transaction;
						},
					},
					onsuccess: undefined as undefined | (() => void),
				};
				queueMicrotask(() => result.onsuccess?.());
				return result;
			},
		},
	});
	const {
		writePreview,
		readPreview,
		MAX_PREVIEW_PAYLOAD_BYTES,
		MAX_PREVIEW_STORAGE_BYTES,
	} = await import("../preview-storage");
	const { MediaPreviewResources, previewPersistentKey } =
		await import("../preview-resource");
	test("caps each payload and total stored bytes", async () => {
		await writePreview({
			key: "oversized",
			value: "x".repeat(MAX_PREVIEW_PAYLOAD_BYTES),
		});
		expect(entries.has("oversized")).toBe(false);
		for (let i = 0; i < 40; i++)
			await writePreview({
				key: `frame-${i}`,
				value: "x".repeat(MAX_PREVIEW_PAYLOAD_BYTES / 2),
			});
		expect(
			[...entries.values()].reduce((sum, value) => sum + value.length * 2, 0),
		).toBeLessThanOrEqual(MAX_PREVIEW_STORAGE_BYTES);
		entries.clear();
	});
	test("same hashes in separate projects persist separate results", async () => {
		const file = new File(["video"], "video.mp4");
		const assetMetadata = Object.freeze({
			sourceSha256: "hash",
			importMetadata: Object.freeze({ duration: 3 }),
		});
		const before = JSON.stringify(assetMetadata);
		let count = 0;
		const resources = new MediaPreviewResources(async () => ({
			status: "ready",
			url: `frame-${++count}`,
		}));
		const a = resources.acquire({
			file,
			time: 0,
			sourceSha256: assetMetadata.sourceSha256,
			projectId: "a",
		});
		const b = resources.acquire({
			file,
			time: 0,
			sourceSha256: assetMetadata.sourceSha256,
			projectId: "b",
		});
		await Promise.all([a.promise, b.promise]);
		expect(
			await readPreview(
				previewPersistentKey({ projectId: "a", sha: "hash", time: 0 }),
			),
		).toBe("frame-1");
		expect(
			await readPreview(
				previewPersistentKey({ projectId: "b", sha: "hash", time: 0 }),
			),
		).toBe("frame-2");
		expect(JSON.stringify(assetMetadata)).toBe(before);
		a.release();
		b.release();
	});
}
