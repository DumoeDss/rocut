import { expect, test } from "bun:test";
import { fileURLToPath } from "node:url";

if (process.env.ROCUT_MANAGER_RESIDENCY_ISOLATED !== "1") {
	test("RendererManager raster retirement regression runs in an isolated CPU process", () => {
		const result = Bun.spawnSync({
			cmd: [process.execPath, "test", fileURLToPath(import.meta.url)],
			env: { ...process.env, ROCUT_MANAGER_RESIDENCY_ISOLATED: "1" },
			stdout: "pipe",
			stderr: "pipe",
		});
		if (result.exitCode !== 0)
			throw Error(result.stdout.toString() + result.stderr.toString());
	}, 15000);
} else {
	const { managerResidencyFixture } =
		await import("./renderer-manager-residency-fixture");
	async function expectObservedRecoveryFailure(work: Promise<void>) {
		let observed: unknown;
		try {
			await work;
		} catch (error) {
			observed = error;
		}
		const failures = (error: unknown): unknown[] =>
			error instanceof AggregateError
				? error.errors.flatMap(failures)
				: [error];
		expect(
			failures(observed).some(
				(error) =>
					error instanceof Error &&
					error.message === "GPU texture recovery failed",
			),
		).toBe(true);
	}
	test("public setRenderTree retires uncertain old-root sync without clearing another root's complete committed textures", async () => {
		const input = managerResidencyFixture();
		try {
			expect(input.bytes()).toBe(64);
			expect(input.cacheIds()).toEqual(["uncertain-old"]);
			let notified = 0;
			const unsubscribe = input.manager.subscribe(() => {
				notified++;
			});
			input.manager.setRenderTree({ renderTree: input.currentRoot });
			await input.drainTransactions();
			expect(input.manager.getRenderTree()).toBe(input.currentRoot);
			expect(notified).toBe(1);
			unsubscribe();
			expect(input.cacheIds()).toEqual(["current-raster", "committed-media"]);
			expect(input.bytes()).toBe(32);
			expect(input.domain.isPublishedScope(input.currentScope)).toBe(true);
			expect(input.domain.isPublishedScope(input.oldScope)).toBe(false);
			input.manager.setRenderTree({ renderTree: null });
			await input.drainTransactions();
			expect(input.cacheIds()).toEqual([]);
			expect(input.bytes()).toBe(0);
		} finally {
			await input.manager.dispose();
		}
	});
	test("failed Manager retirement retains both charges and stays observed by lifecycle drain", async () => {
		const input = managerResidencyFixture();
		input.failRecovery(true);
		input.manager.setRenderTree({ renderTree: input.currentRoot });
		await input.drainTransactions();
		expect(input.bytes()).toBe(64);
		expect(input.domain.isPublishedScope(input.currentScope)).toBe(true);
		expect(input.domain.isPublishedScope(input.oldScope)).toBe(true);
		await expectObservedRecoveryFailure(input.manager.suspend());
		expect(input.bytes()).toBe(64);
		input.failRecovery(false);
		await expectObservedRecoveryFailure(input.manager.dispose());
		expect(input.bytes()).toBe(0);
	});
}
