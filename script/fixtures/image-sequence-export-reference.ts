/** Independent fixture math: never calls the implementation's frame resolver,
 * recipe evaluator, generated plan or sampled/rendered reference output.
 */
export const SEQUENCE_EXPORT = {
	width: 64,
	height: 36,
	frames: 6,
	step: 4004,
	trim: 5005,
	wrongTrim: 10010,
	startFrame: 1,
	activeFrames: 4,
	fps: { numerator: 30000, denominator: 1001 },
} as const;

export function expectedSequenceOrdinal(
	frame: number,
	trim: number,
): number | null {
	if (!Number.isInteger(frame) || frame < 0 || frame >= SEQUENCE_EXPORT.frames)
		throw Error("Invalid sequence export oracle frame");
	if (frame < 1 || frame >= 5) return null;
	const sourceTicks = BigInt(trim) + BigInt(frame - 1) * 4004n;
	return Math.min(221, Number((sourceTicks * 24000n) / (120000n * 1001n)));
}

export function expectedSequencePixels(frame: number, trim: number) {
	const { width, height } = SEQUENCE_EXPORT;
	const ordinal = expectedSequenceOrdinal(frame, trim);
	const rgb =
		ordinal === null
			? [0, 0, 0]
			: [ordinal, ((ordinal * 7) % 200) + 20, ((ordinal * 13) % 200) + 20];
	const result = new Uint8ClampedArray(width * height * 4);
	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			const at = (y * width + x) * 4;
			const color =
				ordinal === null
					? [0, 0, 0]
					: x < 48
						? rgb
						: y < 18
							? [128, 0, 0]
							: [0, 0, 0];
			for (let channel = 0; channel < 3; channel++)
				result[at + channel] = color[channel]!;
			// Source straight alpha is composited over an opaque black timeline.
			result[at + 3] = 255;
		}
	}
	return result;
}

export function sequencePixelDifference(
	a: Uint8ClampedArray,
	b: Uint8ClampedArray,
) {
	if (a.length !== b.length)
		throw Error("Sequence export pixel length mismatch");
	let max = 0,
		total = 0;
	for (let index = 0; index < a.length; index++) {
		const delta = Math.abs(a[index]! - b[index]!);
		max = Math.max(max, delta);
		total += delta;
	}
	return { max, mae: total / a.length };
}

export function captureSequencePixels(image: CanvasImageSource) {
	const { width, height } = SEQUENCE_EXPORT;
	const canvas = new OffscreenCanvas(width, height),
		ctx = canvas.getContext("2d")!;
	ctx.drawImage(image, 0, 0);
	return ctx.getImageData(0, 0, width, height).data;
}
