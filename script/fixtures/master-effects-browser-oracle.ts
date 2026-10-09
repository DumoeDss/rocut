// Independent input/color arithmetic: never derived from captured GPU pixels.
export const WIDTH = 96;
export const HEIGHT = 64;
export const FIRST_FRAME = 12;
export const FRAME_COUNT = 6;
export const FPS = 30;
export const SEED = 7;
export const NOISE = 0.25;
export type Color = readonly number[];
const byte = (n: number) => Math.round(Math.max(0, Math.min(255, n)));
const over = (under: Color, above: Color) =>
	under.map((value, channel) =>
		byte(value * (127 / 255) + above[channel]! * (128 / 255)),
	);
export function baseColor(x: number, y: number, frame: number): number[] {
	let color = [0, 64, 0];
	if (frame < 5 || frame >= 35) return color;
	color = over(color, [255, 0, 0]);
	if (x >= 32 && x < 64 && y >= 16 && y < 48) color = over(color, [0, 0, 255]);
	return color;
}
export function colorAdjustment(
	color: Color,
	exposure: number,
	contrast: number,
): number[] {
	return color.map((value) => {
		const srgb = value / 255;
		const linear =
			srgb <= 0.04045 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
		const changed = linear * 2 ** exposure;
		const display =
			changed <= 0.0031308
				? changed * 12.92
				: 1.055 * changed ** (1 / 2.4) - 0.055;
		return byte(((display - 0.5) * (1 + contrast / 100) + 0.5) * 255);
	});
}
export function orderedColor(color: Color, reverse = false): number[] {
	return reverse
		? colorAdjustment(colorAdjustment(color, 0, 50), 1, 0)
		: colorAdjustment(colorAdjustment(color, 1, 0), 0, 50);
}
function grain(x: number, y: number, frame: number): number {
	let value = (x + y * 4099 + frame * 131071 + SEED * 524287) >>> 0;
	value = Math.imul(value ^ (value >>> 16), 2146121005) >>> 0;
	value = Math.imul(value ^ (value >>> 15), 2221713035) >>> 0;
	return ((value ^ (value >>> 16)) & 65535) / 65535 - 0.5;
}
export function temporalColor(
	x: number,
	y: number,
	sceneFrame: number,
	clockFrame = sceneFrame,
): number[] {
	return orderedColor(baseColor(x, y, sceneFrame)).map((channel) =>
		byte(channel + 255 * NOISE * grain(x, y, clockFrame)),
	);
}
export function interior(x: number, y: number): boolean {
	// Exclude source edges/chroma boundaries, not noisy or difficult pixels.
	return (
		x >= 4 &&
		x < WIDTH - 4 &&
		y >= 4 &&
		y < HEIGHT - 4 &&
		Math.abs(x - 32) > 3 &&
		Math.abs(x - 64) > 3 &&
		Math.abs(y - 16) > 3 &&
		Math.abs(y - 48) > 3
	);
}

/** RGB-domain Rec.601 luma/chroma projections, not raw coded Y/U/V planes. */
export function decodedFrameMatrix(
	decoded: Uint8Array,
	frames: readonly { sceneFrame: number; rgba: Uint8Array }[],
) {
	if (
		decoded.length !== WIDTH * HEIGHT * 3 * FRAME_COUNT ||
		frames.length !== FRAME_COUNT
	)
		throw Error("Unexpected master diagnostic frame geometry");
	return Array.from({ length: FRAME_COUNT }, (_, encodedFrame) => {
		const pairs = frames.map(({ sceneFrame, rgba }) => {
			if (rgba.length !== WIDTH * HEIGHT * 4)
				throw Error("Unexpected GPU diagnostic geometry");
			const channels = [0, 0, 0],
				signed = [0, 0, 0];
			let count = 0,
				luma = 0,
				cb = 0,
				cr = 0;
			for (let y = 0; y < HEIGHT; y++)
				for (let x = 0; x < WIDTH; x++)
					if (interior(x, y)) {
						const delta = [0, 1, 2].map(
							(c) =>
								decoded[((encodedFrame * HEIGHT + y) * WIDTH + x) * 3 + c]! -
								rgba[(y * WIDTH + x) * 4 + c]!,
						);
						for (let c = 0; c < 3; c++) {
							channels[c]! += Math.abs(delta[c]!);
							signed[c]! += delta[c]!;
						}
						luma += Math.abs(
							0.299 * delta[0]! + 0.587 * delta[1]! + 0.114 * delta[2]!,
						);
						cb += Math.abs(
							-0.168736 * delta[0]! - 0.331264 * delta[1]! + 0.5 * delta[2]!,
						);
						cr += Math.abs(
							0.5 * delta[0]! - 0.418688 * delta[1]! - 0.081312 * delta[2]!,
						);
						count++;
					}
			return {
				sceneFrame,
				rgbMae: channels.reduce((a, b) => a + b, 0) / (count * 3),
				channelMae: channels.map((v) => v / count),
				channelBias: signed.map((v) => v / count),
				lumaMae: luma / count,
				cbMae: cb / count,
				crMae: cr / count,
			};
		});
		let previousDifference = 0,
			count = 0,
			residualSum = 0,
			residualSquareSum = 0;
		for (let y = 0; y < HEIGHT; y++)
			for (let x = 0; x < WIDTH; x++)
				if (interior(x, y)) {
					const baseline = orderedColor(
						baseColor(x, y, FIRST_FRAME + encodedFrame),
					);
					let residualLuma = 0;
					for (let c = 0; c < 3; c++) {
						const index = ((encodedFrame * HEIGHT + y) * WIDTH + x) * 3 + c;
						if (encodedFrame)
							previousDifference += Math.abs(
								decoded[index]! - decoded[index - WIDTH * HEIGHT * 3]!,
							);
						residualLuma +=
							[0.299, 0.587, 0.114][c]! * (decoded[index]! - baseline[c]!);
					}
					residualSum += residualLuma;
					residualSquareSum += residualLuma * residualLuma;
					count++;
				}
		return {
			encodedFrame,
			expectedSceneFrame: FIRST_FRAME + encodedFrame,
			pairs,
			nearestSceneFrameByRgb: pairs.reduce((a, b) =>
				a.rgbMae < b.rgbMae ? a : b,
			).sceneFrame,
			previousDecodedFrameRgbMae: encodedFrame
				? previousDifference / (count * 3)
				: null,
			residualLumaStandardDeviation: Math.sqrt(
				Math.max(0, residualSquareSum / count - (residualSum / count) ** 2),
			),
		};
	});
}
