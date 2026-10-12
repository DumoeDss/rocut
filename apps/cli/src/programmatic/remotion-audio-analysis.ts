import { createHash } from "node:crypto";
import * as wasm from "opencut-wasm";
import type { ProgrammaticFrameRequest, ResolvedProgrammaticResource } from "@opencut/editor-contracts";
import { launchFrameBrowser } from "./chromium-process";
import { resolveHtmlDocumentCode } from "./document-resource";
import { htmlAudioAnalysisExpression } from "./html-document";
import { loadProgrammaticResources, type ProgrammaticResourceStore } from "./resources";
import type {NativeAudioAnalysisConfig} from "./remotion-audio-bootstrap";
import {attachRemotionProducedCaptureBroker} from "./remotion-produced-capture-broker";
import {attachOffthreadBroker} from "./offthread-broker";
import type {NativeVideoDecoder} from "./video-decoder";
import { analyzeElectronAudio, pinElectronAudioConnection } from "./electron-audio-transport";
import { createElectronNativeVideoServer } from "./electron-native-video-server";
import { collectElectronRemotionProducedFrames } from "./electron-remotion-produced";

interface AudioPolicy {
	version: 1; maxSources: number; maxAssetsPerFrame: number; maxSourceBytes: number;maxObservationBytes:number;
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
	executable?: string; connectionFile?: string; request: ProgrammaticFrameRequest;
	resourceStore: ProgrammaticResourceStore; signal: AbortSignal;
	decoder?:NativeVideoDecoder;
}
type FrameTiming = Omit<ProgrammaticFrameRequest, "source">;
interface AudioAnalyzer {
	sources: NativeAudioSource[];
	frame(request: FrameTiming): Promise<{ frameIndex: number; assets: NativeAudioObservation[] }>;
	producedFrames(scan:NonNullable<NativeAudioAnalysisConfig["remotionProduced"]>):Promise<{frames:RemotionProducedFrame[];pictures:Map<number,Buffer>}>;
}
export interface RemotionProducedFrame {frameIndex:number;assets:NativeAudioObservation[];produced:unknown[]}

/** One private process per bounded job. Legacy frame() uses fresh targets;
 * producedFrames() preserves one root and native IDs through the canonical scan.
 * Electron basic frames use its named observation grant, never a process fallback.
 */
export async function withRemotionAudioAnalyzer<T>({ executable, connectionFile, request, resourceStore, signal,decoder }: AnalysisOptions,
	consume: (analyzer: AudioAnalyzer) => Promise<T>): Promise<T> {
	signal.throwIfAborted();
	if (connectionFile) pinElectronAudioConnection(connectionFile);
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
	const consumeScoped = async (analyzer: AudioAnalyzer) => {
		const pending = new Set<Promise<unknown>>();
		const track = <R>(collect: () => Promise<R>) => {
			const result = (async () => {
				lifetime.throwIfAborted();
				try {
					const value = await collect();
					lifetime.throwIfAborted();
					return value;
				} catch (error) {
					lifetime.throwIfAborted();
					throw error;
				}
			})();
			pending.add(result);
			const released = () => pending.delete(result);
			void result.then(released, released);
			return result;
		};
		try {
			return await consume({
				sources: analyzer.sources,
				frame: timing => track(() => analyzer.frame(timing)),
				producedFrames: scan => track(() => analyzer.producedFrames(scan)),
			});
		} finally {
			controller.abort(Error("Remotion audio analyzer closed"));
			await Promise.allSettled([...pending]);
		}
	};
	// Release every owner independently, without replacing an operation failure.
	const cleanup = async (failed: boolean, actions: (() => Promise<unknown>)[]) => {
		let firstError: unknown;
		let cleanupFailed = false;
		for (const action of actions) {
			try { await action(); }
			catch (error) { if (!cleanupFailed) firstError = error; cleanupFailed = true; }
		}
		if (!failed && cleanupFailed) throw firstError;
	};
	if (connectionFile) {
		// Admitted video bytes can be consumed by OffthreadVideo during audio
		// inspection. Pure Audio sources retain only their independent audio grant.
		const needsVideo = sources.some(item => item.mimeType.startsWith("video/"));
		if (needsVideo && !decoder) throw Error("Electron native audio video sources require the native decoder");
		if (needsVideo) pinElectronAudioConnection(connectionFile, true);
		let busy = false;
		return consumeScoped({ sources,
			async producedFrames(scan) {
				lifetime.throwIfAborted();
				if (busy) throw Error("Native audio frames must be collected serially");
				busy = true;
				try {
					return await collectElectronRemotionProducedFrames({ connectionFile, width: source.width, height: source.height,
						durationFrames: source.durationFrames, code, resources, sources, limits, scan, decoder, normalize, signal: lifetime });
				} finally { busy = false; }
			},
			async frame(timing) {
				lifetime.throwIfAborted();
				if (busy) throw Error("Native audio frames must be collected serially");
				busy = true;
				let nativeFrames: Awaited<ReturnType<typeof createElectronNativeVideoServer>> | undefined;
				let failed = false;
				try {
					const mapped = map(timing);
					if (needsVideo) nativeFrames = await createElectronNativeVideoServer({ decoder: decoder!, code, resources,
						limits: mapped.videoLimits, signal: lifetime });
					const value = await analyzeElectronAudio({ connectionFile, width: source.width, height: source.height, signal: lifetime,
						...(nativeFrames ? { nativeVideo: nativeFrames.callback } : {}),
						expression: htmlAudioAnalysisExpression(code, mapped, resources, {
							limits, engine: "remotion", sources: sources.map(({ id, src }) => ({ id, src })),
						}, !!nativeFrames) });
					await nativeFrames?.check();
					return { frameIndex: mapped.index, assets: normalize(mapped.index, value) };
				} catch (error) { failed = true; throw error; }
				finally { try { await cleanup(failed, [async () => nativeFrames?.dispose()]); } finally { busy = false; } }
			}
		});
	}
	if (!executable) throw Error("No native audio browser backend configured");
	const startTimer = setTimeout(() => controller.abort(), 15000);
	const browser = await launchFrameBrowser(executable, lifetime).catch(error => {
		lifetime.throwIfAborted();
		throw error;
	}).finally(() => clearTimeout(startTimer));
	let busy = false;
	let completed = false;
	try {
		const result = await consumeScoped({ sources, async producedFrames(scan) {
			lifetime.throwIfAborted();if(busy)throw Error("Native audio frames must be collected serially");busy=true;
			// Full-source scan may legitimately exceed a single-frame deadline.
			// Every native frame still owns its independent 8s driver watchdog.
			const timer=setTimeout(()=>controller.abort(),Math.min(24*60*60*1000,30000+scan.frames.length*8000));
			let targetId:unknown,capture:Awaited<ReturnType<typeof attachRemotionProducedCaptureBroker>>|undefined;
			let video:Awaited<ReturnType<typeof attachOffthreadBroker>>|undefined;
			let failed = false;
			try {
				const target=await browser.send("Target.createTarget",{url:"about:blank"});targetId=target.targetId;
				const attached=await browser.send("Target.attachToTarget",{targetId,flatten:true}),session=String(attached.sessionId);
				const send=(method:string,params={})=>browser.send(method,params,session);
				await send("Network.enable");await send("Network.setBlockedURLs",{urls:["http://*","https://*","file://*","ftp://*","ws://*","wss://*"]});
				await send("Page.enable");await send("Runtime.enable");
				await send("Emulation.setDeviceMetricsOverride",{width:source.width,height:source.height,deviceScaleFactor:1,mobile:false});
				capture=await attachRemotionProducedCaptureBroker({browser,session,durationFrames:source.durationFrames,limits,signal:lifetime});
				const videoLimits=scan.frames[0]?.videoLimits as {maxBytes:number;maxDimension:number;maxElements:number}|undefined;
				if(decoder && videoLimits)video=await attachOffthreadBroker({browser,session,decoder,code,resources,signal:lifetime,
					limits:{...videoLimits,maxElements:scan.frames.length*videoLimits.maxElements}});
				const result=await send("Runtime.evaluate",{expression:htmlAudioAnalysisExpression(code,scan.frames[0],resources,
					{limits,engine:"remotion",sources:sources.map(({id,src})=>({id,src})),remotionProduced:scan}),awaitPromise:true,returnByValue:true});
				if(result.exceptionDetails)throw Error("Native produced analysis failed: "+JSON.stringify(result.exceptionDetails).slice(0,1200));
				await capture.check();await video?.check();lifetime.throwIfAborted();
				const raw=(result.result as {value?:{version:number;profile:string;frames:{frameIndex:number;assets:unknown;produced:unknown[]}[]}})?.value;
				if(raw?.version!==1 || raw.profile!==scan.profile || raw.frames?.length!==scan.frames.length)throw Error("Incomplete native produced scan");
				return {frames:raw.frames.map((item,index)=>{
					if(item.frameIndex!==index || !Array.isArray(item.produced))throw Error("Native produced scan clock changed");
					return {frameIndex:index,assets:normalize(index,item.assets),produced:item.produced};
				}),pictures:capture.take()};
			} catch(error) {
				failed = true;
				// A failed continuous realm must not retain pending CDP operations
				// until the full-source deadline or be reused as a fresh frame.
				lifetime.throwIfAborted();controller.abort(error);throw error;
			} finally {
				try { await cleanup(failed, [async () => capture?.dispose(), async () => video?.dispose(),
					async () => { if(targetId && !lifetime.aborted)await browser.send("Target.closeTarget",{targetId}); }]); }
				finally {clearTimeout(timer);busy=false;}
			}
		}, async frame(timing) {
			lifetime.throwIfAborted();
			if (busy) throw Error("Native audio frames must be collected serially");
			const mapped = map(timing);
			busy = true;
			const timer = setTimeout(() => controller.abort(), 15000);
			let targetId: unknown;
			let failed = false;
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
			} catch (error) { failed = true; throw error; }
			finally {
				try { await cleanup(failed, [async () => { if (targetId && !lifetime.aborted) await browser.send("Target.closeTarget", { targetId }); }]); }
				finally { clearTimeout(timer); busy = false; }
			}
		} });
		completed = true;
		return result;
	} finally { await cleanup(!completed, [() => browser.close()]); }
}

export async function analyzeRemotionAudioFrame(options: AnalysisOptions) {
	return withRemotionAudioAnalyzer(options, async analyzer => ({
		...await analyzer.frame(options.request), sources: analyzer.sources,
	}));
}
