import type { VideoEncodingConfig } from "mediabunny";
import { waitForExportOperation } from "./export-cancellation";

type HighChromaRequest = {
	width: number;
	height: number;
	bitrate: number;
	frameRate: number;
	fullCodecString: string;
	signal?: AbortSignal;
};

/** Capability queries cannot be aborted natively; late replies must not start an encoder. */
export async function resolveHighChromaVideoOptions({
	probeTimeoutMs = 10_000,
	...request
}: HighChromaRequest & {
	probeTimeoutMs?: number;
}): Promise<VideoEncodingConfig> {
	if (
		!Number.isInteger(probeTimeoutMs) ||
		probeTimeoutMs < 1 ||
		probeTimeoutMs > 10_000
	)
		throw new Error("Invalid video encoder probe deadline");
	if (typeof VideoEncoder === "undefined")
		throw new Error(
			"High-fidelity WebM (4:4:4) requires WebCodecs VideoEncoder support",
		);
	const config: VideoEncoderConfig = {
		codec: request.fullCodecString,
		width: request.width,
		height: request.height,
		bitrate: request.bitrate,
		framerate: request.frameRate,
		hardwareAcceleration: "prefer-software",
		latencyMode: "quality",
	};
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		const result = await waitForExportOperation({
			signal: request.signal ?? new AbortController().signal,
			operation: () =>
				new Promise<VideoEncoderSupport>((resolve, reject) => {
					timer = setTimeout(
						() =>
							reject(
								new Error(
									"High-fidelity WebM (4:4:4) encoder capability query timed out",
								),
							),
						probeTimeoutMs,
					);
					VideoEncoder.isConfigSupported(config).then(resolve, reject);
				}),
		});
		if (!result.supported)
			throw new Error(
				"High-fidelity WebM (4:4:4) is not supported by this browser; choose compatible 4:2:0 export",
			);
		// An older or partial implementation must not claim success after dropping the requested plan.
		for (const key of [
			"codec",
			"width",
			"height",
			"bitrate",
			"framerate",
			"hardwareAcceleration",
			"latencyMode",
		] as const) {
			if (result.config?.[key] !== config[key])
				throw new Error(`High-fidelity WebM encoder capability changed ${key}`);
		}
		return {
			codec: "vp9",
			bitrate: request.bitrate,
			fullCodecString: request.fullCodecString,
			hardwareAcceleration: "prefer-software",
		};
	} finally {
		if (timer !== undefined) clearTimeout(timer);
	}
}
