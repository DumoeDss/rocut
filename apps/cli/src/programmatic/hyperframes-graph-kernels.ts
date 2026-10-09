import type { HyperframesFxStage } from "./hyperframes-fx-types";
import type { HyperframesRatePreparation } from "./hyperframes-rate-prepare";

/** Structural ABI for the Rust graph kernels. Injection is internal only and
 * permits isolated WASM verification without replacing shared dependency copies. */
export interface HyperframesGraphKernels {
	resolveHyperframesAudioExecutionPlanJson(input: string): string;
	prepareHyperframesAudioDryTrackPcm(input: Uint8Array): Uint8Array;
	mixHyperframesAudioBusPcm(input: Uint8Array): Uint8Array;
	mixHyperframesAudioMasterPcm(input: Uint8Array): Uint8Array;
}

export interface HyperframesGraphStagePlan {
	sampleRate: number;
	channels: 2;
	renderFrames: number;
	cropStartSample: number;
	outputFrames: number;
	sources: { id: string; mimeType: string; byteLength: number }[];
	decodedSources: {
		id: string;
		resourceId: string;
		playbackRate: number;
		sampleRate: number;
		channels: 2;
		sourceSample: number;
		frames: number;
		pcmBytes: number;
		required: boolean;
		ratePreparation?: HyperframesRatePreparation;
	}[];
	tracks: {
		instanceId: string;
		resolvedBusInstanceId: string | null;
		decodedSourceId: string;
		requiresPcm: boolean;
		fxStage: HyperframesFxStage;
	}[];
	buses: {
		instanceId: string;
		memberInstanceIds: string[];
		requiresPcm: boolean;
		fxStage: HyperframesFxStage;
	}[];
}

export interface HyperframesGraphPcmBuffer {
	kind: "track-post-fx" | "bus-post-fx";
	instanceId: string;
	pcm: Buffer;
}

/** Geometry/ownership is revalidated by each Rust entry. Host only packages IO. */
export function hyperframesGraphEnvelope(
	manifest: unknown,
	buffers: readonly Uint8Array[],
): Buffer {
	const json = Buffer.from(JSON.stringify(manifest));
	const prefix = Buffer.alloc(4);
	prefix.writeUInt32LE(json.length);
	return Buffer.concat([prefix, json, ...buffers]);
}

export function hyperframesGraphMixEnvelope(
	request: unknown,
	fields: { busInstanceId: string } | { output: "canonical" | "crop" },
	buffers: readonly HyperframesGraphPcmBuffer[],
): Buffer {
	return hyperframesGraphEnvelope(
		{
			version: 1,
			request,
			...fields,
			buffers: buffers.map(({ kind, instanceId, pcm }) => ({
				kind,
				instanceId,
				byteLength: pcm.length,
			})),
		},
		buffers.map((item) => item.pcm),
	);
}
