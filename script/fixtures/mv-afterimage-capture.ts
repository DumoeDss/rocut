import type {
	ProgrammaticSource,
	ResolvedProgrammaticResource,
	MvAfterimagePlan,
} from "@opencut/editor-contracts";
import { renderProgrammaticCanvas } from "../../packages/editor-classic/src/services/renderer/programmatic/canvas-runtime";
import { resolveProgrammaticFrame } from "../../packages/editor-classic/src/services/renderer/programmatic/frame";

export function check(ok: unknown, message: string): asserts ok {
	if (!ok) throw Error(message);
}
export function pixels(
	image: CanvasImageSource,
	width: number,
	height: number,
) {
	const c = new OffscreenCanvas(width, height),
		x = c.getContext("2d")!;
	x.drawImage(image, 0, 0);
	const data = x.getImageData(0, 0, width, height).data;
	c.width = c.height = 1;
	return data;
}
export function difference(a: Uint8ClampedArray, b: Uint8ClampedArray) {
	check(a.length === b.length, "Pixel sizes differ");
	let max = 0,
		total = 0,
		changed = 0;
	for (let i = 0; i < a.length; i++) {
		const d = Math.abs(a[i]! - b[i]!);
		max = Math.max(max, d);
		total += d;
		if (d) changed++;
	}
	return { max, mae: total / a.length, changed };
}
export async function capture(
	source: ProgrammaticSource,
	resources: readonly ResolvedProgrammaticResource[],
	index: number,
	trim = 0,
	mutate?: (data: MvAfterimagePlan) => void,
) {
	const step =
		(120000 * source.frameRate.denominator) / source.frameRate.numerator;
	const frame = resolveProgrammaticFrame({
		source,
		clipStart: 120000,
		trimStart: trim * step,
		clipDuration: (source.durationFrames - trim) * step,
		timelineTime: 120000 + (index - trim) * step,
	});
	check(frame, "Missing afterimage frame");
	if (mutate) {
		const root = frame.recipePlan?.root;
		check(root?.kind === "afterimage", "Unexpected afterimage root");
		mutate(root.data);
	}
	const bitmap = await renderProgrammaticCanvas({ source, resources, frame });
	try {
		return pixels(bitmap, source.width, source.height);
	} finally {
		bitmap.close();
	}
}
