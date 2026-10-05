import type { InputVideoTrack, VideoSinkDecoderOptions } from "mediabunny";

/** Shared preview/export cache: avoid hardware queue latency on random seeks. */
export async function resolveVideoDecoderOptions(
	track: Pick<InputVideoTrack, "getDecoderConfig">,
): Promise<VideoSinkDecoderOptions | undefined> {
	if (typeof VideoDecoder === "undefined") return undefined;
	try {
		const config = await track.getDecoderConfig();
		if (!config) return undefined;
		const support = await VideoDecoder.isConfigSupported({
			...config,
			hardwareAcceleration: "prefer-software",
		});
		if (support.supported) return { hardwareAcceleration: "prefer-software" };
	} catch {
		// This is an optional preference, not a new requirement for playable media.
	}
	return undefined;
}
