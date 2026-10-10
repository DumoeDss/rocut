import { BUBBLE_DEFAULTS } from "./bubble-oracle.mjs";
import { blazePipelineCodecThresholds } from "../probe-blaze-pipeline-contract.mjs";

const freeze = (value) => {
	if (value && typeof value === "object" && !Object.isFrozen(value)) {
		Object.values(value).forEach(freeze); Object.freeze(value);
	}
	return value;
};

export const bubbleExportContract = freeze({
	version: 1, width: 192, height: 128, frameRate: { numerator: 30, denominator: 1 },
	frames: 6, frameTicks: 4000, localTicks: [12000, 16000, 20000, 24000, 28000, 32000],
	trimStart: 16000, trimEnd: 8000, clipDuration: 96000,
	quality: "very_high", codec: "vp9", format: "webm", includeAudio: false,
	effectId: "template-bubble", trackId: "bubble-export-shots",
	sourceSpec: { id: "bubble-export-holes", kind: "holes", hiddenRgb: "poison" },
	schedule: { startTicks: 12000, durationTicks: 48000, follow: 1, trail: 8, trailDurationTicks: 8000,
		knots: [{ ticks: 0, x: 0.2, y: 0.5 }, { ticks: 20000, x: 0.8, y: 0.5 }, { ticks: 48000, x: 0.4, y: 0.3 }] },
	params: { ...BUBBLE_DEFAULTS, radius: 0.24, refraction: 0.2, ior: 1.7, dispersion: 1.3,
		shine: 0.8, rim: 1.2, iridescence: 1, intensity: 2, tintStrength: 0.8, tint: [0.05, 0.85, 0.2] },
	animated: { radius: [0.15, 0.4], tintStrength: [0.1, 1], tintR: [0.05, 1], tintG: [0.85, 0.1], tintB: [0.2, 0.9] },
	keyframeLocalTicks: [12000, 32000],
	thresholds: { ...blazePipelineCodecThresholds },
	thresholdSource: "Frozen Blaze VP9 very_high WebM default Profile 0/yuv420p and explicit 444 Profile 1/yuv444p: whole RGBA mean<=10, active RGB mean<=15, >=64 active pixels, timestamp tolerance 0.0011s. No export-output-based retuning.",
	clock: "Effect trajectory startTicks and optical keys are clip-local; effect time is timelineTicks - clip.startTime and excludes source trimStart.",
	scope: "Real Host export endpoint and attached production export surface; separate codec acceptance, not stricter native texture gates, UI authoring, installed Elftia, Electron, audio or performance acceptance.",
});

export const bubbleExportSegments = freeze([
	{ id: "moving", clipId: "bubble-export-moving", offset: 40000, enabled: true },
	{ id: "animated", clipId: "bubble-export-animated", offset: 160000, enabled: true },
	{ id: "disabled", clipId: "bubble-export-disabled", offset: 280000, enabled: false },
]);

export const bubbleExportJobs = freeze(["default", "444"].flatMap((chroma) => bubbleExportSegments.map((segment) => ({
	...segment, chroma, jobKey: `${chroma}-${segment.id}`, frames: bubbleExportContract.frames,
	timelineTicks: bubbleExportContract.localTicks.map((ticks) => ticks + segment.offset),
	options: { format: "webm", quality: "very_high", includeAudio: false,
		...(chroma === "444" ? { videoChroma: "444" } : {}),
		range: { startTime: segment.offset + 12000, endTime: segment.offset + 36000 } },
}))));

export const bubbleExportFiles = freeze([
	"script/fixtures/bubble-export-contract.mjs", "script/fixtures/bubble-export-reference.mjs",
	"script/fixtures/bubble-export-preflight.mjs", "script/fixtures/bubble-export-checks.mjs",
	"script/fixtures/bubble-export-decode.mjs", "script/fixtures/bubble-export.test.mjs", "script/bubble-export-prepare.mjs",
]);
