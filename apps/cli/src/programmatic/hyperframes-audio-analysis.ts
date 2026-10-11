import * as wasm from "opencut-wasm";
import type { ProgrammaticFrameRequest } from "@opencut/editor-contracts";
import { launchFrameBrowser } from "./chromium-process";
import { resolveHtmlDocumentCode } from "./document-resource";
import { collectHyperframesAudioSnapshot } from "./hyperframes-audio-analysis-frame";
import { htmlAudioAnalysisExpression } from "./html-document";
import { analyzeElectronAudio, pinElectronAudioConnection } from "./electron-audio-transport";
import { openElectronAudioSession, pinElectronAudioSessionConnection } from "./electron-audio-session";
import type { HyperframesFxProvenance } from "./hyperframes-fx-types";
import type {
	HyperframesNativeHistoryCapture,
	HyperframesNativeHistoryResult,
	HyperframesNativeHistoryScan,
} from "./hyperframes-native-history-capture";
import {
	admitNativeAudioSources,
	type NativeAudioObservation,
	type NativeAudioSource,
} from "./remotion-audio-analysis";
import {
	loadProgrammaticResources,
	type ProgrammaticResourceStore,
} from "./resources";

interface AnalysisOptions {
	executable?: string;
	connectionFile?: string;
	expectedProvenance?: HyperframesFxProvenance;
	request: ProgrammaticFrameRequest;
	resourceStore: ProgrammaticResourceStore;
	signal: AbortSignal;
}
type FrameTiming = Omit<ProgrammaticFrameRequest, "source">;
interface NativeSeek {
	time: number;
	instanceIds: string[];
}
interface AudioAnalyzer {
	sources: NativeAudioSource[];
	frame(
		request: FrameTiming,
	): Promise<{ frameIndex: number; assets: NativeAudioObservation[] }>;
}
interface AudioGraphAnalyzer {
	sources: NativeAudioSource[];
	/** One fresh authored realm for the complete Rust canonical write scan. */
	history(graph: unknown, seeks: NativeSeek[]): Promise<HyperframesNativeHistoryResult>;
	/** Browser output is untrusted; the caller must admit it in Rust before PCM work. */
	frame(
		request: FrameTiming,
	): Promise<{ frameIndex: number; snapshot: unknown }>;
	/** Internal discovery only: Rust validates native seconds and instance identity. */
	seek(
		graph: unknown,
		seek: NativeSeek,
	): Promise<{ time: number; snapshot: unknown }>;
}
interface RawAudioAnalyzer {
	sources: NativeAudioSource[];
	history(graph: unknown, seeks: NativeSeek[]): Promise<HyperframesNativeHistoryResult>;
	normalize(frameIndex: number, assets: unknown): NativeAudioObservation[];
	frame(request: FrameTiming): Promise<{ frameIndex: number; value: unknown }>;
	seek(
		graph: unknown,
		seek: NativeSeek,
	): Promise<{ time: number; value: unknown }>;
}

export async function withHyperframesAudioAnalyzer<T>(
	options: AnalysisOptions,
	consume: (analyzer: AudioAnalyzer) => Promise<T>,
): Promise<T> {
	return withHyperframesAudioCollection(options, false, (analyzer) =>
		consume({
			sources: analyzer.sources,
			async frame(timing) {
				const result = await analyzer.frame(timing);
				return {
					frameIndex: result.frameIndex,
					assets: analyzer.normalize(result.frameIndex, result.value),
				};
			},
		}),
	);
}

/** Internal facts-only mode. Does not enable graph rendering or claim admission. */
export async function withHyperframesAudioGraphAnalyzer<T>(
	options: AnalysisOptions,
	consume: (analyzer: AudioGraphAnalyzer) => Promise<T>,
): Promise<T> {
	return withHyperframesAudioCollection(options, true, (analyzer) =>
		consume({
			sources: analyzer.sources,
			history: (graph, seeks) => analyzer.history(graph, seeks),
			async frame(timing) {
				const result = await analyzer.frame(timing);
				return { frameIndex: result.frameIndex, snapshot: result.value };
			},
			async seek(graph, seek) {
				const result = await analyzer.seek(graph, seek);
				return { time: result.time, snapshot: result.value };
			},
		}),
	);
}

/** A private Chromium process per bounded range, with fresh documents per frame.
 * The pinned runtime observer supplies facts; Rust admits them before PCM work.
 */
async function withHyperframesAudioCollection<T>(
	{ executable, connectionFile, request, resourceStore, signal, expectedProvenance }: AnalysisOptions,
	hyperframesGraph: boolean,
	consume: (analyzer: RawAudioAnalyzer) => Promise<T>,
): Promise<T> {
	signal.throwIfAborted();
	if (connectionFile && !hyperframesGraph) {
		pinElectronAudioConnection(connectionFile);
	}
	if (connectionFile && hyperframesGraph) pinElectronAudioSessionConnection(connectionFile);
	const source = JSON.parse(
		JSON.stringify(request.source),
	) as ProgrammaticFrameRequest["source"];
	if (
		source.runtime !== "html-document" ||
		source.build?.engine !== "hyperframes"
	)
		throw Error("Native audio analysis requires a compiled HyperFrames source");
	const map = (timing: FrameTiming) => {
		const mapped = JSON.parse(
			wasm.resolveProgrammaticFrameJson(JSON.stringify({ ...timing, source })),
		);
		if (mapped.error || !mapped.frame)
			throw Error(mapped.error ?? "Expected an active HyperFrames frame");
		return mapped.frame;
	};
	map(request);
	const limits = JSON.parse(wasm.programmaticAudioPolicyJson());
	const resources = await loadProgrammaticResources(
		resourceStore,
		source.resources ?? [],
		signal,
	);
	const code = resolveHtmlDocumentCode(source, resources);
	const sources = admitNativeAudioSources(code, resources, limits);
	const admittedSources = sources.map((item) => ({
		id: item.id,
		mimeType: item.mimeType,
		byteLength: item.body.length,
	}));
	const browserSources = sources.map(({ id, src }) => ({ id, src }));
	const mapSeek = (graph: unknown, seek: NativeSeek) => {
		if (!hyperframesGraph)
			throw Error("Native discovery seeks require graph collection");
		const mapped = JSON.parse(
			wasm.resolveHyperframesAudioSeekJson(
				JSON.stringify({
					source,
					graph: { ...(graph as object), sources: admittedSources },
					seek,
				}),
			),
		);
		if (mapped.error || !mapped.frame)
			throw Error(
				mapped.error ?? "Expected a validated native HyperFrames seek",
			);
		return mapped.frame;
	};
	const normalize = (
		frameIndex: number,
		assets: unknown,
	): NativeAudioObservation[] => {
		const result = JSON.parse(
			wasm.resolveHyperframesAudioFrameJson(
				JSON.stringify({
					version: 1,
					frameIndex,
					framesPerSecond:
						source.frameRate.numerator / source.frameRate.denominator,
					sources: admittedSources,
					assets,
				}),
			),
		);
		if (result.error) throw Error(result.error);
		return result.assets;
	};
	// Source-only Rust admission must precede browser startup in both modes.
	normalize(map(request).index, []);
	if (connectionFile && !hyperframesGraph) {
		let busy = false;
		return consume({ sources, normalize,
			async history() { throw Error("Electron HyperFrames graph history is unavailable"); },
			async seek() { throw Error("Electron HyperFrames graph seeks are unavailable"); },
			async frame(timing) {
				signal.throwIfAborted();
				if (busy) throw Error("HyperFrames audio frames must be collected serially");
				busy = true;
				try {
					const mapped = map(timing);
					const value = await analyzeElectronAudio({ connectionFile, width: source.width, height: source.height, signal,
						expression: htmlAudioAnalysisExpression(code, mapped, resources, {
							engine: "hyperframes", limits, sources: browserSources,
						}) });
					return { frameIndex: mapped.index, value };
				} finally { busy = false; }
			}
		});
	}
	if (!connectionFile && !executable) throw Error("No native audio browser backend configured");
	const controller = new AbortController();
	const lifetime = AbortSignal.any([signal, controller.signal]);
	const startTimer = setTimeout(() => controller.abort(), 15000);
	const browser = connectionFile ? undefined : await launchFrameBrowser(executable!, lifetime).finally(() =>
		clearTimeout(startTimer),
	);
	if (connectionFile) clearTimeout(startTimer);
	let busy = false;
	const collect = async (
		resolveFrame: () => ReturnType<typeof map>,
		hyperframesNativeHistory?: HyperframesNativeHistoryCapture,
	) => {
		lifetime.throwIfAborted();
		if (busy)
			throw Error("HyperFrames audio frames must be collected serially");
		const mapped = resolveFrame();
		busy = true;
		const timeoutMs = hyperframesNativeHistory ? (connectionFile ? Math.min(1800000, 30000 + hyperframesNativeHistory.scan.frames.length * 8000) : 60000) : 15000;
		const timer = setTimeout(() => controller.abort(), timeoutMs);
		try {
			const analysis = { engine: "hyperframes" as const, hyperframesGraph,
				...(hyperframesNativeHistory ? { hyperframesNativeHistory } : {}), limits, sources: browserSources };
			let value: unknown;
			if (connectionFile) {
				const session = await openElectronAudioSession({ connectionFile, profile: "source", width: source.width, height: source.height, signal: lifetime });
				try {
					if (expectedProvenance && (session.epoch !== expectedProvenance.electronHostEpoch || JSON.stringify(session.browser) !== JSON.stringify(expectedProvenance.browser)))
						throw Error("HyperFrames source observation Host identity changed");
					value = await session.evaluate(htmlAudioAnalysisExpression(code, mapped, resources, analysis), { timeoutMs });
				}
				finally { await session.close(); }
			} else value = await collectHyperframesAudioSnapshot(browser!, {
				width: source.width,
				height: source.height,
				code,
				frame: mapped,
				resources,
				signal: lifetime,
				analysis: {
					engine: "hyperframes",
					hyperframesGraph,
					...(hyperframesNativeHistory ? { hyperframesNativeHistory } : {}),
					limits,
					sources: browserSources,
				},
			});
			return {
				frameIndex: mapped.index,
				time: mapped.time,
				value,
			};
		} finally {
			clearTimeout(timer);
			busy = false;
		}
	};
	try {
		return await consume({
			sources,
			normalize,
			async history(graph, seeks) {
				if (!hyperframesGraph) throw Error("Native history requires graph collection");
				const mapped = JSON.parse(wasm.resolveHyperframesAudioSeekJson(JSON.stringify({
					source,
					graph: { ...(graph as object), sources: admittedSources },
					nativeHistoryScan: true,
				}))) as { error?: string; nativeHistoryScan?: HyperframesNativeHistoryScan };
				if (mapped.error || !mapped.nativeHistoryScan?.frames.length)
					throw Error(mapped.error ?? "Missing Rust native history frame mapping");
				const scan = mapped.nativeHistoryScan;
				const result = await collect(() => scan.frames[0], {
					scan,
					observationTimes: seeks.map(seek => seek.time),
				});
				const value = result.value as HyperframesNativeHistoryResult | undefined;
				if (!Array.isArray(value?.observations) || !Array.isArray(value?.fallbackHistories))
					throw Error("Native history collector returned an incomplete envelope");
				return value;
			},
			frame: (timing) => collect(() => map(timing)),
			seek: (graph, seek) => collect(() => mapSeek(graph, seek)),
		});
	} finally {
		await browser?.close();
	}
}

export async function analyzeHyperframesAudioFrame(options: AnalysisOptions) {
	return withHyperframesAudioAnalyzer(options, async (analyzer) => ({
		...(await analyzer.frame(options.request)),
		sources: analyzer.sources,
	}));
}
