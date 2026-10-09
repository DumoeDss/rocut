import type { ProgrammaticSource } from "@opencut/editor-contracts";
import {
	isProgrammaticAudioIdentity,
	type ProgrammaticAudioIdentity,
} from "@opencut/editor-ports/host";
import * as wasm from "opencut-wasm";
import { renderHyperframesAudioRange } from "./hyperframes-audio-render";
import { renderHyperframesGraphAudioRange } from "./hyperframes-graph-audio";
import { prepareHyperframesGraphIdentity } from "./hyperframes-graph-identity";
import { renderRemotionAudioRange } from "./remotion-audio-render";
import type { ProgrammaticResourceStore } from "./resources";
import type { NativeVideoDecoder } from "./video-decoder";

export class NativeAudioUnavailableError extends Error {}
interface Input {
	source: ProgrammaticSource;
	firstFrame: number;
	frameCount: number;
	sampleRate: 44100 | 48000;
	expectedIdentity?: ProgrammaticAudioIdentity;
}

/** The authenticated service owns lifecycle/admission slots. Rust owns source
 * and range policy. This adapter selects IO only after both are admitted. */
export async function performProgrammaticAudio({
	action,
	input: untrusted,
	resourceStore,
	executable,
	decoder,
	toolchainDirectory,
	graphConfigured,
	sessionNonce,
	signal,
}: {
	action: "render" | "identity";
	input: unknown;
	resourceStore: ProgrammaticResourceStore;
	executable: string;
	decoder: NativeVideoDecoder;
	toolchainDirectory?: string;
	graphConfigured: boolean;
	sessionNonce: string;
	signal: AbortSignal;
}) {
	signal.throwIfAborted();
	const keys =
		action === "identity"
			? ["source", "sampleRate"]
			: [
					"source",
					"firstFrame",
					"frameCount",
					"sampleRate",
					"expectedIdentity",
				];
	if (
		!untrusted ||
		typeof untrusted !== "object" ||
		Array.isArray(untrusted) ||
		Object.keys(untrusted).some((key) => !keys.includes(key))
	)
		throw Error("Invalid native audio request");
	const input = untrusted as Input;
	const policy = JSON.parse(
		wasm.resolveProgrammaticAudioSourceJson(
			JSON.stringify({ source: input.source, sampleRate: input.sampleRate }),
		),
	);
	if (policy.error || !policy.plan)
		throw Error(policy.error ?? "Native audio was not declared by this source");
	const graph = policy.plan.profile === "hyperframes-graph-v1";
	if (!graph && (action === "identity" || input.expectedIdentity !== undefined))
		throw Error(
			"Runtime identity is only available for the HyperFrames graph profile",
		);
	if (graph && !graphConfigured)
		throw new NativeAudioUnavailableError(
			"HyperFrames graph audio requires a configured pinned engine toolchain",
		);
	if (
		graph &&
		action === "render" &&
		!isProgrammaticAudioIdentity(input.expectedIdentity)
	)
		throw Error("HyperFrames graph audio requires a current runtime identity");
	if (action === "render") {
		const range = JSON.parse(
			wasm.resolveProgrammaticAudioRangeJson(
				JSON.stringify({
					version: 1,
					frameRate: input.source.frameRate,
					durationFrames: input.source.durationFrames,
					firstFrame: input.firstFrame,
					frameCount: input.frameCount,
					sampleRate: input.sampleRate,
				}),
			),
		);
		if (range.error || !range.plan)
			throw Error(range.error ?? "Invalid native audio range");
	}
	const prepared = graph
		? await prepareHyperframesGraphIdentity({
				source: input.source,
				resourceStore,
				executable,
				decoder,
				toolchainDirectory: toolchainDirectory!,
				sessionNonce,
				signal,
			})
		: undefined;
	if (action === "identity")
		return { kind: "identity" as const, identity: prepared!.identity };
	const options = {
		source: input.source,
		firstFrame: input.firstFrame,
		frameCount: input.frameCount,
		sampleRate: input.sampleRate,
		resourceStore,
		executable,
		decoder,
		signal,
	};
	if (prepared) {
		if (input.expectedIdentity!.id !== prepared.identity.id)
			throw Error(
				"HyperFrames audio runtime identity changed; refresh identity before rendering",
			);
		await prepared.verifyBeforeRender(signal);
		const result = await renderHyperframesGraphAudioRange({
			...options,
			decoder: prepared.decoder,
			toolchainDirectory: toolchainDirectory!,
			runtime: prepared.runtime,
			expectedProvenance: prepared.provenance,
		});
		await prepared.verifyAfterRender(result.provenance, signal);
		return { kind: "pcm" as const, result, identity: prepared.identity };
	}
	const render =
		input.source.build?.engine === "hyperframes"
			? renderHyperframesAudioRange
			: renderRemotionAudioRange;
	return {
		kind: "pcm" as const,
		result: await render(options),
		identity: undefined,
	};
}
