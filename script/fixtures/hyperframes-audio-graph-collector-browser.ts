import { writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { launchFrameBrowser } from "../../apps/cli/src/programmatic/chromium-process";
import type { HyperframesAudioGraphSnapshot } from "../../apps/cli/src/programmatic/hyperframes-audio-graph-types";
import {
	assertCollectorReadiness,
	assertCollectorSnapshot,
	type CollectorReadiness,
} from "./hyperframes-audio-graph-collector-assert";
import {
	COLLECTOR_READY,
	collectorSeek,
} from "./hyperframes-audio-graph-collector-page";
import { probeCollectorGains } from "./hyperframes-audio-graph-collector-gain-assert";

export async function probeCollectorBrowser(
	html: string,
	staging: string,
	resourceId: string,
	signal: AbortSignal,
	gains = false,
	routedPreview = false,
) {
	const require = createRequire(
		new URL("../../apps/vite-example/package.json", import.meta.url),
	);
	const { chromium } = await import(
		pathToFileURL(require.resolve("@playwright/test")).href
	);
	const browser = await launchFrameBrowser(chromium.executablePath(), signal);
	const errors: string[] = [];
	const observations: HyperframesAudioGraphSnapshot[] = [];
	try {
		const target = await browser.send("Target.createTarget", {
			url: "about:blank",
		});
		const attachment = await browser.send("Target.attachToTarget", {
			targetId: target.targetId,
			flatten: true,
		});
		const sessionId = String(attachment.sessionId);
		browser.onEvent((event) => {
			if (
				event.sessionId === sessionId &&
				event.method === "Runtime.exceptionThrown"
			) {
				const details = event.params.exceptionDetails as {
					text?: string;
					exception?: { description?: string };
				};
				errors.push(
					(
						details.exception?.description ??
						details.text ??
						"Runtime exception"
					).slice(0, 2000),
				);
			}
		});
		await browser.send("Page.enable", {}, sessionId);
		await browser.send("Runtime.enable", {}, sessionId);
		await browser.send("Network.enable", {}, sessionId);
		await browser.send(
			"Network.setBlockedURLs",
			{ urls: ["http://*", "https://*", "ws://*", "wss://*", "file://*"] },
			sessionId,
		);
		const tree = await browser.send("Page.getFrameTree", {}, sessionId);
		const { frame } = tree.frameTree as { frame: { id: string } };
		await browser.send(
			"Page.setDocumentContent",
			{ frameId: frame.id, html },
			sessionId,
		);
		const evaluate = async <T>(expression: string): Promise<T> => {
			const reply = await browser.send(
				"Runtime.evaluate",
				{
					expression,
					awaitPromise: true,
					returnByValue: true,
					userGesture: true,
				},
				sessionId,
			);
			if (reply.exceptionDetails) {
				const failure = reply.exceptionDetails as {
					text?: string;
					exception?: { description?: string };
				};
				throw Error(
					(
						failure.exception?.description ??
						failure.text ??
						"Collector evaluation failed"
					).slice(0, 2000),
				);
			}
			return (reply.result as { value: T }).value;
		};
		const readiness = await evaluate<CollectorReadiness>(COLLECTOR_READY);
		await writeFile(
			join(staging, "readiness.json"),
			JSON.stringify(readiness, null, 2),
			{ encoding: "utf8", flag: "wx" },
		);
		if (gains) {
			const result = await probeCollectorGains(
				evaluate,
				staging,
				readiness,
				routedPreview
					? async () => {
							await browser.send(
								"Input.dispatchMouseEvent",
								{
									type: "mousePressed",
									x: 16,
									y: 16,
									button: "left",
									clickCount: 1,
								},
								sessionId,
							);
							await browser.send(
								"Input.dispatchMouseEvent",
								{
									type: "mouseReleased",
									x: 16,
									y: 16,
									button: "left",
									clickCount: 1,
								},
								sessionId,
							);
						}
					: undefined,
			);
			if (errors.length)
				throw Error(
					`Unexpected native gain runtime exceptions: ${errors.join("\n")}`,
				);
			return result;
		}
		assertCollectorReadiness(readiness);
		const times = [0.36, 0, 0.12, 0.6, 0.12];
		for (const [index, time] of times.entries()) {
			const snapshot = await evaluate<HyperframesAudioGraphSnapshot>(
				collectorSeek(time),
			);
			observations.push(snapshot);
			await writeFile(
				join(staging, `snapshot-${index}.json`),
				JSON.stringify(snapshot, null, 2),
				{ encoding: "utf8", flag: "wx" },
			);
			assertCollectorSnapshot(snapshot, readiness, time, resourceId);
		}
		if (errors.length)
			throw Error(`Unexpected native runtime exceptions: ${errors.join("\n")}`);
		return {
			seeks: times,
			tracksPerSeek: 9,
			busesPerSeek: 2,
			observations: observations.length,
		};
	} finally {
		try {
			await writeFile(
				join(staging, "runtime-errors.json"),
				JSON.stringify(errors, null, 2),
				{ encoding: "utf8", flag: "wx" },
			);
		} finally {
			await browser.close();
		}
	}
}
