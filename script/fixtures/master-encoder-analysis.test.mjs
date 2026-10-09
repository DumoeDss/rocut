import assert from "node:assert/strict";
import test from "node:test";
import {
	FACTORS,
	CHROMA_BITRATE_FACTORS,
	controlledComparisons,
	WIDTH,
	HEIGHT,
	FPS,
	FRAME_COUNT,
	packetsToIvf,
	rgbMetrics,
	sourceRgba,
} from "./master-encoder-analysis.mjs";

test("every diagnostic factor changes just one field against unchanged 56000 bps baseline", () => {
	assert.deepEqual(FACTORS[0], { name: "baseline", patch: {} });
	for (const entry of FACTORS.slice(1))
		assert.equal(Object.keys(entry.patch).length, 1);
	assert.equal(
		FACTORS.find((entry) => entry.name === "bitrate-10x").patch.bitrate,
		56000 * 10,
	);
});

test("2x2 profile/budget matrix provides four exact single-variable causal pairs", () => {
	const results = CHROMA_BITRATE_FACTORS.map((factor) => ({
		factor,
		actualConfigure: {
			codec: "vp09.00.10.08",
			bitrate: 56000,
			width: WIDTH,
			height: HEIGHT,
			...factor.patch,
		},
		encodedPayloadBytes: 123,
		observations: [
			{
				ffmpegToOracle: { interiorRgbMae: 4 },
				chromiumToOracle: { interiorRgbMae: 5 },
			},
		],
	}));
	const pairs = controlledComparisons(results);
	assert.equal(pairs.length, 4);
	assert.ok(pairs.every((pair) => pair.supported));
	assert.deepEqual(
		pairs.map((pair) => pair.changedField),
		["bitrate", "codec", "codec", "bitrate"],
	);
	results.find((entry) => entry.factor.name === "profile1-high-budget")
		.actualConfigure.width++;
	assert.throws(
		() => controlledComparisons(results),
		/exactly its declared field/,
	);
});

test("IVF framing preserves all payload bytes and fixed rational timestamps", () => {
	const packets = Array.from({ length: FRAME_COUNT }, (_, index) => ({
		timestamp: Math.trunc((index / FPS) * 1e6),
		bytes: [index, 33, 254],
	}));
	const result = packetsToIvf(packets);
	assert.equal(result.toString("ascii", 0, 4), "DKIF");
	assert.equal(result.toString("ascii", 8, 12), "VP90");
	assert.equal(result.readUInt16LE(12), WIDTH);
	assert.equal(result.readUInt16LE(14), HEIGHT);
	assert.equal(result.readUInt32LE(16), FPS);
	assert.equal(result.readUInt32LE(20), 1);
	assert.equal(result.readUInt32LE(24), FRAME_COUNT);
	for (let index = 0; index < FRAME_COUNT; index++) {
		const offset = 32 + index * 15;
		assert.equal(result.readUInt32LE(offset), 3);
		assert.equal(result.readBigUInt64LE(offset + 4), BigInt(index));
		assert.deepEqual(
			[...result.subarray(offset + 12, offset + 15)],
			packets[index].bytes,
		);
	}
	assert.throws(() => packetsToIvf([...packets].reverse()));
});

test("BGRA extraction preserves channels, alpha and source bytes", () => {
	const bytes = Array.from(
		{ length: WIDTH * HEIGHT * 4 },
		(_, index) => [1, 2, 3, 255][index % 4],
	);
	const result = sourceRgba({
		format: "BGRA",
		codedWidth: WIDTH,
		codedHeight: HEIGHT,
		layout: [{ offset: 0, stride: WIDTH * 4 }],
		bytes,
	});
	assert.deepEqual([...result.subarray(0, 4)], [3, 2, 1, 255]);
	assert.deepEqual(bytes.slice(0, 4), [1, 2, 3, 255]);
});

test("MAE reports exact identities and full interior perturbation without relaxing gate", () => {
	const zeros = Buffer.alloc(WIDTH * HEIGHT * 3),
		fours = Buffer.alloc(zeros.length, 4);
	assert.deepEqual(rgbMetrics(zeros, zeros), {
		fullRgbMae: 0,
		interiorRgbMae: 0,
		maximumChannelError: 0,
	});
	assert.deepEqual(rgbMetrics(fours, zeros), {
		fullRgbMae: 4,
		interiorRgbMae: 4,
		maximumChannelError: 4,
	});
});
