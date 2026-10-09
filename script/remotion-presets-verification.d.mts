export function presetPixelSamples(rgba: Buffer): Buffer;
export function verifyPresetRgbStream(
	chunks: AsyncIterable<Buffer>,
	options: {
		width: number;
		height: number;
		firstFrame: number;
		frameCount: number;
		readSamples: (frame: number) => Promise<Buffer>;
	},
): Promise<{
	decodedFrames: number;
	meanAbsoluteError: number;
	worstFrameError: number;
}>;
export function comparePresetFrame(
	rgb: Buffer,
	expected: Buffer,
): {
	difference: number;
	count: number;
	opaque: number;
	nonblack: number;
	meanAbsoluteError: number;
};
export function verifyPresetVideo(options: {
	ffmpeg: string;
	file: string;
	framesDirectory: string;
	width: number;
	height: number;
	firstFrame: number;
	frameCount: number;
}): Promise<{
	decodedFrames: number;
	meanAbsoluteError: number;
	worstFrameError: number;
}>;
