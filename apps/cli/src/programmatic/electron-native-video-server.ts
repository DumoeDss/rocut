import { randomBytes } from "node:crypto";
import { createServer } from "node:http";
import type { FrameBrowserEvent } from "./chromium-process";
import { attachOffthreadBroker } from "./offthread-broker";

export const ELECTRON_NATIVE_VIDEO_PROTOCOL = "html-frames-native-video-v1";
export interface ElectronNativeVideoCallback {
	version: 1;
	endpoint: string;
	token: string;
}

/** Per-capture callback. Only the existing admitted Offthread broker can decode. */
export async function createElectronNativeVideoServer(
	input: Omit<
		Parameters<typeof attachOffthreadBroker>[0],
		"browser" | "session"
	>,
) {
	const token = randomBytes(32).toString("hex");
	const listeners = new Set<(event: FrameBrowserEvent) => void>();
	const replies = new Map<string, (value: object) => void>();
	const browser = {
		onEvent(listener: (event: FrameBrowserEvent) => void) {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
		async send(method: string, params: Record<string, unknown> = {}) {
			if (method === "Runtime.addBinding") return {};
			if (
				method !== "Runtime.evaluate" ||
				typeof params.expression !== "string"
			)
				throw Error("Unsupported native video callback operation");
			const prefix = "window.__rocutNativeFrameReply(";
			if (
				!params.expression.startsWith(prefix) ||
				!params.expression.endsWith(")")
			)
				throw Error("Invalid native video callback reply");
			const reply = JSON.parse(params.expression.slice(prefix.length, -1));
			replies.get(`${params.contextId}:${reply.id}`)?.(reply);
			return {};
		},
	};
	const broker = await attachOffthreadBroker({
		...input,
		browser,
		session: "electron-native-video",
	});
	const emit = (contextId: number, payload: string) => {
		for (const listener of listeners)
			listener({
				method: "Runtime.bindingCalled",
				sessionId: "electron-native-video",
				params: {
					name: "__rocutNativeFrameRequest",
					executionContextId: contextId,
					payload,
				},
			});
	};
	const maximum = Math.ceil((input.limits.maxBytes * 4) / 3) + 4096;
	const server = createServer((request, response) => {
		void (async () => {
			const json = (status: number, value: object) => {
				if (!response.destroyed)
					response
						.writeHead(status, {
							"content-type": "application/json",
							"cache-control": "no-store",
						})
						.end(JSON.stringify(value));
			};
			if (
				request.method !== "POST" ||
				request.url !== "/v1/native-video/frame" ||
				request.headers.authorization !== `Bearer ${token}`
			) {
				request.resume();
				json(403, { error: "Native video callback unavailable" });
				return;
			}
			let pendingKey: string | undefined;
			try {
				input.signal.throwIfAborted();
				let size = 0;
				const chunks: Buffer[] = [];
				for await (const chunk of request) {
					size += chunk.length;
					if (size > maximum)
						throw Error("Native video callback payload too large");
					chunks.push(Buffer.from(chunk));
				}
				const envelope = JSON.parse(
					new TextDecoder("utf-8", { fatal: true }).decode(
						Buffer.concat(chunks),
					),
				);
				if (
					envelope.version !== 1 ||
					!Number.isSafeInteger(envelope.contextId) ||
					envelope.contextId < 1 ||
					typeof envelope.payload !== "string" ||
					Object.keys(envelope).some(
						(field) => !["version", "contextId", "payload"].includes(field),
					)
				)
					throw Error("Invalid native video callback envelope");
				const message = JSON.parse(envelope.payload);
				if (!Number.isSafeInteger(message.id) || message.id < 1)
					throw Error("Invalid native video callback request ID");
				const key = `${envelope.contextId}:${message.id}`;
				if (message.kind === "cancel") {
					emit(envelope.contextId, envelope.payload);
					json(200, { id: message.id, cancelled: true });
					return;
				}
				if (replies.has(key))
					throw Error("Duplicate native video callback request");
				pendingKey = key;
				const result = new Promise<object>((resolve) =>
					replies.set(key, resolve),
				);
				response.once("close", () => {
					if (!response.writableEnded)
						emit(
							envelope.contextId,
							JSON.stringify({ version: 1, kind: "cancel", id: message.id }),
						);
				});
				emit(envelope.contextId, envelope.payload);
				json(200, await result);
			} catch {
				json(422, { error: "Native video callback rejected" });
			} finally {
				if (pendingKey) replies.delete(pendingKey);
			}
		})();
	});
	server.requestTimeout = 15_000;
	server.headersTimeout = 5_000;
	// Up to sixteen Rust-admitted frame requests and their cancellation posts.
	server.maxConnections = 32;
	let closing: Promise<void> | undefined;
	const dispose = () => {
		if (closing) return closing;
		closing = (async () => {
			const closed = new Promise<void>((resolve) =>
				server.close(() => resolve()),
			);
			server.closeAllConnections();
			await broker.dispose();
			for (const reply of replies.values())
				reply({ error: "Native video callback closed" });
			replies.clear();
			await closed;
		})();
		return closing;
	};
	const abort = () => {
		void dispose();
	};
	input.signal.addEventListener("abort", abort, { once: true });
	try {
		input.signal.throwIfAborted();
		await new Promise<void>((resolve, reject) => {
			server.once("error", reject);
			server.listen(0, "127.0.0.1", resolve);
		});
		input.signal.throwIfAborted();
		const address = server.address();
		if (!address || typeof address === "string")
			throw Error("Native video callback bind failed");
		return {
			callback: {
				version: 1 as const,
				endpoint: `http://127.0.0.1:${address.port}/v1/native-video/frame`,
				token,
			},
			check: broker.check,
			async dispose() {
				input.signal.removeEventListener("abort", abort);
				await dispose();
			},
		};
	} catch (error) {
		input.signal.removeEventListener("abort", abort);
		await dispose();
		throw error;
	}
}
