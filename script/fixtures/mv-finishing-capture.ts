import type { ProgrammaticSource } from "@opencut/editor-contracts";
import { renderProgrammaticCanvas } from "../../packages/editor-classic/src/services/renderer/programmatic/canvas-runtime";
import { resolveProgrammaticFrame } from "../../packages/editor-classic/src/services/renderer/programmatic/frame";

export function check(condition: unknown, message: string): asserts condition {
	if (!condition) throw Error(message);
}
export function pixels(image: CanvasImageSource): Uint8ClampedArray {
	const canvas = new OffscreenCanvas(100, 100),
		context = canvas.getContext("2d")!;
	context.drawImage(image, 0, 0);
	return context.getImageData(0, 0, 100, 100).data;
}
export function at(data: Uint8ClampedArray, x = 50, y = 50): number[] {
	return [...data.slice((y * 100 + x) * 4, (y * 100 + x) * 4 + 4)];
}
export async function digest(data: Uint8ClampedArray): Promise<string> {
	return [
		...new Uint8Array(
			await crypto.subtle.digest("SHA-256", new Uint8Array(data)),
		),
	].join(",");
}
export async function capture(
	source: ProgrammaticSource,
	index = 0,
): Promise<Uint8ClampedArray> {
	const frame = resolveProgrammaticFrame({
		source,
		clipStart: 0,
		clipDuration: 60000,
		trimStart: 0,
		timelineTime: index * 5000,
	});
	check(frame, `Missing source frame ${index}`);
	const image = await renderProgrammaticCanvas({
		source,
		resources: [],
		frame,
	});
	try {
		return pixels(image);
	} finally {
		image.close();
	}
}
export function assertGray(
	data: Uint8ClampedArray,
	value: number,
	label: string,
	tolerance = 1,
): void {
	const actual = at(data);
	check(
		actual
			.slice(0, 3)
			.every((channel) => Math.abs(channel - value) <= tolerance),
		`${label}: expected ${value}, got ${actual}`,
	);
}
