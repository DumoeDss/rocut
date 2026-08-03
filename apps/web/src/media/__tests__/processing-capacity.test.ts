import { expect, test } from "bun:test";
import { fileURLToPath } from "node:url";

if (process.env.OPENCUT_PROCESSING_CAPACITY_TEST_ISOLATED !== "1") {
	test("media capacity test runs with the wasm test double", () => {
		const result = Bun.spawnSync({
			cmd: [process.execPath, "test", fileURLToPath(import.meta.url)],
			cwd: process.cwd(),
			env: {
				...process.env,
				OPENCUT_PROCESSING_CAPACITY_TEST_ISOLATED: "1",
			},
			stderr: "pipe",
			stdout: "pipe",
		});
		if (result.exitCode !== 0) {
			throw new Error(
				`isolated processing capacity suite failed:\n${result.stdout.toString()}\n${result.stderr.toString()}`,
			);
		}
	});
} else {
	await import("@/editor/session/__tests__/wasm-test-mock");
	const { InMemoryProjectStore, InMemoryProjectStoreControl } =
		await import("@/editor/ports/in-memory");
	const { inspectMediaCapacity } = await import("../processing");

	test("distinguishes unavailable, unknown and zero remaining capacity", async () => {
		const control = new InMemoryProjectStoreControl();
		const store = new InMemoryProjectStore({ control });

		control.setInspection({
			availability: "unavailable",
			capacity: null,
			reason: "offline",
		});
		expect(await inspectMediaCapacity({ store, requiredBytes: 1 })).toEqual({
			canStore: false,
			availableBytes: null,
		});

		control.setInspection({ availability: "available", capacity: null });
		expect(await inspectMediaCapacity({ store, requiredBytes: 1 })).toEqual({
			canStore: true,
			availableBytes: null,
		});

		control.setInspection({
			availability: "available",
			capacity: { usedBytes: 10, totalBytes: 10, remainingBytes: 0 },
		});
		expect(await inspectMediaCapacity({ store, requiredBytes: 1 })).toEqual({
			canStore: false,
			availableBytes: 0,
		});
	});
}
