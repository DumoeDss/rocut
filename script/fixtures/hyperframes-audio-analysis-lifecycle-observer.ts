import assert from "node:assert/strict";

type Reply = Record<string, unknown>;
interface Event {
	method: string;
	params: Reply;
	sessionId?: string;
}

export async function lifecycleBounded<T>(
	promise: Promise<T>,
	label: string,
	milliseconds = 5000,
): Promise<T> {
	let timer: ReturnType<typeof setTimeout>;
	try {
		return await Promise.race([
			promise,
			new Promise<never>((_, reject) => {
				timer = setTimeout(() => reject(Error(label)), milliseconds);
			}),
		]);
	} finally {
		clearTimeout(timer!);
	}
}

/** A second connection observes only the endpoint read from the verified private profile. */
export async function observeLifecycleBrowser(endpoint: string) {
	const socket = new WebSocket(endpoint);
	const pending = new Map<
		number,
		{ resolve(reply: Reply): void; reject(error: Error): void }
	>();
	const listeners = new Set<(event: Event) => void>();
	let sequence = 0;
	let closed = false;
	const disconnected = new Promise<void>((resolve) =>
		socket.addEventListener(
			"close",
			() => {
				closed = true;
				for (const item of pending.values())
					item.reject(Error("Observed private Chromium closed"));
				pending.clear();
				resolve();
			},
			{ once: true },
		),
	);
	try {
		await lifecycleBounded(
			new Promise<void>((resolve, reject) => {
				socket.addEventListener("open", () => resolve(), { once: true });
				socket.addEventListener(
					"error",
					() => reject(Error("Cannot observe private Chromium")),
					{ once: true },
				);
			}),
			"Private Chromium observer connection timed out",
		);
		socket.addEventListener("message", ({ data }) => {
			const message = JSON.parse(String(data));
			if (message.method) {
				for (const listener of listeners) listener(message);
				return;
			}
			const item = pending.get(message.id);
			if (!item) return;
			pending.delete(message.id);
			if (message.error) item.reject(Error(message.error.message));
			else item.resolve(message.result ?? {});
		});
		const send = (method: string, params: Reply = {}, sessionId?: string) => {
			assert.equal(closed, false, "Observer must not send to a closed browser");
			const id = ++sequence;
			const response = new Promise<Reply>((resolve, reject) => {
				pending.set(id, { resolve, reject });
				socket.send(JSON.stringify({ id, method, params, sessionId }));
			});
			return lifecycleBounded(
				response,
				`Private observer ${method} timed out`,
			).finally(() => pending.delete(id));
		};
		return {
			disconnected,
			close: () => socket.close(),
			async pageIds() {
				const response = await send("Target.getTargets");
				const targets = response.targetInfos as {
					targetId: string;
					type: string;
				}[];
				return targets
					.filter((target) => target.type === "page")
					.map((target) => target.targetId)
					.sort();
			},
			async armNativeSeekPause() {
				let pause!: (event: Event) => void, fail!: (error: Error) => void;
				const paused = new Promise<Event>((resolve, reject) => {
					pause = resolve;
					fail = reject;
				});
				void paused.catch(() => {});
				listeners.add((event) => {
					if (event.method === "Debugger.paused") {
						const frames = event.params.callFrames as {
							functionName: string;
						}[];
						if (frames.some((frame) => frame.functionName === "holdNativeSeek"))
							pause(event);
						else void send("Debugger.resume", {}, event.sessionId).catch(fail);
					}
					if (event.method !== "Target.attachedToTarget") return;
					const sessionId = String(event.params.sessionId);
					void (async () => {
						await send("Debugger.enable", {}, sessionId);
						await send(
							"Target.setAutoAttach",
							{ autoAttach: true, waitForDebuggerOnStart: true, flatten: true },
							sessionId,
						);
						await send("Runtime.runIfWaitingForDebugger", {}, sessionId);
					})().catch(fail);
				});
				await send("Target.setAutoAttach", {
					autoAttach: true,
					waitForDebuggerOnStart: true,
					flatten: true,
				});
				return { paused };
			},
		};
	} catch (error) {
		socket.close();
		throw error;
	}
}
