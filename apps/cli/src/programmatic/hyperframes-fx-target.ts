import type { launchFrameBrowser } from "./chromium-process";
import { hyperframesFxDigest } from "./hyperframes-fx-runtime";

type Browser = Awaited<ReturnType<typeof launchFrameBrowser>>;
const ORIGIN = "https://rocut-native-fx.invalid/";
const DOCUMENT =
	"<!doctype html><meta charset=utf-8><meta http-equiv=Content-Security-Policy content=\"default-src 'none'; script-src data:; worker-src data:; connect-src 'none'\"><title>Rocut private native FX</title>";
export const HYPERFRAMES_FX_TARGET_POLICY = Object.freeze({
	origin: ORIGIN,
	document: DOCUMENT,
	workletSha256:
		"42ea2bb89b51944e1ed848553d944a78b15fc55f676a8d139942434543d00c49",
});
const nativeWorklet = (url: string | undefined) => {
	const prefix = "data:text/javascript;base64,";
	if (
		!url?.startsWith(prefix) ||
		url.length > prefix.length + Math.ceil(12884 / 3) * 4
	)
		return false;
	const bytes = Buffer.from(url.slice(prefix.length), "base64");
	return (
		bytes.length === 12884 &&
		hyperframesFxDigest(bytes) === HYPERFRAMES_FX_TARGET_POLICY.workletSha256
	);
};

/** CDP fulfils this one fixed secure-origin document without any socket, DNS,
 * HTTP server or authored HTML. All other fetches fail; the reviewed native
 * implementation's locally generated data-URL AudioWorklets are not network IO.
 * core 0.8.139 deliberately uses data:, not blob:, for opaque-origin support. */
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
	const close = async () => {
		removeListener();
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
		removeListener = browser.onEvent((event) => {
			if (event.sessionId !== sessionId) return;
			if (event.method === "Page.loadEventFired") resolveLoaded();
			if (event.method !== "Fetch.requestPaused") return;
			const requestId = event.params.requestId;
			const url = (event.params.request as { url?: string } | undefined)?.url;
			const fulfill = !fulfilled && url === ORIGIN;
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
				: nativeWorklet(url)
					? send("Fetch.continueRequest", { requestId })
					: send("Fetch.failRequest", {
							requestId,
							errorReason: "BlockedByClient",
						});
			void action.catch((error) => {
				rejectLoaded(error);
				fatal(error instanceof Error ? error : Error(String(error)));
			});
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
		return {
			close,
			async evaluate(expression: string) {
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
				return (result.result as { value?: unknown } | undefined)?.value;
			},
		};
	} catch (error) {
		await close();
		throw error;
	}
}
