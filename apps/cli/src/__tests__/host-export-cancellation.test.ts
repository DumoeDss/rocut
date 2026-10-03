import { describe, expect, test } from "bun:test";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createExportRegistry } from "../host-export";

const options = { format: "mp4", quality: "low" } as const;
async function fixture(
	run: (
		registry: ReturnType<typeof createExportRegistry>,
		root: string,
	) => Promise<void>,
) {
	const root = await mkdtemp(path.join(tmpdir(), "rocut-export-cancel-"));
	const registry = createExportRegistry({ projectDir: root });
	registry.attachSurface({ write() {} });
	try {
		await run(registry, root);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
}
async function outputs(root: string) {
	return readdir(path.join(root, "exports")).catch((error) => {
		if (error.code === "ENOENT") return [];
		throw error;
	});
}
describe("export cancellation and output settlement", () => {
	test("renderer cancellation acknowledgment is cancelled, not failed", () =>
		fixture(async (registry, root) => {
			const job = registry.start(options);
			registry.reportProgress(job.id, 0.2);
			registry.cancel(job.id);
			registry.fail(job.id, "cancelled");
			expect(registry.get(job.id)?.status).toBe("cancelled");
			expect(job.error).toBeUndefined();
			registry.reportProgress(job.id, 0.9);
			await registry.complete(job.id, new Uint8Array([1]));
			expect(job.status).toBe("cancelled");
			expect(await outputs(root)).toEqual([]);
		}));
	test("a genuine renderer error remains failed even after a cancellation request", () =>
		fixture(async (registry) => {
			const job = registry.start(options);
			registry.cancel(job.id);
			registry.fail(job.id, "encoder unavailable");
			expect(job.status).toBe("failed");
			expect(job.error).toBe("encoder unavailable");
		}));
	test("unsolicited cancellation text is not mistaken for a user cancellation", () =>
		fixture(async (registry) => {
			const job = registry.start(options);
			registry.fail(job.id, "cancelled");
			expect(job.status).toBe("failed");
		}));
	test("late successful bytes after a cancellation request are discarded", () =>
		fixture(async (registry, root) => {
			const job = registry.start(options);
			registry.cancel(job.id);
			await registry.complete(job.id, new Uint8Array([1, 2]));
			expect(job.status).toBe("cancelled");
			expect(job.outputPath).toBeUndefined();
			expect(await outputs(root)).toEqual([]);
		}));
	test("cancellation during asynchronous publication leaves no output", () =>
		fixture(async (registry, root) => {
			const job = registry.start(options);
			const writing = registry.complete(job.id, new Uint8Array([1, 2]));
			registry.cancel(job.id);
			await writing;
			expect(job.status).toBe("cancelled");
			expect(job.outputPath).toBeUndefined();
			expect(await outputs(root)).toEqual([]);
		}));
	test("failure during publication cannot be overwritten by completion", () =>
		fixture(async (registry, root) => {
			const job = registry.start(options);
			const writing = registry.complete(job.id, new Uint8Array([1, 2]));
			registry.fail(job.id, "surface disconnected");
			await writing;
			expect(job.status).toBe("failed");
			expect(job.error).toBe("surface disconnected");
			expect(await outputs(root)).toEqual([]);
		}));
	test("simultaneous duplicate uploads publish only the first result", () =>
		fixture(async (registry, root) => {
			const job = registry.start(options);
			await Promise.all([
				registry.complete(job.id, new Uint8Array([1, 2])),
				registry.complete(job.id, new Uint8Array([9])),
			]);
			expect(job.status).toBe("completed");
			expect(new Uint8Array(await readFile(job.outputPath!))).toEqual(
				new Uint8Array([1, 2]),
			);
			expect(await outputs(root)).toEqual([job.id + ".mp4"]);
			registry.cancel(job.id);
			expect(job.status).toBe("completed");
			expect(job.cancelRequested).toBe(false);
		}));
});
