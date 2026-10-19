import { expect, test } from "bun:test";
import { fileURLToPath } from "node:url";
import type { MediaAsset } from "../types";

if (process.env.EDITOR_PREVIEW_PROJECT_TEST !== "1") {
	test("preview requests preserve durable project state and command history", () => {
		const result = Bun.spawnSync({
			cmd: [process.execPath, "test", fileURLToPath(import.meta.url)],
			cwd: process.cwd(),
			env: { ...process.env, EDITOR_PREVIEW_PROJECT_TEST: "1" },
			stdout: "pipe",
			stderr: "pipe",
		});
		if (result.exitCode !== 0)
			throw new Error(result.stdout.toString() + result.stderr.toString());
	});
} else {
	const { commandHarness } =
		await import("../../core/managers/__tests__/command-test-harness");
	const { MediaManager } = await import("../../core/managers/media-manager");
	const { projectFixture } =
		await import("../../editor/transactions/opencut/__tests__/fixture");
	test("a restored missing preview does not alter metadata, revision, dirty state or undo", async () => {
		const asset: MediaAsset = {
			id: "legacy",
			name: "offline.mp4",
			type: "video",
			duration: 3,
			file: new File([], "offline.mp4"),
		};
		const h = await commandHarness(projectFixture(), [asset]);
		const manager = new MediaManager({ editor: h.editor });
		try {
			const before = await h.fixture.store.load({
				id: h.getProject().metadata.id,
			});
			const revision = await h.transactions.revision();
			const dirty = h.getDirtySignals();
			const request = manager
				.getPreviewResources()
				.acquire({
					file: asset.file,
					time: 0,
					projectId: h.getProject().metadata.id,
				});
			expect(await request.promise).toEqual({ status: "offline" });
			request.release();
			expect(await h.transactions.revision()).toBe(revision);
			expect(h.getDirtySignals()).toBe(dirty);
			expect(
				await h.fixture.store.load({ id: h.getProject().metadata.id }),
			).toEqual(before);
			await h.command.undo();
			expect(await h.transactions.revision()).toBe(revision);
			expect(asset.thumbnailUrl).toBeUndefined();
		} finally {
			await manager.dispose();
			await h.transactions.dispose();
		}
	});
}
