import type { ResolvedProgrammaticResource } from "@opencut/editor-contracts";
import type { launchFrameBrowser } from "./chromium-process";
import { htmlAudioAnalysisExpression } from "./html-document";
import type { NativeAudioAnalysisConfig } from "./remotion-audio-bootstrap";

interface CollectionFrame {
	width: number;
	height: number;
	code: string;
	frame: unknown;
	resources: readonly ResolvedProgrammaticResource[];
	analysis: NativeAudioAnalysisConfig;
	signal: AbortSignal;
}

/** A fresh isolated target for each admitted picture frame or native seek.
 * Lifetime, serialized access, source admission and deadlines belong to the owner.
 */
export async function collectHyperframesAudioSnapshot(
	browser: Awaited<ReturnType<typeof launchFrameBrowser>>,
	options: CollectionFrame,
): Promise<unknown> {
	let targetId: unknown;
	try {
		const target = await browser.send("Target.createTarget", {
			url: "about:blank",
		});
		targetId = target.targetId;
		const attached = await browser.send("Target.attachToTarget", {
			targetId,
			flatten: true,
		});
		const send = (method: string, params = {}) =>
			browser.send(method, params, String(attached.sessionId));
		await send("Network.enable");
		await send("Network.setBlockedURLs", {
			urls: [
				"http://*",
				"https://*",
				"file://*",
				"ftp://*",
				"ws://*",
				"wss://*",
			],
		});
		await send("Page.enable");
		await send("Emulation.setDeviceMetricsOverride", {
			width: options.width,
			height: options.height,
			deviceScaleFactor: 1,
			mobile: false,
		});
		await send("Runtime.enable");
		const result = await send("Runtime.evaluate", {
			expression: htmlAudioAnalysisExpression(
				options.code,
				options.frame,
				options.resources,
				options.analysis,
			),
			awaitPromise: true,
			returnByValue: true,
		});
		if (result.exceptionDetails)
			throw Error(
				"HyperFrames audio analysis failed: " +
					JSON.stringify(result.exceptionDetails).slice(0, 1200),
			);
		options.signal.throwIfAborted();
		return (result.result as { value?: unknown } | undefined)?.value;
	} finally {
		if (targetId && !options.signal.aborted)
			await browser.send("Target.closeTarget", { targetId });
	}
}
