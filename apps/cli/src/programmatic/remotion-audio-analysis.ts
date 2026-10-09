import { createHash } from "node:crypto";
import * as wasm from "opencut-wasm";
import type { ProgrammaticFrameRequest, ResolvedProgrammaticResource } from "@opencut/editor-contracts";
import { launchFrameBrowser } from "./chromium-process";
import { resolveHtmlDocumentCode } from "./document-resource";
import { htmlAudioAnalysisExpression } from "./html-document";
import { loadProgrammaticResources, type ProgrammaticResourceStore } from "./resources";

interface AudioPolicy {
	version: 1; maxSources: number; maxAssetsPerFrame: number; maxSourceBytes: number;
	maxTotalBytes: number; maxSeconds: number; mimeTypes: string[];
}
export interface NativeAudioSource { id: string; src: string; mimeType: string; body: Buffer }
export interface NativeGainEnvelope {
	version: 1; start: number; duration: number; baseGain: number; fadeIn: number; fadeOut: number;
	points: { t: number; v: number; curve?: number; viaX?: number; viaY?: number }[];
}
export interface NativeAudioObservation {
	id: string; resourceId: string; type: "audio" | "video"; sourceTime: number;
	playbackRate: number; volume: number; toneFrequency: number; audioStreamIndex: number;
	gainEnvelope?: NativeGainEnvelope;
}

/** Byte admission only. No URL fetch, file resolution, codec, or timeline policy. */
export function admitNativeAudioSources(code: string, resources: readonly ResolvedProgrammaticResource[], limits: AudioPolicy): NativeAudioSource[] {
	const mimePattern = limits.mimeTypes.map(mime => mime.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
	const urls = new Set(code.match(new RegExp(`data:(?:${mimePattern});base64,[A-Za-z0-9+/]+={0,2}`, "g")) ?? []);
	for (const item of resources) if (item.resource.kind === "video")
		urls.add(`data:${item.resource.mimeType};base64,${Buffer.from(item.body).toString("base64")}`);
	if (urls.size > limits.maxSources) throw Error("Native audio source count exceeds the Rust limit");
	let total = 0;
	return [...urls].map(src => {
		const comma = src.indexOf(","), mimeType = src.slice(5, src.indexOf(";"));
		const encoded = src.slice(comma + 1);
		if (encoded.length > Math.ceil(limits.maxSourceBytes / 3) * 4) throw Error("Native audio source exceeds the Rust byte limit");
		const body = Buffer.from(encoded, "base64");
		if (!body.length || body.toString("base64") !== encoded) throw Error("Native audio source requires canonical base64");
		total += body.length;
		if (body.length > limits.maxSourceBytes || total > limits.maxTotalBytes) throw Error("Native audio bytes exceed the Rust limit");
		const id = createHash("sha256").update(mimeType).update("\0").update(body).digest("hex");
		return { id, src, mimeType, body };
	});
}

interface AnalysisOptions {
	executable: string; request: ProgrammaticFrameRequest;
	resourceStore: ProgrammaticResourceStore; signal: AbortSignal;
}
type FrameTiming = Omit<ProgrammaticFrameRequest, "source">;
interface AudioAnalyzer {
	sources: NativeAudioSource[];
	frame(request: FrameTiming): Promise<{ frameIndex: number; assets: NativeAudioObservation[] }>;
}

/** One private process per bounded job, a fresh isolated target per frame.
 * No authored state or native component identity leaks between frame documents.
 * Electron's PNG-only service is neither changed nor silently bypassed.
 */
export async function withRemotionAudioAnalyzer<T>({ executable, request, resourceStore, signal }: AnalysisOptions,
	consume: (analyzer: AudioAnalyzer) => Promise<T>): Promise<T> {
	signal.throwIfAborted();
	const source = JSON.parse(JSON.stringify(request.source)) as ProgrammaticFrameRequest["source"];
	if (source.runtime !== "html-document" || source.build?.engine !== "remotion")
		throw Error("Native audio analysis requires a compiled Remotion source");
	const map = (timing: FrameTiming) => {
		const mapped = JSON.parse(wasm.resolveProgrammaticFrameJson(JSON.stringify({ ...timing, source })));
		if (mapped.error || !mapped.frame) throw Error(mapped.error ?? "Expected an active Remotion frame");
		return mapped.frame;
	};
	map(request);
	const limits: AudioPolicy = JSON.parse(wasm.programmaticAudioPolicyJson());
	const resources = await loadProgrammaticResources(resourceStore, source.resources ?? [], signal);
	const code = resolveHtmlDocumentCode(source, resources);
	const sources = admitNativeAudioSources(code, resources, limits);
	const normalize = (frameIndex: number, assets: unknown): NativeAudioObservation[] => {
		const result = JSON.parse(wasm.resolveRemotionAudioFrameJson(JSON.stringify({
			version: 1, frameIndex,
			framesPerSecond: source.frameRate.numerator / source.frameRate.denominator,
			sources: sources.map(source => ({ id: source.id, mimeType: source.mimeType, byteLength: source.body.length })), assets,
		})));
		if (result.error) throw Error(result.error);
		return result.assets;
	};
	normalize(map(request).index, []);
	const controller = new AbortController();
	const lifetime = AbortSignal.any([signal, controller.signal]);
	const startTimer = setTimeout(() => controller.abort(), 15000);
	const browser = await launchFrameBrowser(executable, lifetime).finally(() => clearTimeout(startTimer));
	let busy = false;
	try {
		return await consume({ sources, async frame(timing) {
			lifetime.throwIfAborted();
			if (busy) throw Error("Native audio frames must be collected serially");
			const mapped = map(timing);
			busy = true;
			const timer = setTimeout(() => controller.abort(), 15000);
			let targetId: unknown;
			try {
				const target = await browser.send("Target.createTarget", { url: "about:blank" });
				targetId = target.targetId;
				const attached = await browser.send("Target.attachToTarget", { targetId, flatten: true });
				const send = (method: string, params = {}) => browser.send(method, params, String(attached.sessionId));
				await send("Network.enable");
				await send("Network.setBlockedURLs", { urls: ["http://*", "https://*", "file://*", "ftp://*", "ws://*", "wss://*"] });
				await send("Page.enable");
				await send("Emulation.setDeviceMetricsOverride", { width: source.width, height: source.height, deviceScaleFactor: 1, mobile: false });
				await send("Runtime.enable");
				const result = await send("Runtime.evaluate", { expression: htmlAudioAnalysisExpression(code, mapped, resources, {
					limits, sources: sources.map(({ id, src }) => ({ id, src })),
				}), awaitPromise: true, returnByValue: true });
				if (result.exceptionDetails) throw Error("Native audio analysis failed: " + JSON.stringify(result.exceptionDetails).slice(0, 1200));
				lifetime.throwIfAborted();
				return { frameIndex: mapped.index, assets: normalize(mapped.index, (result.result as { value?: unknown } | undefined)?.value) };
			} finally {
				try { if (targetId && !lifetime.aborted) await browser.send("Target.closeTarget", { targetId }); }
				finally { clearTimeout(timer); busy = false; }
			}
		} });
	} finally { await browser.close(); }
}

export async function analyzeRemotionAudioFrame(options: AnalysisOptions) {
	return withRemotionAudioAnalyzer(options, async analyzer => ({
		...await analyzer.frame(options.request), sources: analyzer.sources,
	}));
}
