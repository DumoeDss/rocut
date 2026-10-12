import { createHash } from "node:crypto";
import {
	cellRandom, crystalAt, capsuleAt, strengthAt, frameTicks, samplePremultiplied,
} from "./frost-reference-math.mjs";

export const WIDTH = 64, HEIGHT = 48;
export const FRAME_RATE = Object.freeze({ numerator: 30, denominator: 1 });
export const PARAMETERS = Object.freeze({
	amount: 0.8, coverage: 0.9, scale: 7, blur: 0.025, refraction: 0.035,
	tintR: 0.7, tintG: 0.82, tintB: 1, tintStrength: 0.35,
	seed: 17, holdTicks: 8000, recoveryTicks: 16000,
});
const stroke = Object.freeze({
	time: 12001, from: Object.freeze([0.2, 0.5]),
	to: Object.freeze([0.8, 0.5]), radius: 0.2, strength: 1,
});
export const CASES = Object.freeze([
	{ id: "static-ice", ticks: 0, strokes: [] },
	{ id: "before-stamp", ticks: 15999, strokes: [stroke] },
	{ id: "stamp-full", ticks: 16000, strokes: [stroke] },
	{ id: "hold-end", ticks: 20000, strokes: [stroke] },
	{ id: "recover-half", ticks: 28000, strokes: [stroke] },
	{ id: "recovered", ticks: 40000, strokes: [stroke] },
	{ id: "restamped", ticks: 44000, strokes: [stroke, { ...stroke, time: 40001 }] },
	{ id: "seed-variant", ticks: 0, strokes: [], seed: 18 },
	{ id: "negative-handle", ticks: -1, strokes: [stroke] },
	{ id: "neutral", ticks: 28000, strokes: [stroke], amount: 0 },
].map((item) => Object.freeze({ ...item, strokes: Object.freeze(item.strokes.map((value) =>
	Object.freeze({ ...value, from: Object.freeze([...value.from]), to: Object.freeze([...value.to]) }))) })));

export const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
export function sourceRgba() {
	const bytes = new Uint8Array(WIDTH * HEIGHT * 4);
	let partial = 0;
	for (let y = 0; y < HEIGHT; y++) {
		for (let x = 0; x < WIDTH; x++) {
			const i = (y * WIDTH + x) * 4;
			bytes[i] = (31 + 3 * x + 7 * y) % 256;
			bytes[i + 1] = (97 + 11 * x + 2 * y) % 256;
			bytes[i + 2] = (53 + 5 * x + 13 * y) % 256;
			const hole = (x >= 28 && x <= 36 && y >= 18 && y <= 29) || (x === 27 && y === 23);
			bytes[i + 3] = hole ? 0 : partial++ < 424 ? 96 : 255;
		}
	}
	return bytes;
}

function premultipliedPixel(source, offset) {
	const alpha = source[offset + 3] / 255;
	return [source[offset] / 255 * alpha, source[offset + 1] / 255 * alpha,
		source[offset + 2] / 255 * alpha, alpha];
}
export function referenceRgba(testCase, source = sourceRgba()) {
	if (!(source instanceof Uint8Array) || source.length !== WIDTH * HEIGHT * 4)
		throw Error("Exact 64x48 RGBA8 source required");
	const params = { ...PARAMETERS, ...testCase };
	const ticks = frameTicks(testCase.ticks, FRAME_RATE);
	if (ticks < 0 || params.amount === 0 || params.coverage === 0 ||
		(params.blur === 0 && params.refraction === 0 && params.tintStrength === 0))
		return source.slice();
	const output = new Uint8Array(source.length), short = Math.min(WIDTH, HEIGHT);
	for (let y = 0; y < HEIGHT; y++) {
		for (let x = 0; x < WIDTH; x++) {
			const i = (y * WIDTH + x) * 4;
			if (source[i + 3] === 0) continue;
			const px = (x + 0.5) / short, py = (y + 0.5) / short;
			const melt = Math.max(0, ...testCase.strokes.map((item) =>
				capsuleAt(px, py, item, WIDTH, HEIGHT) *
				strengthAt(item, ticks, params.holdTicks, params.recoveryTicks)));
			const frost = melt >= 1 ? 0 : params.amount * params.coverage *
				(0.25 + 0.75 * crystalAt(px, py, params.scale, params.seed)) * (1 - melt);
			if (frost === 0) { output.set(source.subarray(i, i + 4), i); continue; }
			const cx = Math.floor(px * params.scale), cy = Math.floor(py * params.scale);
			const sx = x + 0.5 + (2 * cellRandom(cx, cy, params.seed, 7) - 1) * params.refraction * short * frost;
			const sy = y + 0.5 + (2 * cellRandom(cx, cy, params.seed, 8) - 1) * params.refraction * short * frost;
			let color = premultipliedPixel(source, i);
			if (params.blur > 0) {
				color = [0, 0, 0, 0];
				for (let by = -1; by <= 1; by++) for (let bx = -1; bx <= 1; bx++) {
					const weight = (bx === 0 ? 2 : 1) * (by === 0 ? 2 : 1) / 16;
					const sample = samplePremultiplied(source, WIDTH, HEIGHT,
						sx + bx * params.blur * short * frost, sy + by * params.blur * short * frost);
					for (let c = 0; c < 4; c++) color[c] += weight * sample[c];
				}
			} else if (params.refraction > 0) color = samplePremultiplied(source, WIDTH, HEIGHT, sx, sy);
			const tint = [params.tintR, params.tintG, params.tintB];
			for (let c = 0; c < 3; c++) {
				const straight = color[3] > 1e-8 ? color[c] / color[3] : 0;
				const value = straight + (tint[c] - straight) * params.tintStrength * frost;
				output[i + c] = Math.round(Math.max(0, Math.min(1, value)) * 255);
			}
			output[i + 3] = source[i + 3];
		}
	}
	return output;
}

export function createReferenceFixture() {
	const source = sourceRgba();
	return {
		id: "frost-optical-fixture-v2", width: WIDTH, height: HEIGHT,
		frameRate: FRAME_RATE, params: PARAMETERS, source, sourceSha256: sha256(source),
		cases: CASES.map((item) => {
			const expected = referenceRgba(item, source);
			return { ...item, expected, expectedSha256: sha256(expected) };
		}),
	};
}
