import type { launchFrameBrowser } from "./chromium-process";
import {
	decodeReviewedHyperframesWorklet,
	HYPERFRAMES_FX_ORIGIN,
	HYPERFRAMES_FX_MODULE_URL,
	HYPERFRAMES_FX_WORKLET_BINDING,
	HYPERFRAMES_FX_WORKLET_REPLY,
	HYPERFRAMES_FX_WORKLET_SHA256,
	HYPERFRAMES_FX_WORKLET_GATE,
} from "./hyperframes-fx-worklet-gate";

type Browser = Awaited<ReturnType<typeof launchFrameBrowser>>;
const ORIGIN = HYPERFRAMES_FX_ORIGIN;
const DOCUMENT = `<!doctype html><meta charset=utf-8><meta http-equiv=Content-Security-Policy content="default-src 'none'; script-src ${HYPERFRAMES_FX_MODULE_URL}; worker-src ${HYPERFRAMES_FX_MODULE_URL}; connect-src 'none'"><title>Rocut private native FX</title>`;
export const HYPERFRAMES_FX_TARGET_POLICY = Object.freeze({
	origin: ORIGIN,
	document: DOCUMENT,
	workletSha256: HYPERFRAMES_FX_WORKLET_SHA256,
	moduleUrl: HYPERFRAMES_FX_MODULE_URL,
	workletGate: HYPERFRAMES_FX_WORKLET_GATE,
});

/** CDP fulfils this one fixed secure-origin document without any socket, DNS,
 * HTTP server or authored HTML. Only hash-admitted worklet bytes are served at
 * the fixed module URL; every other request fails. */
export async function createHyperframesFxTarget(
	browser: Browser,
	signal: AbortSignal,
	fatal: (error: Error) => void,
) {
	const target = await browser.send("Target.createTarget", {
		url: "about:blank",
	});
	const targetId = String(target.targetId);
	let removeListener = () => {};
	const jobs = new Set<Promise<void>>();
	let failed: Error | undefined;
	const close = async () => {
		removeListener();
		await Promise.all(jobs);
		if (!signal.aborted) await browser.send("Target.closeTarget", { targetId });
	};
	try {
		const attached = await browser.send("Target.attachToTarget", {
			targetId,
			flatten: true,
		});
		const sessionId = String(attached.sessionId);
		const send = (method: string, params: Record<string, unknown> = {}) =>
			browser.send(method, params, sessionId);
		let fulfilled = false;
		let reviewedModule: Buffer | undefined;
		let bindingJobs = 0;
		let resolveLoaded = () => {};
		let rejectLoaded = (_error: unknown) => {};
		const loaded = new Promise<void>((resolve, reject) => {
			resolveLoaded = resolve;
			rejectLoaded = reject;
		});
		// Install the rejection handler before navigation can synchronously fail.
		void loaded.catch(() => {});
		const abort = () =>
			rejectLoaded(signal.reason ?? Error("Native FX target cancelled"));
		signal.addEventListener("abort", abort, { once: true });
		const fail = (error: unknown) => {
			if (failed) return;
			failed = error instanceof Error ? error : Error(String(error));
			rejectLoaded(failed);
			fatal(failed);
		};
		const track = (action: Promise<unknown>) => {
			const job = action.then(() => {}, fail);
			jobs.add(job);
			void job.finally(() => jobs.delete(job)).catch(() => {});
		};
		removeListener = browser.onEvent((event) => {
			if (event.sessionId !== sessionId) return;
			if (event.method === "Page.loadEventFired") resolveLoaded();
			if (
				event.method === "Runtime.bindingCalled" &&
				event.params.name === HYPERFRAMES_FX_WORKLET_BINDING
			) {
				const { payload, executionContextId } = event.params;
				if (
					bindingJobs >= 2 ||
					typeof payload !== "string" ||
					payload.length > 18000 ||
					!Number.isSafeInteger(executionContextId) ||
					Number(executionContextId) < 1
				) {
					fail(Error("Invalid native audio worklet admission request"));
					return;
				}
				bindingJobs++;
				track(
					(async () => {
						try {
							const request: unknown = JSON.parse(payload);
							if (
								!request ||
								typeof request !== "object" ||
								Array.isArray(request)
							)
								throw Error("Invalid native audio worklet admission request");
							const record = request as Record<string, unknown>;
							if (
								record.version !== 1 ||
								!Number.isSafeInteger(record.id) ||
								Number(record.id) < 1 ||
								Object.keys(record).some(
									(key) => !["version", "id", "url"].includes(key),
								)
							)
								throw Error("Invalid native audio worklet admission request");
							const bytes = decodeReviewedHyperframesWorklet(record.url);
							if (bytes) reviewedModule = bytes;
							const reply = await send("Runtime.evaluate", {
								contextId: Number(executionContextId),
								expression: `window.${HYPERFRAMES_FX_WORKLET_REPLY}(${JSON.stringify({ id: record.id, ok: Boolean(bytes) })})`,
							});
							if (reply.exceptionDetails)
								throw Error("Native audio worklet admission reply failed");
						} finally {
							bindingJobs--;
						}
					})(),
				);
				return;
			}
			if (event.method !== "Fetch.requestPaused") return;
			const requestId = event.params.requestId;
			const url = (event.params.request as { url?: string } | undefined)?.url;
			const fulfill =
				!failed &&
				!fulfilled &&
				url === ORIGIN &&
				event.params.resourceType === "Document";
			if (fulfill) fulfilled = true;
			const action = fulfill
				? send("Fetch.fulfillRequest", {
						requestId,
						responseCode: 200,
						responseHeaders: [
							{ name: "Content-Type", value: "text/html; charset=utf-8" },
						],
						body: Buffer.from(DOCUMENT).toString("base64"),
					})
				: !failed && url === HYPERFRAMES_FX_MODULE_URL && reviewedModule
					? send("Fetch.fulfillRequest", {
							requestId,
							responseCode: 200,
							responseHeaders: [
								{
									name: "Content-Type",
									value: "text/javascript; charset=utf-8",
								},
								{ name: "Cache-Control", value: "no-store" },
							],
							body: reviewedModule.toString("base64"),
						})
					: send("Fetch.failRequest", {
							requestId,
							errorReason: "BlockedByClient",
						});
			track(action);
		});
		await send("Page.enable");
		await send("Runtime.enable");
		await send("Fetch.enable", { patterns: [{ urlPattern: "*" }] });
		try {
			const result = await send("Page.navigate", { url: ORIGIN });
			if (result.errorText)
				throw Error(
					`Native FX document navigation failed: ${result.errorText}`,
				);
			await loaded;
		} finally {
			signal.removeEventListener("abort", abort);
		}
		signal.throwIfAborted();
		if (failed) throw failed;
		await send("Runtime.addBinding", { name: HYPERFRAMES_FX_WORKLET_BINDING });
		const installed = await send("Runtime.evaluate", {
			expression: HYPERFRAMES_FX_WORKLET_GATE,
		});
		if (installed.exceptionDetails)
			throw Error("Native audio worklet gate unavailable");
		return {
			close,
			async evaluate(expression: string) {
				if (failed) throw failed;
				const result = await send("Runtime.evaluate", {
					expression,
					awaitPromise: true,
					returnByValue: true,
				});
				if (result.exceptionDetails)
					throw Error(
						"Native HyperFrames FX failed: " +
							JSON.stringify(result.exceptionDetails).slice(0, 1600),
					);
				await Promise.all(jobs);
				if (failed) throw failed;
				return (result.result as { value?: unknown } | undefined)?.value;
			},
		};
	} catch (error) {
		await close();
		throw error;
	}
}
