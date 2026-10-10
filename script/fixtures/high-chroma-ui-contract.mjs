/** UI/Host transport acceptance, distinct from pixel-fidelity acceptance. */
export const highChromaUiContract = Object.freeze({
	width: 640,
	height: 360,
	fps: 30,
	frames: 6,
	durationTicks: 24000,
	clipId: "high-chroma-ui-droplets",
	projectName: "High chroma six-frame UI acceptance",
	request: Object.freeze({
		format: "webm",
		quality: "medium",
		videoChroma: "444",
		includeAudio: false,
	}),
	codec: "vp9",
	profile: "Profile 1",
	pixelFormat: "yuv444p",
	timestampToleranceSeconds: 0.0011,
});
