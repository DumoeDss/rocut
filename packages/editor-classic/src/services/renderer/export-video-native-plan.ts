export type NativeVp9ExportPlan = {
	config: VideoEncoderConfig;
	quantizer: number;
	keyFrameIntervalFrames: number;
};

function record(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Validate the bridge response shape; policy values come exclusively from Rust. */
export function readNativeVp9Plan(value: unknown): NativeVp9ExportPlan {
	if (!record(value)) throw Error("Invalid native VP9 export policy response");
	const config = value.nativeConfig;
	if (
		!record(config) ||
		typeof config.codec !== "string" ||
		typeof config.width !== "number" ||
		typeof config.height !== "number" ||
		typeof config.displayWidth !== "number" ||
		typeof config.displayHeight !== "number" ||
		typeof config.bitrate !== "number" ||
		typeof config.framerate !== "number" ||
		config.alpha !== "discard" ||
		config.bitrateMode !== "quantizer" ||
		config.latencyMode !== "quality" ||
		config.hardwareAcceleration !== "prefer-software" ||
		typeof value.quantizer !== "number" ||
		typeof value.keyFrameIntervalFrames !== "number" ||
		!Number.isSafeInteger(value.keyFrameIntervalFrames) ||
		value.keyFrameIntervalFrames < 1
	)
		throw Error("Invalid native VP9 export policy response");
	return {
		quantizer: value.quantizer,
		keyFrameIntervalFrames: value.keyFrameIntervalFrames,
		config: {
			codec: config.codec,
			width: config.width,
			height: config.height,
			displayWidth: config.displayWidth,
			displayHeight: config.displayHeight,
			bitrate: config.bitrate,
			framerate: config.framerate,
			alpha: config.alpha,
			bitrateMode: config.bitrateMode,
			latencyMode: config.latencyMode,
			hardwareAcceleration: config.hardwareAcceleration,
		},
	};
}
