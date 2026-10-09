import type { ProgrammaticSource } from "@opencut/editor-contracts";
import * as wasm from "opencut-wasm";
import { withHyperframesAudioGraphAnalyzer } from "./hyperframes-audio-analysis";
import { withHyperframesFxExecutor } from "./hyperframes-fx-executor";
import { loadHyperframesFxRuntime } from "./hyperframes-fx-runtime";
import type { HyperframesFxRuntime } from "./hyperframes-fx-runtime";
import type { HyperframesFxProvenance } from "./hyperframes-fx-types";
import { renderHyperframesGraphStages } from "./hyperframes-graph-render";
import type { ProgrammaticResourceStore } from "./resources";
import type { NativeVideoDecoder } from "./video-decoder";

interface GraphAudioOptions {
	source: ProgrammaticSource;
	firstFrame: number;
	frameCount: number;
	sampleRate: 44100 | 48000;
	executable: string;
	toolchainDirectory: string;
	decoder: NativeVideoDecoder;
	resourceStore: ProgrammaticResourceStore;
	signal: AbortSignal;
	/** Host-prepared trusted identity; never taken from authored project input. */
	runtime?: HyperframesFxRuntime;
	expectedProvenance?: HyperframesFxProvenance;
}

/** Opt-in Host graph path. Discovery validates observed declaration stability,
 * not arbitrary authored script behavior between observations. Native FX lanes
 * use Rust-admitted local-track/global-bus clocks; participating fallback history,
 * fractional phase and variable rate remain errors. Graph cache identity binds
 * the current trusted DSP, browser, decoder and Host epoch.
 */
export async function renderHyperframesGraphAudioRange(
	options: GraphAudioOptions,
) {
	const {
		source,
		firstFrame,
		frameCount,
		sampleRate,
		executable,
		resourceStore,
		signal,
	} = options;
	signal.throwIfAborted();
	if (
		source.runtime !== "html-document" ||
		source.build?.engine !== "hyperframes"
	)
		throw Error("Graph audio requires a compiled native HyperFrames source");
	const range = JSON.parse(
		wasm.resolveProgrammaticAudioRangeJson(
			JSON.stringify({
				version: 1,
				frameRate: source.frameRate,
				durationFrames: source.durationFrames,
				firstFrame,
				frameCount,
				sampleRate,
			}),
		),
	) as {
		error?: string;
		plan?: {
			ticksPerFrame: number;
			outputFrames: number;
			sampleOrigin: number;
		};
	};
	if (range.error || !range.plan)
		throw Error(range.error ?? "Missing graph audio range");
	const clock = range.plan;
	const timing = {
		source,
		clipStart: 0,
		clipDuration: source.durationFrames * clock.ticksPerFrame,
		trimStart: 0,
		timelineTime: 0,
	};
	const evidence = await withHyperframesAudioGraphAnalyzer(
		{ executable, resourceStore, signal, request: timing },
		async (analyzer) => {
			const baseline = await analyzer.frame(timing);
			if (baseline.frameIndex !== 0)
				throw Error("Graph audio baseline must start at canonical zero");
			const graph = {
				version: 1,
				semanticsProfile: "rocut-hyperframes-0.8.139-audio-graph-v1",
				frameRate: source.frameRate,
				durationFrames: source.durationFrames,
				firstFrame,
				frameCount,
				sampleRate,
				sources: analyzer.sources.map(({ id, mimeType, body }) => ({
					id,
					mimeType,
					byteLength: body.length,
				})),
				snapshot: baseline.snapshot,
			};
			const discovery = JSON.parse(
				wasm.resolveHyperframesAudioDiscoveryJson(JSON.stringify(graph)),
			) as {
				error?: string;
				plan?: { seeks: { time: number; instanceIds: string[] }[] };
			};
			if (discovery.error || !discovery.plan)
				throw Error(discovery.error ?? "Missing graph gain discovery");
			const observations: unknown[] = [];
			const policy = JSON.parse(wasm.programmaticAudioPolicyJson()) as {
				maxObservationBytes: number;
			};
			let bytes = Buffer.byteLength(
				JSON.stringify({ version: 1, graph, observations }),
			);
			for (const seek of discovery.plan.seeks) {
				signal.throwIfAborted();
				const { snapshot } = await analyzer.seek(graph, seek);
				bytes += Buffer.byteLength(JSON.stringify(snapshot)) + 1;
				if (bytes > policy.maxObservationBytes)
					throw Error("Graph observations exceed the Rust collection budget");
				observations.push(snapshot);
			}
			const collected = JSON.parse(
				wasm.resolveHyperframesAudioObservationsJson(
					JSON.stringify({
						version: 1,
						graph,
						observations,
					}),
				),
			) as { error?: string; faderObservations?: unknown[] };
			if (collected.error || !collected.faderObservations)
				throw Error(
					collected.error ?? "Missing stable graph gain observations",
				);
			return {
				request: {
					version: 1,
					graph,
					faderObservations: collected.faderObservations,
				},
				sources: analyzer.sources,
			};
		},
	);
	// Collection closes its private browser before DSP gets a separate trusted page.
	signal.throwIfAborted();
	const runtime =
		options.runtime ??
		(await loadHyperframesFxRuntime({
			toolchainDirectory: options.toolchainDirectory,
			signal,
		}));
	const rendered = await withHyperframesFxExecutor(
		{
			executable,
			runtime,
			signal,
			expectedProvenance: options.expectedProvenance,
		},
		(executor) =>
			renderHyperframesGraphStages({
				...evidence,
				kernels: wasm,
				executor,
				decoder: options.decoder,
				signal,
			}),
	);
	if (
		rendered.frames !== clock.outputFrames ||
		rendered.sampleOrigin !== clock.sampleOrigin
	)
		throw Error("Graph PCM clock disagrees with admitted source range");
	return { ...rendered, firstFrame, frameCount };
}
