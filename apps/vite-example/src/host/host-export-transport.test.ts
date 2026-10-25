import { expect, test } from "bun:test";
import { reportExportProgress, uploadExportResult } from "./host-served";

async function transportFixture(run: () => Promise<void>) {
	const originalFetch = globalThis.fetch;
	const originalLocation = Object.getOwnPropertyDescriptor(
		globalThis,
		"location",
	);
	Object.defineProperty(globalThis, "location", {
		configurable: true,
		value: { href: "http://localhost/editor/" },
	});
	try {
		await run();
	} finally {
		globalThis.fetch = originalFetch;
		if (originalLocation)
			Object.defineProperty(globalThis, "location", originalLocation);
		else Reflect.deleteProperty(globalThis, "location");
	}
}

test("real progress transport forwards identity, bounded signal and cancellation response", () =>
	transportFixture(async () => {
		let request: RequestInit | undefined;
		let target: unknown;
		globalThis.fetch = (async (url, init) => {
			target = url;
			request = init;
			return new Response(JSON.stringify({ cancelRequested: true }));
		}) as typeof fetch;
		expect(
			await reportExportProgress({
				jobId: "job/id",
				progress: 0.75,
				token: "test-token",
			}),
		).toEqual({ cancelRequested: true });
		expect(target).toBe("http://localhost/editor/api/export/job%2Fid/progress");
		expect(request?.headers).toEqual({
			"content-type": "application/json",
			"x-native-export-token": "test-token",
		});
		expect(request?.body).toBe('{"progress":0.75}');
		expect(request?.signal).toBeInstanceOf(AbortSignal);
	}));

test("real progress transport aborts a never-settling response body", () =>
	transportFixture(async () => {
		let requestSignal: AbortSignal | undefined;
		globalThis.fetch = (async (_, init) => {
			requestSignal = init?.signal ?? undefined;
			return { ok: true, json: () => new Promise(() => {}) } as Response;
		}) as typeof fetch;
		const controller = new AbortController();
		const progress = reportExportProgress({
			jobId: "job",
			progress: 0.5,
			token: "test-token",
			signal: controller.signal,
		});
		await new Promise((resolve) => setTimeout(resolve, 0));
		controller.abort(new Error("test-cancel"));
		await expect(progress).rejects.toThrow("test-cancel");
		expect(requestSignal?.aborted).toBe(true);
	}));

test("progress success does not turn rejected output upload into success", () =>
	transportFixture(async () => {
		const requests: string[] = [];
		globalThis.fetch = (async (url) => {
			requests.push(String(url));
			return String(url).endsWith("/progress")
				? new Response(JSON.stringify({ cancelRequested: false }))
				: new Response("invalid output", { status: 409 });
		}) as typeof fetch;
		await reportExportProgress({
			jobId: "job",
			progress: 1,
			token: "test-token",
		});
		await expect(
			uploadExportResult({
				jobId: "job",
				token: "test-token",
				bytes: new ArrayBuffer(1),
			}),
		).rejects.toThrow("native-export-result-rejected");
		expect(requests.map((url) => url.split("/").at(-1))).toEqual([
			"progress",
			"result",
		]);
	}));
