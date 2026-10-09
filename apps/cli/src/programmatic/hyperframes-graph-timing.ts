import type { ProgrammaticSource } from "@opencut/editor-contracts";

export type HyperframesGraphTiming = NonNullable<
	ProgrammaticSource["audio"]
>["timing"];

/** Reviewed original @hyperframes/engine 0.8.139 audioMixer.js. This binds
 * Rust's final atrim + adelay adaptation, not caller-provided native code. */
const NATIVE_EXPORT_TIMING = Object.freeze({
	timing: "native-exporter" as const,
	timingRevision: 1 as const,
	mixerSha256:
		"bbe78eb851b4e5d6d2e94b0f6ec84b5de26b2fe5218cbe348d9e9cd89320ae78",
});

export function hyperframesGraphTimingIdentity(timing: HyperframesGraphTiming) {
	if (timing === undefined) return undefined;
	if (timing !== "native-exporter")
		throw Error("Unsupported HyperFrames graph timing");
	return NATIVE_EXPORT_TIMING;
}
