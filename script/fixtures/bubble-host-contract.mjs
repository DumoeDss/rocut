export const bubbleHostSettings = {
	width: 192, height: 128, durationFrames: 60,
	frameRate: { numerator: 30, denominator: 1 }, seed: 97,
};

// Independent expected public catalog, not discovery-derived test expectations.
const optical = [
	["amount", 0, 1, 0.01, 1], ["radius", 0.005, 0.5, 0.001, 30 / 1080],
	["blend", 1, 24, 0.1, 14], ["refraction", -0.25, 0.25, 0.001, 80 / 1080],
	["ior", 1, 2.5, 0.01, 1.33], ["dispersion", 0, 3, 0.01, 1],
	["frost", 0, 1, 0.01, 0], ["shine", 0, 2, 0.01, 0.25],
	["rim", 0, 2, 0.01, 0.5], ["iridescence", 0, 2, 0.01, 1],
	["intensity", 0, 5, 0.01, 0.9], ["tintStrength", 0, 1, 0.01, 0],
	["tintR", 0, 1, 0.01, 1], ["tintG", 0, 1, 0.01, 1],
	["tintB", 0, 1, 0.01, 1], ["colorAR", 0, 1, 0.01, 0.2902],
	["colorAG", 0, 1, 0.01, 0.4549], ["colorAB", 0, 1, 0.01, 0.7216],
	["colorBR", 0, 1, 0.01, 0.4118], ["colorBG", 0, 1, 0.01, 0.4118],
	["colorBB", 0, 1, 0.01, 0.4157],
];
const controls = [
	["speed", 0, 6, 0.01, 2], ["follow", 0, 1, 0.01, 0.5],
	["trail", 1, 24, 1, 24], ["trailDurationTicks", 0, 120000, 1, 46000],
	["startTicks", 0, Number.MAX_SAFE_INTEGER, 1, 0],
	["durationTicks", 1000, 3600000, 1, 240000], ["pointCount", 1, 16, 1, 1],
];
const field = ([key, min, max, step, value], keyframable, required = null) =>
	({ key, type: "number", min, max, step, default: value, keyframable, required });
export const bubbleHostFields = [
	...optical.map((value) => field(value, true)),
	...controls.map((value) => field(value, false)),
	...Array.from({ length: 16 }, (_, index) => [
		field([`point${index}Time`, 0, index === 0 ? 0 : 3600000, 1, 0], false, index === 0),
		field([`point${index}X`, -1, 2, 0.001, 0.5], false, index === 0),
		field([`point${index}Y`, -1, 2, 0.001, 0.5], false, index === 0),
	]).flat(),
];
export const bubbleHostParams = {
	...Object.fromEntries([...optical, ...controls.slice(0, 6)].map(([key, , , , value]) => [key, value])),
	radius: 0.077, follow: 0.75, trail: 7, startTicks: 12000, durationTicks: 120000,
};
export const bubbleHostAnimated = Object.fromEntries(optical.map(([key, min, max]) =>
	[key, [min + (max - min) * 0.25, min + (max - min) * 0.75]]));
export const bubbleHostId = "template-bubble";
export const bubbleHostTrack = "bubble-shots";
export const bubbleHostSentinel = "bubble-unrelated";
export const bubbleHostTargetIds = ["bubble-static", "bubble-animated", "bubble-disabled", "bubble-sixteen"];
export const bubbleHostKnots = (sixteen = false) => sixteen
	? Array.from({ length: 16 }, (_, index) => ({ time: index * 8000, x: index / 15, y: 1 - index / 15 }))
	: [{ time: 0, x: 0.25, y: 0.4 }, { time: 120000, x: 0.75, y: 0.6 }];
export const bubbleHostChannel = (key, value) => ({ keys: [{ id: `${key}-invalid`,
	time: 0, value, segmentToNext: "linear", tangentMode: "auto" }] });
