import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

type Reply = Record<string, unknown>;
export interface FrameBrowserEvent { method: string; params: Reply; sessionId?: string }

/** A private process/profile, never an attachment to the user's browser. */
export async function launchFrameBrowser(
	executable: string,
	signal: AbortSignal,
) {
	signal.throwIfAborted();
	const parent = path.resolve(tmpdir());
	const profile = await mkdtemp(path.join(parent, "rocut-html-frame-"));
	const child = spawn(
		executable,
		[
			"--headless=new",
			// GPU DOM rasterization varied shadow/SVG edge pixels between fresh
			// targets. Keep WebGL/GPU compositing, but use stable CPU DOM raster.
			"--disable-gpu-rasterization",
			"--remote-debugging-port=0",
			"--remote-debugging-address=127.0.0.1",
			`--user-data-dir=${profile}`,
			"--no-first-run",
			"--no-default-browser-check",
			"--disable-extensions",
			"--disable-background-networking",
			"--disable-component-update",
			"--disable-sync",
			"--disable-default-apps",
			"--mute-audio",
			"about:blank",
		],
		{ windowsHide: true, stdio: ["ignore", "ignore", "pipe"] },
	);
	let socket: WebSocket | undefined;
	let sequence = 0;
	const listeners = new Set<(event: FrameBrowserEvent) => void>();
	const pending = new Map<
		number,
		{ resolve(value: Reply): void; reject(error: Error): void }
	>();
	const fail = (error: Error) => {
		for (const waiter of pending.values()) waiter.reject(error);
		pending.clear();
	};
	let exited = false;
	const exit = new Promise<void>((resolve) =>
		child.once("close", () => {
			exited = true;
			resolve();
		}),
	);
	const abort = () => {
		fail(new Error("HTML frame browser cancelled"));
		socket?.close();
		child.kill();
	};
	signal.addEventListener("abort", abort, { once: true });
	let cleanup: Promise<void> | undefined;
	const close = () =>
		(cleanup ??= (async () => {
			signal.removeEventListener("abort", abort);
			fail(new Error("HTML frame browser closed"));
			socket?.close();
			listeners.clear();
			if (!exited) child.kill();
			await exit;
			// Only this invocation's freshly allocated, direct temporary child is removable.
			if (
				path.dirname(profile) !== parent ||
				!path.basename(profile).startsWith("rocut-html-frame-")
			)
				throw new Error("Invalid HTML browser temporary directory");
			await rm(profile, {
				recursive: true,
				force: true,
				maxRetries: 3,
				retryDelay: 100,
			});
		})());
	try {
		const endpoint = await new Promise<string>((resolve, reject) => {
			let tail = "";
			child.stderr.on("data", (chunk: Buffer) => {
				tail = (tail + chunk.toString("utf8")).slice(-8192);
				const match =
					/DevTools listening on (ws:\/\/127\.0\.0\.1:\d+\/devtools\/browser\/[a-zA-Z0-9-]+)/.exec(
						tail,
					);
				if (match) resolve(match[1]);
			});
			child.once("error", () =>
				reject(new Error("Cannot launch configured HTML frame browser")),
			);
			child.once("close", () => reject(new Error("HTML frame browser exited")));
			if (signal.aborted) abort();
		});
		signal.throwIfAborted();
		socket = new WebSocket(endpoint);
		const connectedSocket = socket;
		await new Promise<void>((resolve, reject) => {
			connectedSocket.addEventListener("open", () => resolve(), { once: true });
			connectedSocket.addEventListener(
				"error",
				() => reject(new Error("HTML frame browser connection failed")),
				{ once: true },
			);
			connectedSocket.addEventListener(
				"close",
				() => reject(new Error("HTML frame browser connection closed")),
				{ once: true },
			);
		});
		signal.throwIfAborted();
		socket.addEventListener("message", ({ data }) => {
			try {
				const message = JSON.parse(String(data));
				if (typeof message.method === "string") {
					for (const listener of listeners) listener(message);
					return;
				}
				const waiter = pending.get(message.id);
				if (!waiter) return;
				pending.delete(message.id);
				if (message.error)
					waiter.reject(
						new Error(`HTML browser protocol: ${message.error.message}`),
					);
				else waiter.resolve(message.result ?? {});
			} catch {
				fail(new Error("Invalid HTML browser protocol response"));
			}
		});
		socket.addEventListener("close", () =>
			fail(new Error("HTML frame browser disconnected")),
		);
		socket.addEventListener("error", () =>
			fail(new Error("HTML frame browser connection failed")),
		);
		return {
			close,
			onEvent(listener: (event: FrameBrowserEvent) => void) {
				listeners.add(listener);
				return () => { listeners.delete(listener); };
			},
			send(
				method: string,
				params: Reply = {},
				sessionId?: string,
			): Promise<Reply> {
				signal.throwIfAborted();
				return new Promise((resolve, reject) => {
					const id = ++sequence;
					pending.set(id, { resolve, reject });
					try {
						connectedSocket.send(
							JSON.stringify({ id, method, params, sessionId }),
						);
					} catch {
						pending.delete(id);
						reject(new Error("HTML browser send failed"));
					}
				});
			},
		};
	} catch (error) {
		await close();
		throw error;
	}
}
