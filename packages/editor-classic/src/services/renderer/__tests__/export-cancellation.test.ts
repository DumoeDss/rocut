import { expect, spyOn, test } from "bun:test";
import {
	ExportCancelledError,
	waitForExportOperation,
} from "../export-cancellation";

test("an aborted operation never starts work", async () => {
	const controller = new AbortController();
	controller.abort();
	let started = false;
	await expect(
		waitForExportOperation({
			signal: controller.signal,
			operation: async () => {
				started = true;
			},
		}),
	).rejects.toBeInstanceOf(ExportCancelledError);
	expect(started).toBe(false);
});

test("cancellation settles a permanently blocked encoder and handles its late failure", async () => {
	const controller = new AbortController();
	let rejectEncoder!: (error: Error) => void;
	const pending = waitForExportOperation({
		signal: controller.signal,
		operation: () =>
			new Promise<void>((_resolve, reject) => {
				rejectEncoder = reject;
			}),
	});
	controller.abort();
	await expect(pending).rejects.toBeInstanceOf(ExportCancelledError);
	rejectEncoder(new Error("native encoder closed"));
	await Promise.resolve();
});

test("completed frames and failures do not accumulate abort listeners", async () => {
	const controller = new AbortController();
	const added = spyOn(controller.signal, "addEventListener");
	const removed = spyOn(controller.signal, "removeEventListener");
	try {
		for (let i = 0; i < 2000; i++)
			expect(
				await waitForExportOperation({
					signal: controller.signal,
					operation: async () => i,
				}),
			).toBe(i);
		await expect(
			waitForExportOperation({
				signal: controller.signal,
				operation: () => {
					throw new Error("sync");
				},
			}),
		).rejects.toThrow("sync");
		await expect(
			waitForExportOperation({
				signal: controller.signal,
				operation: async () => {
					throw new Error("async");
				},
			}),
		).rejects.toThrow("async");
		expect(added).toHaveBeenCalledTimes(2002);
		expect(removed).toHaveBeenCalledTimes(2002);
	} finally {
		added.mockRestore();
		removed.mockRestore();
	}
});
