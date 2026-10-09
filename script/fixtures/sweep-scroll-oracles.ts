import { assertGenerator as assert } from "./generator-browser-assets";
import { sweepScene } from "./sweep-scroll-fixture";

export function compareSweepScroll(
	actual: Uint8ClampedArray,
	expected: Uint8ClampedArray,
	label: string,
) {
	assert(actual.length === expected.length, `${label}: dimensions`);
	let maximum = 0,
		alphaMaximum = 0,
		sum = 0;
	for (let i = 0; i < actual.length; i += 4) {
		alphaMaximum = Math.max(
			alphaMaximum,
			Math.abs(actual[i + 3] - expected[i + 3]),
		);
		for (let c = 0; c < 3; c++) {
			const error = Math.abs(
				(actual[i + c] * actual[i + 3]) / 255 -
					(expected[i + c] * expected[i + 3]) / 255,
			);
			maximum = Math.max(maximum, error);
			sum += error;
		}
	}
	assert(
		maximum <= 2 && alphaMaximum <= 2,
		`${label}: ${JSON.stringify({ maximum, alphaMaximum })}`,
	);
	return { maximum, alphaMaximum, mean: sum / ((actual.length / 4) * 3) };
}

export function sweepOracle(
	frame: number,
	direction: "leftToRight" | "rightToLeft" = "leftToRight",
) {
	const canvas = new OffscreenCanvas(192, 108),
		ctx = canvas.getContext("2d")!;
	const settings = sweepScene().settings;
	ctx.font = 'normal 500 20px "RocutSweepFixture"';
	ctx.textAlign = "center";
	ctx.textBaseline = "middle";
	ctx.globalAlpha = 0.9;
	const a = settings.textA.split("\n"),
		b = settings.textB.split("\n");
	const front = -0.125 + (frame / 24) * 1.25;
	for (let row = 0; row < 2; row++)
		for (let col = 0; col < 12; col++) {
			const coordinate = ((col + 0.5) * 12) / 168;
			const u = direction === "leftToRight" ? coordinate : 1 - coordinate;
			const active =
				frame > 0 && frame < 24 && u >= front - 0.125 && u <= front + 0.125;
			const text =
				frame <= 0
					? a[row][col]
					: frame >= 24
						? b[row][col]
						: active
							? "#"
							: u < front - 0.125
								? b[row][col]
								: a[row][col];
			ctx.fillStyle = active
				? "rgba(255,114.75,25.5,1)"
				: "rgba(229.5,242.25,255,0.8)";
			ctx.fillText(text, 12 + (col + 0.5) * 12, 10.8 + (row + 0.5) * 24, 12);
		}
	return ctx.getImageData(0, 0, 192, 108).data;
}

export function scrollOracle(image: OffscreenCanvas, frame: 0 | 12 | 24) {
	const canvas = new OffscreenCanvas(192, 108),
		ctx = canvas.getContext("2d")!;
	if (frame === 0) ctx.drawImage(image, 0, 0, 192, 108);
	if (frame === 12) {
		// At half progress the intact final quarter is followed by two known fragment columns.
		ctx.drawImage(image, 48, 0, 16, 36, 144, 0, 48, 108);
		ctx.save();
		ctx.beginPath();
		ctx.rect(0, 0, 144, 108);
		ctx.clip();
		for (const row of [0, 1])
			for (const piece of [
				{ sourceX: 16, centerX: 72, scale: 0.55, alpha: 0.0625 },
				{ sourceX: 32, centerX: 120, scale: 0.85, alpha: 0.5625 },
			]) {
				ctx.save();
				ctx.globalAlpha = piece.alpha;
				ctx.translate(piece.centerX, 27 + row * 54);
				ctx.scale(piece.scale, piece.scale);
				ctx.drawImage(image, piece.sourceX, row * 18, 16, 18, -24, -27, 48, 54);
				ctx.restore();
			}
		ctx.restore();
	}
	return ctx.getImageData(0, 0, 192, 108).data;
}
