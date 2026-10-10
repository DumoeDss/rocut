import type { ProgrammaticSource } from "@opencut/editor-contracts";
import type { ParticleBrowser } from "./particle-broker";
import { enableParticleRootContext } from "./particle-capture-context";

/** Only the isolated root context owns the binding; authored code stays in the
 * opaque iframe, with external URLs blocked independently of its inner CSP. */
export async function openLiquidObjectBrowserContext(options: {
	browser: ParticleBrowser;
	source: ProgrammaticSource;
	signal: AbortSignal;
}) {
	const { browser, source, signal } = options;
	const target = await browser.send("Target.createTarget", {
		url: "about:blank",
	});
	const attached = await browser.send("Target.attachToTarget", {
		targetId: target.targetId,
		flatten: true,
	});
	if (typeof attached.sessionId !== "string" || !attached.sessionId)
		throw Error("Liquid browser returned no capture session");
	const session = attached.sessionId;
	const send = ({
		method,
		params = {},
	}: {
		method: string;
		params?: Record<string, unknown>;
	}) => browser.send(method, params, session);
	await send({ method: "Network.enable" });
	await send({ method: "Page.enable" });
	await send({
		method: "Network.setBlockedURLs",
		params: {
			urls: [
				"http://*",
				"https://*",
				"file://*",
				"ftp://*",
				"ws://*",
				"wss://*",
			],
		},
	});
	await send({
		method: "Emulation.setDeviceMetricsOverride",
		params: {
			width: source.width,
			height: source.height,
			deviceScaleFactor: 1,
			mobile: false,
		},
	});
	await send({
		method: "Emulation.setDefaultBackgroundColorOverride",
		params: { color: { r: 0, g: 0, b: 0, a: 0 } },
	});
	const context = await enableParticleRootContext({
		browser,
		session,
		signal,
		timeoutMs: 5000,
	});
	return { session, send, context };
}
