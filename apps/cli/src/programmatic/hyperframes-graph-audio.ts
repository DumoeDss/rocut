import type { ProgrammaticSource } from "@opencut/editor-contracts";
import * as wasm from "opencut-wasm";
import { withHyperframesAudioGraphAnalyzer } from "./hyperframes-audio-analysis";
import { withHyperframesFxExecutor } from "./hyperframes-fx-executor";
import { loadHyperframesFxRuntime } from "./hyperframes-fx-runtime";
import type { HyperframesFxRuntime } from "./hyperframes-fx-runtime";
import type { HyperframesFxProvenance } from "./hyperframes-fx-types";
import { renderHyperframesGraphStages } from "./hyperframes-graph-render";
import { createHyperframesLoopSourceOwner } from "./hyperframes-loop-source-owner";
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
 * use Rust-admitted local-track/global-bus clocks. Variable-rate clips use full
 * native PCM16/48k preparation before graph resampling. Loops preserve native
 * author/preview intent via bounded source-domain materialization, not the
 * exporter's loop omission. Fractional loop clocks execute the fixed native
 * source scheduler; participating fallback history is separately admitted.
 * Cache identity binds trusted DSP, browser, decoder and Host epoch.
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
				...(source.audio?.timing === undefined
					? {}
					: { timing: source.audio.timing }),
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
			const { observations, fallbackHistories } = await analyzer.history(graph, discovery.plan.seeks);
			const policy = JSON.parse(wasm.programmaticAudioPolicyJson()) as {
				maxObservationBytes: number;
			};
			const bytes = Buffer.byteLength(
				JSON.stringify({ version: 1, graph, observations, fallbackHistories }),
			);
			if (bytes > policy.maxObservationBytes)
				throw Error("Graph observations and native histories exceed the Rust collection budget");
			const collected = JSON.parse(
				wasm.resolveHyperframesAudioObservationsJson(
					JSON.stringify({
						version: 1,
						graph,
						observations,
						fallbackHistories,
					}),
				),
			) as { error?: string; faderObservations?: unknown[]; fallbackHistories?: unknown[] };
			if (collected.error || !collected.faderObservations || !collected.fallbackHistories)
				throw Error(
					collected.error ?? "Missing stable graph gain observations",
				);
			return {
				request: {
					version: 1,
					graph,
					faderObservations: collected.faderObservations,
					fallbackHistories: collected.fallbackHistories,
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
		async (executor) => {
			const loopSourceOwner = createHyperframesLoopSourceOwner({
				executable,
				signal,
				expectedBrowser: executor.provenance.browser,
			});
			try {
				return await renderHyperframesGraphStages({
					...evidence,
					kernels: wasm,
					executor,
					decoder: options.decoder,
					signal,
					loopSourceOwner,
				});
			} finally {
				await loopSourceOwner.dispose();
			}
		},
	);
	if (
		rendered.frames !== clock.outputFrames ||
		rendered.sampleOrigin !== clock.sampleOrigin
	)
		throw Error("Graph PCM clock disagrees with admitted source range");
	return { ...rendered, firstFrame, frameCount };
}
