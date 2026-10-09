import { createHash } from "node:crypto";
import { decodeNativeAudioSegment } from "./audio-decoder";
import { prepareHyperframesRateAudio } from "./hyperframes-rate-prepare";
import type { HyperframesFxExecutor } from "./hyperframes-fx-types";
import {
	hyperframesGraphEnvelope,
	hyperframesGraphMixEnvelope,
	type HyperframesGraphKernels,
	type HyperframesGraphPcmBuffer,
	type HyperframesGraphStagePlan,
} from "./hyperframes-graph-kernels";
import type { NativeAudioSource } from "./remotion-audio-analysis";
import type { NativeVideoDecoder } from "./video-decoder";

/** Internal execution seam, not a Host capability or an alternate exporter.
 * Rust supplies all geometry/order/fader/placement/crop decisions. IO runs the
 * complete canonical history even when only a small output crop was requested.
 */
export async function renderHyperframesGraphStages({
	request,
	sources,
	kernels,
	executor,
	decoder,
	signal,
}: {
	request: unknown;
	sources: readonly NativeAudioSource[];
	kernels: HyperframesGraphKernels;
	executor: HyperframesFxExecutor;
	decoder: NativeVideoDecoder;
	signal: AbortSignal;
}) {
	signal.throwIfAborted();
	// Stabilize graph evidence across awaits and repeated Rust kernel admission.
	const evidenceJson = JSON.stringify(request);
	const evidence: unknown = JSON.parse(evidenceJson);
	const response = JSON.parse(
		kernels.resolveHyperframesAudioExecutionPlanJson(evidenceJson),
	) as {
		plan?: HyperframesGraphStagePlan;
		error?: string;
	};
	if (response.error || !response.plan)
		throw Error(response.error ?? "Missing HyperFrames graph stage plan");
	const plan = response.plan;
	const supplied = new Map(sources.map((source) => [source.id, source]));
	if (supplied.size !== sources.length || supplied.size !== plan.sources.length)
		throw Error("HyperFrames source set disagrees with Rust admission");
	// Validate all encoded geometry before allocating stable snapshots or starting
	// decoder/browser IO. Caller-owned bytes cannot mutate the admitted source
	// identity across awaits. Rust budgets both retained encoded representations.
	for (const admitted of plan.sources) {
		const actual = supplied.get(admitted.id);
		if (
			!actual ||
			actual.mimeType !== admitted.mimeType ||
			actual.body.byteLength !== admitted.byteLength
		)
			throw Error("HyperFrames source geometry disagrees with Rust admission");
	}
	const sourceMap = new Map(
		plan.sources.map((admitted) => {
			const body = Buffer.from(supplied.get(admitted.id)!.body);
			const hash = createHash("sha256")
				.update(admitted.mimeType)
				.update("\0")
				.update(body)
				.digest("hex");
			if (hash !== admitted.id)
				throw Error("HyperFrames source bytes changed after admission");
			return [admitted.id, { ...admitted, body }] as const;
		}),
	);
	const decoded = new Map<string, { pcm: Buffer; hasAudio: boolean }>();
	for (const input of plan.decodedSources) {
		signal.throwIfAborted();
		if (!input.required) continue;
		const source = sourceMap.get(input.resourceId);
		if (!source)
			throw Error("HyperFrames graph references an unadmitted source");
		const result = input.ratePreparation
			? await prepareHyperframesRateAudio({
					decoder,
					body: source.body,
					mimeType: source.mimeType,
					sampleRate: input.sampleRate,
					frames: input.frames,
					recipe: input.ratePreparation,
					signal,
				})
			: await decodeNativeAudioSegment({
					decoder,
					body: source.body,
					request: {
						mimeType: source.mimeType,
						audioStreamIndex: 0,
						sampleRate: input.sampleRate,
						sourceSample: input.sourceSample,
						frames: input.frames,
						playbackRate: input.playbackRate,
						toneFrequency: 1,
					},
					signal,
				});
		// A real video without an audio stream contributes silence, not a fabricated
		// soundtrack. Its admitted geometry still governs the graph's dry buffer.
		const pcm = result.hasAudio ? result.pcm : Buffer.alloc(input.pcmBytes);
		if (pcm.length !== input.pcmBytes)
			throw Error("HyperFrames decoded PCM disagrees with Rust geometry");
		decoded.set(input.id, { pcm, hasAudio: result.hasAudio });
	}
	const tracks = new Map<string, HyperframesGraphPcmBuffer>();
	for (const track of plan.tracks) {
		signal.throwIfAborted();
		if (!track.requiresPcm) continue;
		const source = decoded.get(track.decodedSourceId);
		if (!source) throw Error("Missing HyperFrames decoded buffer");
		const dry = kernels.prepareHyperframesAudioDryTrackPcm(
			hyperframesGraphEnvelope(
				{
					version: 1,
					request: evidence,
					instanceId: track.instanceId,
					bufferId: track.decodedSourceId,
				},
				[source.pcm],
			),
		);
		signal.throwIfAborted();
		const effected = await executor.run(track.fxStage, dry);
		// Do not apply track gain here: bus/master kernels own the single post-FX
		// fader application, before any group sum or nonlinear bus effect.
		tracks.set(track.instanceId, {
			kind: "track-post-fx",
			instanceId: track.instanceId,
			pcm: effected.pcm,
		});
	}
	const master: HyperframesGraphPcmBuffer[] = [];
	for (const bus of plan.buses) {
		signal.throwIfAborted();
		if (!bus.requiresPcm) continue;
		const members = bus.memberInstanceIds.flatMap((id) => {
			const track = tracks.get(id);
			return track ? [track] : [];
		});
		const input = kernels.mixHyperframesAudioBusPcm(
			hyperframesGraphMixEnvelope(
				evidence,
				{ busInstanceId: bus.instanceId },
				members,
			),
		);
		signal.throwIfAborted();
		const effected = await executor.run(bus.fxStage, input);
		master.push({
			kind: "bus-post-fx",
			instanceId: bus.instanceId,
			pcm: effected.pcm,
		});
		for (const id of bus.memberInstanceIds) tracks.delete(id);
	}
	for (const track of plan.tracks) {
		if (track.resolvedBusInstanceId !== null || !track.requiresPcm) continue;
		const output = tracks.get(track.instanceId);
		if (!output) throw Error("Missing HyperFrames ungrouped track buffer");
		master.push(output);
	}
	signal.throwIfAborted();
	const pcm = Buffer.from(
		kernels.mixHyperframesAudioMasterPcm(
			hyperframesGraphMixEnvelope(evidence, { output: "crop" }, master),
		),
	);
	signal.throwIfAborted();
	return {
		pcm,
		sampleRate: plan.sampleRate,
		channels: plan.channels,
		frames: plan.outputFrames,
		sampleOrigin: plan.cropStartSample,
		hasAudio: plan.tracks.some(
			(track) =>
				track.requiresPcm && decoded.get(track.decodedSourceId)?.hasAudio,
		),
		provenance: executor.provenance,
	};
}
