/** Fixed before production high-chroma browser execution. */
export const highChromaContract = Object.freeze({
	version: 1,
	request: { format: "webm", quality: "very_high", videoChroma: "444" },
	output: { codec: "vp9", profile: "Profile 1", pixelFormat: "yuv444p" },
	thresholds: {
		exportMeanRgba: 10,
		exportActiveRgb: 15,
		exportMinimumActivePixels: 64,
		exportTimestampSeconds: 0.0011,
	},
	droplets: {
		id: "droplets-192x128-30",
		width: 192,
		height: 128,
		fps: 30,
		frames: 6,
		frameTicks: 4000,
		localTicks: [48000, 52000, 56000, 60000, 64000, 68000],
		timelineTicks: [60000, 64000, 68000, 72000, 76000, 80000],
		bitrate: 369000,
		sourceSha256:
			"14a910ec5e99dbc64b718bfb10abd6e8ba86a610767f569a74360b49d4fded53",
		expectedSha256:
			"8e9e463233f562e733925f7996df9aa2eebc8de160a4d0a626d1d3c9190828ed",
		baselineSha256:
			"14a910ec5e99dbc64b718bfb10abd6e8ba86a610767f569a74360b49d4fded53",
	},
	larger: {
		id: "solid-sequence-640x360-24",
		width: 640,
		height: 360,
		fps: 24,
		frames: 6,
		frameTicks: 5000,
		timelineTicks: [0, 5000, 10000, 15000, 20000, 25000],
		expectedSha256:
			"39bfc020d93fb536b6e3bb5ea0ca59ca6e9be1b82419878bff8bb948b110c8a6",
		baselineSha256:
			"b2eab2e96e1c94751425a42d1e435e41f8c48a5f1cd41ff4defb3931323ddc07",
		colors: [
			[220, 40, 60],
			[20, 180, 60],
			[30, 70, 220],
			[230, 160, 20],
			[170, 40, 210],
			[20, 190, 210],
		],
	},
	protocol: {
		version: 2,
		videoChroma: ["420", "444"],
		paneQuery: { exportProtocol: "2", exportVideoChroma: "444" },
		noCompatibleSurface: "no-compatible-export-surface",
	},
	historicalDefault420: {
		videoSha256:
			"ebbbac31d0cc3433118190c9ceadb592a49506cfaf2ce9c3806344202f04c740",
		browserFailedFrames: [5],
		defaultFfmpegFailedFrames: [0, 2, 4, 5],
		status: "preserved historical failure; never converted into a 444 pass",
	},
	prohibitions: [
		"No replacement or interception of VideoEncoder, canEncodeVideo, CanvasSource, or renderer methods in the formal browser fixture.",
		"Do not change old Droplets fixtures, references, thresholds, or historical evidence.",
		"Never choose a decoder filter or kernel to obtain acceptance; independent FFmpeg decode is default RGBA.",
		"No silent profile-0 fallback, wrong-format fallback, old-pane broadcast, or disconnect retarget for 444.",
	],
} as const);

export type HighChromaCaseId =
	| typeof highChromaContract.droplets.id
	| typeof highChromaContract.larger.id;
