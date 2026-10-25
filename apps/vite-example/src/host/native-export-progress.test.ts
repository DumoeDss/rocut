import { expect, test } from "bun:test";
import {
	createNativeExportProgress,
	withProgressDeadline,
} from "./native-export-progress";

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
const never = () => new Promise<never>(() => {});

test("a never-settling progress transport cannot block finish", async () => {
	const signals: AbortSignal[] = [];
	let cancellations = 0;
	const reporter = createNativeExportProgress({
		report: async (_, signal) => {
			signals.push(signal);
			return never();
		},
		onCancel: () => {
			cancellations++;
		},
		timeoutMs: 10,
	});
	reporter.report(0.2);
	await reporter.finish();
	expect(signals).toHaveLength(2);
	expect(signals.every((signal) => signal.aborted)).toBe(true);
	expect(cancellations).toBe(0);
});

test("rejected progress does not cancel or prevent final progress attempt", async () => {
	const values: number[] = [];
	let cancellations = 0;
	const reporter = createNativeExportProgress({
		report: async (progress) => {
			values.push(progress);
			throw new Error("native-export-progress-rejected");
		},
		onCancel: () => {
			cancellations++;
		},
	});
	reporter.report(0.2);
	await flush();
	await reporter.finish();
	expect(values).toEqual([0.2, 1]);
	expect(cancellations).toBe(0);
});

test("slow progress has one inflight request and keeps only the newest value", async () => {
	const values: number[] = [];
	const releases: (() => void)[] = [];
	const reporter = createNativeExportProgress({
		report: (progress) => {
			values.push(progress);
			return new Promise((resolve) =>
				releases.push(() => resolve({ cancelRequested: false })),
			);
		},
		onCancel: () => {},
	});
	reporter.report(0.1);
	await flush();
	for (let index = 2; index <= 1000; index++) reporter.report(index / 1001);
	expect(values).toEqual([0.1]);
	releases.shift()!();
	await flush();
	expect(values).toEqual([0.1, 1000 / 1001]);
	const finished = reporter.finish();
	releases.shift()!();
	await flush();
	expect(values).toEqual([0.1, 1000 / 1001, 1]);
	releases.shift()!();
	await finished;
	reporter.report(0.5);
	expect(values).toHaveLength(3);
});

test("normal completion reports the final value even with no frame callbacks", async () => {
	const values: number[] = [];
	const reporter = createNativeExportProgress({
		report: async (progress) => {
			values.push(progress);
			return { cancelRequested: false };
		},
		onCancel: () => {},
	});
	await reporter.finish();
	expect(values).toEqual([1]);
});

test("explicit response cancellation is retained; telemetry errors are not cancellation", async () => {
	let cancellations = 0;
	const reporter = createNativeExportProgress({
		report: async () => ({ cancelRequested: true }),
		onCancel: () => {
			cancellations++;
		},
	});
	reporter.report(0.1);
	await flush();
	expect(cancellations).toBe(1);
	reporter.stop();
});

test("abort releases finish immediately and ignores late response cancellation", async () => {
	const controller = new AbortController();
	let resolve!: (value: { cancelRequested: boolean }) => void;
	let requestSignal!: AbortSignal;
	let cancellations = 0;
	const reporter = createNativeExportProgress({
		report: (_, signal) => {
			requestSignal = signal;
			return new Promise((done) => {
				resolve = done;
			});
		},
		onCancel: () => {
			cancellations++;
		},
		signal: controller.signal,
	});
	reporter.report(0.2);
	await flush();
	const finish = reporter.finish();
	controller.abort();
	await finish;
	expect(requestSignal.aborted).toBe(true);
	resolve({ cancelRequested: true });
	await flush();
	expect(cancellations).toBe(0);
});

test("deadline covers response body reads as well as response headers", async () => {
	let signal!: AbortSignal;
	await expect(
		withProgressDeadline(
			async (requestSignal) => {
				signal = requestSignal;
				const response = { json: never };
				return await response.json();
			},
			{ timeoutMs: 10 },
		),
	).rejects.toThrow("native-export-progress-timeout");
	expect(signal.aborted).toBe(true);
});
