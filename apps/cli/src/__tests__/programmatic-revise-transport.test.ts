import { expect, test } from "bun:test";
import { createServer } from "node:http";
import type { Server, ServerResponse } from "node:http";
import { createHttpProgrammaticFrames } from "../../../vite-example/src/host/http-programmatic-frames";

const source = {
	version: 1,
	runtime: "html-document",
	code: "<p>compiled output</p>",
	width: 64,
	height: 64,
	frameRate: { numerator: 30, denominator: 1 },
	durationFrames: 60,
	seed: 0,
} as const;
const result = { source, reusedDocument: false };
const request = {
	source,
	changes: [{ id: "index.html", code: "<p>new authoring text</p>" }],
	inputProps: { title: "updated" },
};

async function listen(server: Server) {
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const address = server.address();
	if (!address || typeof address === "string") throw Error("Missing test port");
	return `http://127.0.0.1:${address.port}/fixture-token/api/`;
}
async function close(server: Server) {
	server.closeAllConnections();
	await new Promise<void>((resolve) => server.close(() => resolve()));
}

test("revision HTTP sends the original request and validates result shape without claiming compilation", async () => {
	let reply = (response: ServerResponse) => {
		response
			.writeHead(200, { "content-type": "application/json; charset=utf-8" })
			.end(JSON.stringify(result));
	};
	const received: {
		url: string;
		method: string;
		contentType: string | undefined;
		body: unknown;
	}[] = [];
	const server = createServer(async (incoming, response) => {
		const chunks: Buffer[] = [];
		for await (const chunk of incoming) chunks.push(Buffer.from(chunk));
		received.push({
			url: incoming.url!,
			method: incoming.method!,
			contentType: incoming.headers["content-type"],
			body: JSON.parse(Buffer.concat(chunks).toString("utf8")),
		});
		reply(response);
	});
	const base = await listen(server);
	const provider = createHttpProgrammaticFrames({ base });
	const call = () =>
		provider.reviseBuild!({ request, signal: AbortSignal.timeout(2000) });
	try {
		expect(await call()).toEqual(result);
		expect(received[0]).toEqual({
			url: "/fixture-token/api/programmatic/build/revise",
			method: "POST",
			contentType: "application/json",
			body: request,
		});
		for (const malformed of [
			null,
			[],
			{},
			{ source },
			{ source, reusedDocument: "false" },
			{ ...result, extra: true },
			{ ...result, source: null },
			{ ...result, source: { ...source, runtime: "unknown" } },
			{ ...result, source: { ...source, unexpected: true } },
			{
				...result,
				source: { ...source, frameRate: { numerator: 30, denominator: "1" } },
			},
			{ ...result, source: { ...source, resources: [{}] } },
			{ ...result, source: { ...source, build: {} } },
		]) {
			reply = (response) => {
				response
					.writeHead(200, { "content-type": "application/json" })
					.end(JSON.stringify(malformed));
			};
			await expect(call()).rejects.toThrow(
				"Invalid programmatic build revision response",
			);
		}
		reply = (response) => {
			response
				.writeHead(200, { "content-type": "text/plain" })
				.end(JSON.stringify(result));
		};
		await expect(call()).rejects.toThrow(
			"Invalid programmatic build revision response",
		);
		reply = (response) => {
			response
				.writeHead(200, { "content-type": "text/html" })
				.end("<html>SPA fallback</html>");
		};
		await expect(call()).rejects.toThrow("expected JSON");
		for (const status of [401, 422, 503]) {
			reply = (response) => {
				response
					.writeHead(status, { "content-type": "application/json" })
					.end(JSON.stringify({ error: `host refused ${status}` }));
			};
			await expect(call()).rejects.toThrow(`host refused ${status}`);
		}
		reply = (response) => {
			response
				.writeHead(503, { "content-type": "text/plain" })
				.end("upstream unavailable");
		};
		await expect(call()).rejects.toThrow("returned 503");
	} finally {
		await close(server);
	}
});

test("revision cancellation preserves the reason, closes stalled JSON, and permits a fresh request", async () => {
	let seen!: () => void;
	let closed!: () => void;
	const received = new Promise<void>((resolve) => {
		seen = resolve;
	});
	const disconnected = new Promise<void>((resolve) => {
		closed = resolve;
	});
	let calls = 0;
	let reply = (response: ServerResponse) => {
		response.once("close", closed);
		response.writeHead(200, { "content-type": "application/json" });
		response.write('{"source":');
		seen();
	};
	const server = createServer((_incoming, response) => {
		calls++;
		reply(response);
	});
	const base = await listen(server);
	const provider = createHttpProgrammaticFrames({ base });
	const controller = new AbortController();
	try {
		const preaborted = new Error("preaborted revision");
		await expect(
			provider.reviseBuild!({ request, signal: AbortSignal.abort(preaborted) }),
		).rejects.toBe(preaborted);
		expect(calls).toBe(0);
		const pending = provider.reviseBuild!({
			request,
			signal: controller.signal,
		}).catch((error: unknown) => error);
		await received;
		const reason = new Error("cancelled revision draft");
		controller.abort(reason);
		expect(await pending).toBe(reason);
		await disconnected;
		reply = (response) => {
			response
				.writeHead(200, { "content-type": "application/json" })
				.end(JSON.stringify({ ...result, reusedDocument: true }));
		};
		expect(
			await provider.reviseBuild!({
				request,
				signal: AbortSignal.timeout(2000),
			}),
		).toEqual({ ...result, reusedDocument: true });
	} finally {
		controller.abort();
		await close(server);
	}
});
