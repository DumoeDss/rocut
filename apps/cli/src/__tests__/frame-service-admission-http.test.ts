import { expect, mock, test } from "bun:test";
import { createServer, request as httpRequest } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { EventEmitter } from "node:events";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";

if (process.env.ROCUT_FRAME_ADMISSION_ISOLATED !== "1") {
	test("frame route admission has an isolated renderer boundary", () => {
		const result = Bun.spawnSync({
			cmd: [process.execPath, "test", fileURLToPath(import.meta.url)],
			env: { ...process.env, ROCUT_FRAME_ADMISSION_ISOLATED: "1" },
			stdout: "pipe",
			stderr: "pipe",
		});
		if (result.exitCode !== 0)
			throw Error(result.stdout.toString() + result.stderr.toString());
	}, 15_000);
} else {
	type HeldFrame = { id: number; signal: AbortSignal; finish(): void };
	let frames: HeldFrame[] = [];
	mock.module("../programmatic/html-rasterizer", () => ({
		async renderHtmlPng({
			request,
			signal,
		}: {
			request: { id: number };
			signal: AbortSignal;
		}) {
			await new Promise<void>((resolve) => {
				frames.push({ id: request.id, signal, finish: resolve });
			});
			return Buffer.from([request.id]);
		},
	}));
	const { createProgrammaticFrameService } =
		await import("../programmatic/frame-service");
	const waitFor = async (predicate: () => boolean) => {
		const deadline = performance.now() + 1000;
		while (!predicate()) {
			if (performance.now() >= deadline)
				throw Error("Frame route observation timed out");
			await Bun.sleep(1);
		}
	};
	async function harness() {
		frames = [];
		const service = createProgrammaticFrameService(process.execPath, "");
		const server = createServer((request, response) => {
			void service.handle(request, response);
		});
		await new Promise<void>((resolve) =>
			server.listen(0, "127.0.0.1", resolve),
		);
		const address = server.address();
		if (!address || typeof address === "string")
			throw Error("No frame route address");
		const clients: AbortController[] = [];
		return {
			service,
			send(id: number) {
				const controller = new AbortController();
				clients.push(controller);
				const result = new Promise<{ status: number; bytes: number[] }>(
					(resolve, reject) => {
						const client = httpRequest(
							`http://127.0.0.1:${address.port}/frame`,
							{
								method: "POST",
								signal: controller.signal,
							},
							(response) => {
								const chunks: Buffer[] = [];
								response.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
								response.once("error", reject);
								response.once("end", () =>
									resolve({
										status: response.statusCode!,
										bytes: Array.from(Buffer.concat(chunks)),
									}),
								);
							},
						);
						client.once("error", reject);
						const abort = () =>
							client.destroy(
								new DOMException("Client cancelled", "AbortError"),
							);
						controller.signal.addEventListener("abort", abort, { once: true });
						client.once("close", () =>
							controller.signal.removeEventListener("abort", abort),
						);
						client.end(JSON.stringify({ id }));
					},
				);
				result.catch(() => {});
				return { result, controller };
			},
			async close() {
				for (const client of clients) client.abort();
				const disposed = service.dispose();
				for (const frame of frames) frame.finish();
				await disposed;
				const closed = new Promise<void>((resolve, reject) =>
					server.close((error) => (error ? reject(error) : resolve())),
				);
				server.closeAllConnections();
				await closed;
			},
		};
	}

	test("a healthy saturated route rejects the third HTTP frame until native capacity releases", async () => {
		const h = await harness();
		try {
			const first = h.send(1);
			await waitFor(() => frames.length === 1);
			const second = h.send(2);
			await waitFor(() => frames.length === 2);
			const third = h.send(3);
			expect((await third.result).status).toBe(429);
			expect(frames.map((frame) => frame.id)).toEqual([1, 2]);
			frames[0]!.finish();
			expect(await first.result).toEqual({ status: 200, bytes: [1] });
			const replacement = h.send(4);
			await waitFor(() => frames.length === 3);
			expect(frames[2]!.id).toBe(4);
			frames[1]!.finish();
			frames[2]!.finish();
			expect(await second.result).toEqual({ status: 200, bytes: [2] });
			expect(await replacement.result).toEqual({ status: 200, bytes: [4] });
		} finally {
			await h.close();
		}
	});

	test("route close holds an active slot until renderer drain; queued close never renders", async () => {
		frames = [];
		const service = createProgrammaticFrameService(process.execPath, "");
		const send = (id: number) => {
			const request = Readable.from([Buffer.from(JSON.stringify({ id }))]);
			Object.defineProperty(request, "complete", { value: true });
			let status = 0;
			const response = Object.assign(new EventEmitter(), {
				destroyed: false,
				writeHead(value: number) {
					status = value;
					return this;
				},
				end() {},
			});
			const work = service.handle(
				request as unknown as IncomingMessage,
				response as unknown as ServerResponse,
			);
			return { response, work: work.then(() => status) };
		};
		try {
			const first = send(1),
				second = send(2);
			await waitFor(() => frames.length === 2);
			first.response.emit("close");
			expect(frames.find((frame) => frame.id === 1)!.signal.aborted).toBe(true);
			// Only observed cancellation admits bounded replacements while cleanup drains.
			const discarded = send(3),
				next = send(4);
			discarded.response.emit("close");
			expect(await discarded.work).toBe(408);
			await Promise.resolve();
			expect(frames.map((frame) => frame.id)).toEqual([1, 2]);
			frames.find((frame) => frame.id === 1)!.finish();
			expect(await first.work).toBe(408);
			await waitFor(() => frames.length === 3);
			expect(frames[2]!.id).toBe(4);
			frames[1]!.finish();
			frames[2]!.finish();
			expect(await second.work).toBe(200);
			expect(await next.work).toBe(200);
		} finally {
			const disposed = service.dispose();
			for (const frame of frames) frame.finish();
			await disposed;
		}
	});
}
