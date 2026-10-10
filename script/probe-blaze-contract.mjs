import assert from "node:assert/strict";

export const blazeRawThresholds = Object.freeze({
	premultipliedRgbMean: 0.5,
	premultipliedRgbMaximum: 4,
	alphaMean: 0.35,
	alphaMaximum: 3,
	straightRgbAlphaMinimum: 16,
	straightRgbMean: 1.5,
	straightRgbMaximum: 8,
	activeDifference: 8,
	minimumBroadActivePixels: 64,
	minimumSparkActivePixels: 8,
	identity: 0,
});
export const blazeRawReference =
	"Independent blazeExpected on canonical input RGBA; never production-rendered expected pixels";
const keys = [
	"amount",
	"flameOpacity",
	"sparkOpacity",
	"smokeOpacity",
	"refraction",
	"height",
	"scale",
	"speed",
	"wind",
	"seed",
].sort();

export function validateBlazeRaw(raw, complete = true) {
	assert.equal(raw?.version, 1);
	assert.equal(raw.reference, blazeRawReference);
	assert.deepEqual(
		raw.thresholds,
		blazeRawThresholds,
		"Blaze frozen RAW gates changed",
	);
	assert(
		Array.isArray(raw.sources) &&
			Array.isArray(raw.frames) &&
			Array.isArray(raw.negatives),
	);
	assert(
		raw.sources.length <= 10 &&
			raw.frames.length <= 356 &&
			raw.negatives.length <= 31,
		"Blaze capture exceeds frozen matrix",
	);
	const ids = new Set();
	for (const source of raw.sources) {
		assert(
			typeof source.id === "string" && !ids.has(source.id),
			"Duplicate/missing Blaze source ID",
		);
		ids.add(source.id);
		assert(
			[
				[192, 128],
				[256, 96],
				[96, 256],
			].some(([w, h]) => source.width === w && source.height === h),
		);
		assert(["opaque", "holes", "transparent"].includes(source.kind));
		assert(["gradient", "stress"].includes(source.pattern));
	}
	const frameIds = new Set();
	for (const frame of raw.frames) {
		assert(
			typeof frame.id === "string" && !frameIds.has(frame.id),
			"Duplicate/missing Blaze frame ID",
		);
		frameIds.add(frame.id);
		assert(ids.has(frame.sourceId), "Blaze frame missing original input");
		assert(Number.isSafeInteger(frame.ticks));
		assert(typeof frame.enabled === "boolean");
		assert.deepEqual(Object.keys(frame.params ?? {}).sort(), keys);
		assert(Object.values(frame.params).every(Number.isFinite));
		assert([30, 30000].includes(frame.rate?.numerator));
		assert(frame.rate.denominator === (frame.rate.numerator === 30 ? 1 : 1001));
	}
	const negativeNames = new Set();
	for (const negative of raw.negatives) {
		assert(
			typeof negative.name === "string" && !negativeNames.has(negative.name),
			"Duplicate/missing Blaze negative ID",
		);
		negativeNames.add(negative.name);
		assert(ids.has(negative.sourceId), "Blaze negative missing original input");
	}
	if (complete) {
		assert.equal(raw.sources.length, 10, "Missing Blaze input captures");
		assert.equal(raw.frames.length, 356, "Missing Blaze RAW captures");
		assert.equal(raw.negatives.length, 31, "Missing Blaze negative captures");
		for (const [width, height] of [
			[192, 128],
			[256, 96],
			[96, 256],
		])
			for (const kind of ["opaque", "holes", "transparent"])
				for (const name of [
					"flame",
					"sparks",
					"smoke",
					"heat",
					"combined",
					"zeroContributions",
					"disabled",
					"zeroAmount",
					"otherSeed",
					"negativeSeek",
					"rationalClock",
					"largeClock",
					"parameter-reference",
					...keys.map((key) => `parameter-${key}`),
					...[96000, 16000, 64000, 0, 48000, 16000, -4001, 96000].map(
						(tick, index) => `seek ${index} ticks ${tick}`,
					),
					"exact binary speed period",
					"negative floor",
					"negative floor frame",
					"speed zero",
					"speed zero late",
					"speed zero authored wind",
				])
					assert(
						frameIds.has(`${width}x${height}-${kind} ${name}`),
						`Missing ${kind} ${name}`,
					);
		for (const ticks of [56000, 60000, 64000, 236000, 240000, 244000])
			assert(frameIds.has(`192x128-holes phase-boundary ${ticks}`));
		for (const seed of [0, 1, 65535])
			assert(frameIds.has(`192x128-holes seed-boundary ${seed}`));
		for (const tick of [
			-4005,
			-1,
			4003,
			4004,
			Number.MAX_SAFE_INTEGER,
			-Number.MAX_SAFE_INTEGER,
		])
			assert(frameIds.has(`192x128-holes rational-time ${tick}`));
		for (const tick of [0, 48000, 300000])
			assert(frameIds.has(`192x128-holes default-speed-f64 ${tick}`));
		for (const wind of [-1, 0, 1])
			assert(frameIds.has(`192x128-holes small-scale extreme-wind ${wind}`));
		for (const name of ["heat", "combined"])
			assert(frameIds.has(`stress ${name}`));
		for (const mode of ["flame", "sparks", "smoke", "heat", "combined"])
			for (const mutation of [
				"disabled or suppressed contribution",
				"zero output",
				"wrong seed",
				"repeated first frame",
				"reversed wind",
			])
				assert(negativeNames.has(`${mode} ${mutation}`));
		for (const mutation of [
			"verticalSign",
			"edgeClamp",
			"straightAlpha",
			"heatOverlay",
			"nearest",
		])
			assert(negativeNames.has(`heat ${mutation}`));
		assert(negativeNames.has("forced opaque alpha"));
	}
	return raw;
}
