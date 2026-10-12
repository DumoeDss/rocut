import { createHash } from "node:crypto";
import { PARAMETERS, referenceRgba } from "./frost-reference-fixture.mjs";
import { opaqueRgb, thresholds } from "./flame-wrap-export-metrics.mjs";
import { measureTemporalChange, temporalThresholds } from "./frost-encoded-time-metrics.mjs";

export const FROST_SCHEDULE_VERSION = "frost-schedule-opaque-clock-v1";
export const WIDTH = 64, HEIGHT = 48;
export const FRAME_RATE = Object.freeze({ numerator: 30, denominator: 1 });
export const TICKS = Object.freeze(Array.from({ length: 13 }, (_, index) => index * 4000));
export const SEEK_TICKS = Object.freeze([48000, 16000, 12000, 28000, 0, 36000, 16000, 48000]);
export const STROKE = Object.freeze({ time: 12001, from: Object.freeze([0.2, 0.5]),
	to: Object.freeze([0.8, 0.5]), radius: 0.2, strength: 1 });
// Pair selection is authored before rendering or encoding, never fitted to output.
export const PAIRS = Object.freeze([
	Object.freeze({ id: "stamp", first: 3, last: 4 }),
	Object.freeze({ id: "recovery", first: 5, last: 9 }),
]);
export const FIXED_PARAMS = Object.freeze({ ...PARAMETERS, strokeCount: 1,
	stroke0TimeTicks: STROKE.time, stroke0FromX: STROKE.from[0], stroke0FromY: STROKE.from[1],
	stroke0ToX: STROKE.to[0], stroke0ToY: STROKE.to[1],
	stroke0Radius: STROKE.radius, stroke0Strength: STROKE.strength });
export const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

/** A new fully opaque source. The original transparent fixture is not changed. */
export function opaqueSourceRgba() {
	const result = new Uint8Array(WIDTH * HEIGHT * 4);
	for (let y = 0; y < HEIGHT; y++) for (let x = 0; x < WIDTH; x++) {
		const offset = (y * WIDTH + x) * 4;
		result.set([(31 + 3 * x + 7 * y) % 256,
			(97 + 11 * x + 2 * y) % 256,
			(53 + 5 * x + 13 * y) % 256, 255], offset);
	}
	return result;
}

export function scheduleReference(ticks, source = opaqueSourceRgba()) {
	return referenceRgba({ ticks, strokes: [STROKE] }, source);
}

export function createScheduleFixture() {
	const source = opaqueSourceRgba();
	const frames = TICKS.map((ticks, index) => {
		const rgba = scheduleReference(ticks, source);
		return { index, ticks, rgba, rgb: opaqueRgb(rgba), sha256: sha256(rgba) };
	});
	const pairs = PAIRS.map((pair) => {
		const expectedFirst = frames[pair.first].rgb, expectedLast = frames[pair.last].rgb;
		const input = { expectedFirst, expectedLast, width: WIDTH, height: HEIGHT };
		const identity = measureTemporalChange({ ...input, actualFirst: expectedFirst, actualLast: expectedLast });
		const freeze = measureTemporalChange({ ...input, actualFirst: frames[0].rgb, actualLast: frames[0].rgb });
		return { ...pair, firstTicks: TICKS[pair.first], lastTicks: TICKS[pair.last], identity, freeze };
	});
	return { version: FROST_SCHEDULE_VERSION, width: WIDTH, height: HEIGHT, frameRate: FRAME_RATE,
		parameters: FIXED_PARAMS, source, sourceSha256: sha256(source), alpha: { all255: true, opaquePixels: WIDTH * HEIGHT },
		gates: { ...thresholds, ...temporalThresholds }, frames, pairs };
}
