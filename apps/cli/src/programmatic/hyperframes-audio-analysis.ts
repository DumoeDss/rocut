import * as wasm from "opencut-wasm";
import type { ProgrammaticFrameRequest } from "@opencut/editor-contracts";
import { launchFrameBrowser } from "./chromium-process";
import { resolveHtmlDocumentCode } from "./document-resource";
import { collectHyperframesAudioSnapshot } from "./hyperframes-audio-analysis-frame";
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
	executable: string;
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
	{ executable, request, resourceStore, signal }: AnalysisOptions,
	hyperframesGraph: boolean,
	consume: (analyzer: RawAudioAnalyzer) => Promise<T>,
): Promise<T> {
	signal.throwIfAborted();
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
	const controller = new AbortController();
	const lifetime = AbortSignal.any([signal, controller.signal]);
	const startTimer = setTimeout(() => controller.abort(), 15000);
	const browser = await launchFrameBrowser(executable, lifetime).finally(() =>
		clearTimeout(startTimer),
	);
	let busy = false;
	const collect = async (resolveFrame: () => ReturnType<typeof map>) => {
		lifetime.throwIfAborted();
		if (busy)
			throw Error("HyperFrames audio frames must be collected serially");
		const mapped = resolveFrame();
		busy = true;
		const timer = setTimeout(() => controller.abort(), 15000);
		try {
			const value = await collectHyperframesAudioSnapshot(browser, {
				width: source.width,
				height: source.height,
				code,
				frame: mapped,
				resources,
				signal: lifetime,
				analysis: {
					engine: "hyperframes",
					hyperframesGraph,
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
			frame: (timing) => collect(() => map(timing)),
			seek: (graph, seek) => collect(() => mapSeek(graph, seek)),
		});
	} finally {
		await browser.close();
	}
}

export async function analyzeHyperframesAudioFrame(options: AnalysisOptions) {
	return withHyperframesAudioAnalyzer(options, async (analyzer) => ({
		...(await analyzer.frame(options.request)),
		sources: analyzer.sources,
	}));
}
