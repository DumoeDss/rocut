import type { ResolvedProgrammaticResource } from "@opencut/editor-contracts";
import type { launchFrameBrowser } from "./chromium-process";
import { decodeNativeVideoFrame, type NativeVideoDecoder } from "./video-decoder";

type Browser = Pick<Awaited<ReturnType<typeof launchFrameBrowser>>, "send" | "onEvent">;
interface VideoLimits { maxBytes: number; maxDimension: number; maxElements: number }

/** Per-frame native IO grant, limited to literal document/video attachment bytes.
 * It exposes no filesystem paths, decoder choices, commands or arbitrary URLs.
 */
export async function attachOffthreadBroker({ browser, session, decoder, code, resources, limits, signal, decodeFrame = decodeNativeVideoFrame }: {
	browser: Browser; session: string; decoder: NativeVideoDecoder; code: string;
	resources: readonly ResolvedProgrammaticResource[]; limits: VideoLimits; signal: AbortSignal;
	decodeFrame?: typeof decodeNativeVideoFrame;
}) {
	signal.throwIfAborted();
	const admitted = new Set(code.match(/data:video\/(?:mp4|webm);base64,[A-Za-z0-9+/]+={0,2}/g) ?? []);
	for (const item of resources) if (item.resource.kind === "video")
		admitted.add(`data:${item.resource.mimeType};base64,${Buffer.from(item.body).toString("base64")}`);
	const active = new Map<string, AbortController>(), jobs = new Set<Promise<void>>();
	const seen = new Set<string>();
	let queue = Promise.resolve(), requests = 0, failure: Error | undefined, disposed = false;
	const track = (job: Promise<void>) => {
		jobs.add(job);
		void job.then(() => jobs.delete(job), () => jobs.delete(job));
	};
	const send = async (contextId: number, reply: object) => {
		const result = await browser.send("Runtime.evaluate", {
		contextId, expression: `window.__rocutNativeFrameReply(${JSON.stringify(reply).replace(/</g, "\\u003c")})`,
		}, session);
		if (result.exceptionDetails) throw Error("Native frame reply context failed");
	};
	const unsubscribe = browser.onEvent(event => {
		if (event.sessionId !== session || event.method !== "Runtime.bindingCalled" || event.params.name !== "__rocutNativeFrameRequest") return;
		const contextId = event.params.executionContextId;
		if (!Number.isSafeInteger(contextId) || typeof event.params.payload !== "string" || disposed) return;
		let id: number | undefined, key: string | undefined;
		try {
			if (event.params.payload.length > Math.ceil(limits.maxBytes * 4 / 3) + 1024) throw Error("Native frame request exceeds the Rust byte limit");
			const request = JSON.parse(event.params.payload);
			if (request.version !== 1 || !Number.isSafeInteger(request.id) || request.id < 1) throw Error("Invalid native frame request");
			id = request.id; key = `${contextId}:${id}`;
			if (request.kind === "cancel") { active.get(key)?.abort(); return; }
			if (request.kind !== "frame" || ++requests > limits.maxElements) throw Error("Native frame request count exceeds the Rust limit");
			if (seen.has(key)) throw Error("Duplicate native frame request");
			seen.add(key);
			if (typeof request.src !== "string" || !admitted.has(request.src)) throw Error("Native frame source is not admitted for this document");
			if (!Number.isFinite(request.seconds) || request.seconds < 0 || typeof request.transparent !== "boolean" || typeof request.toneMapped !== "boolean")
				throw Error("Invalid native video time or decode options");
			const match = /^data:(video\/(mp4|webm));base64,([A-Za-z0-9+/]+={0,2})$/.exec(request.src);
			if (!match || match[3].length > Math.ceil(limits.maxBytes * 4 / 3) + 2) throw Error("Native video exceeds the Rust byte limit");
			const controller = new AbortController(), requestId = id!, requestKey = key;
			const abort = () => controller.abort();
			signal.addEventListener("abort", abort, { once: true });
			active.set(requestKey, controller);
			if (signal.aborted) abort();
			const job = queue.then(async () => {
				try {
					controller.signal.throwIfAborted();
					const result = await decodeFrame({ decoder, body: Buffer.from(match[3], "base64"),
						mimeType: match[1] as "video/mp4" | "video/webm", seconds: request.seconds, transparent: request.transparent,
						limits, signal: controller.signal, selection: "nearest", toneMapped: request.toneMapped });
					controller.signal.throwIfAborted();
					await send(contextId as number, { id: requestId, png: result.png.toString("base64") });
				} catch (error) {
					const message = controller.signal.aborted ? "Native video request aborted" : error instanceof Error ? error.message : "Native video frame failed";
					if (!controller.signal.aborted) failure ??= Error(message);
					await send(contextId as number, { id: requestId, error: message }).catch(() => {});
				} finally { active.delete(requestKey); signal.removeEventListener("abort", abort); }
			});
			queue = job; track(job);
		} catch (error) {
			failure ??= error instanceof Error ? error : Error("Invalid native frame request");
			if (id !== undefined) track(send(contextId as number, { id, error: failure.message }).catch(() => {}));
		}
	});
	const dispose = async () => {
		disposed = true; unsubscribe();
		for (const controller of active.values()) controller.abort();
		await Promise.allSettled(jobs);
	};
	try { await browser.send("Runtime.addBinding", { name: "__rocutNativeFrameRequest" }, session); }
	catch (error) { await dispose(); throw error; }
	return {
		async check() { while (jobs.size) await Promise.all(jobs); if (failure) throw failure; },
		dispose,
	};
}
