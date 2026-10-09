import { strict as assert } from "node:assert";

const W = 160,
	H = 90;
const rgb = (body, frame, x, y) => [
	...body.subarray(
		(frame * W * H + y * W + x) * 3,
		(frame * W * H + y * W + x) * 3 + 3,
	),
];
const white = (color) => color.every((value) => value > 185);
const close = (a, b, tolerance = 10) =>
	a.every((value, channel) => Math.abs(value - b[channel]) <= tolerance);
function background(frame) {
	const colors = [
		[24, 32, 76],
		[28, 90, 54],
		[106, 38, 50],
	];
	if (frame < 40) return colors[0];
	if (frame >= 100) return colors[2];
	const from = frame < 90 ? 0 : 1,
		progress = Math.min(1, (frame - (from === 0 ? 40 : 90)) / 10);
	return colors[from].map((value, c) =>
		Math.round(value * (1 - progress) + colors[from + 1][c] * progress),
	);
}

/** Uses decoded output, authored geometry and native-font mask references.
 * No production pixel, timeline, transition or frame-mapping helpers. */
export function verifyMultishotPixels(pixels, snapshots, wrongOrder) {
	assert.equal(pixels.length, 150 * W * H * 3);
	const masks = snapshots.map(({ rgba }) => {
		const mask = [];
		for (let y = 20; y < 76; y++)
			for (let x = 4; x < 156; x++) {
				const i = (y * W + x) * 4;
				if (rgba[i] > 235 && rgba[i + 1] > 235 && rgba[i + 2] > 235)
					mask.push([x, y]);
			}
		assert.ok(
			mask.length > 50,
			`Native glyph reference missing: ${mask.length}`,
		);
		return mask;
	});
	const measure = (sample, mask) => {
		let hidden = 0,
			visible = 0,
			failures = 0;
		for (const [x, y] of mask) {
			const color = sample(x, y);
			if (x >= 74 && x <= 85 && y >= 31 && y <= 58) {
				if (close(color, [233, 69, 96], 15)) hidden++;
				else failures++;
			} else if (x <= 68 || x >= 91 || y <= 25 || y >= 64) {
				if (white(color)) visible++;
				else failures++;
			}
		}
		return { hidden, visible, failures };
	};
	const admits = (m) => m.hidden >= 5 && m.visible >= 30 && m.failures <= 10;
	const frames = [];
	let offsetRejected = 0;
	for (let frame = 0; frame < 150; frame++) {
		const sample = (x, y) => rgb(pixels, frame, x, y),
			cue = Math.floor(frame / 50);
		const measured = measure(sample, masks[cue]);
		assert.ok(
			admits(measured),
			`Native lyric/foreground order frame ${frame}: ${JSON.stringify(measured)}`,
		);
		assert.ok(
			close(sample(152, 80), background(frame)),
			`Scene/crossfade clock frame ${frame}: ${sample(152, 80)} expected ${background(frame)}`,
		);
		const markerMatches = (expectedFrame) => {
			const x = 8 + (expectedFrame % 50) * 2;
			return [4, 6].every((offset) =>
				close(sample(x + offset, 12), [60, 214, 145]),
			);
		};
		assert.ok(markerMatches(frame), `Remotion frame marker ${frame}`);
		// The exact same two-point marker gate must reject the next frame's clock.
		if (!markerMatches(frame + 1)) offsetRejected++;
		frames.push({ frame, cue, background: sample(152, 80), ...measured });
	}
	const wrong = measure((x, y) => {
		const i = (y * W + x) * 4;
		return wrongOrder.rgba.slice(i, i + 3);
	}, masks[1]);
	assert.equal(
		admits(wrong),
		false,
		"Actual wrong-layer render escaped the same glyph gate",
	);
	assert.ok(
		wrong.failures >= 5,
		"Wrong-layer negative control is not observably different",
	);
	assert.ok(
		offsetRejected >= 140,
		`One-frame marker offset not distinguishable: ${offsetRejected}`,
	);
	const cueDifferences = masks.slice(1).map((mask, i) => {
		const left = new Set(masks[i].map(([x, y]) => y * W + x));
		const right = new Set(mask.map(([x, y]) => y * W + x));
		const changed =
			[...left].filter((k) => !right.has(k)).length +
			[...right].filter((k) => !left.has(k)).length;
		assert.ok(changed > 40, `Native cue switch ${i} not visible: ${changed}`);
		return changed;
	});
	// Reject a hard cut at the two authored crossfade midpoints with the same color tolerance.
	for (const frame of [45, 95]) {
		const actual = rgb(pixels, frame, 152, 80);
		assert.ok(
			!close(actual, background(frame - 5)) &&
				!close(actual, background(frame + 5)),
			`Crossfade ${frame} is indistinguishable from a cut`,
		);
	}
	return {
		frames,
		cueDifferences,
		wrongOrderRejected: true,
		wrongOrderMeasurements: wrong,
		oneFrameOffsetRejectedFrames: offsetRejected,
		transitionMidpoints: [frames[45].background, frames[95].background],
	};
}
