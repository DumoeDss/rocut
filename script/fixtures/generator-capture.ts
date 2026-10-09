import type {
	ProgrammaticSource,
	ResolvedProgrammaticResource,
} from "@opencut/editor-contracts";
import { renderProgrammaticCanvas } from "../../packages/editor-classic/src/services/renderer/programmatic/canvas-runtime";
import { resolveProgrammaticFrame } from "../../packages/editor-classic/src/services/renderer/programmatic/frame";
import {
	assertGenerator as assert,
	generatorHash,
	generatorPixels,
} from "./generator-browser-assets";

export interface GeneratorCapture {
	(
		source: ProgrammaticSource,
		frameIndex: number,
		options?: {
			trim?: number;
			resources?: ResolvedProgrammaticResource[];
			signal?: AbortSignal;
		},
	): Promise<{ pixels: Uint8ClampedArray; hash: string }>;
}
export function generatorCapture(resources: ResolvedProgrammaticResource[]) {
	let count = 0;
	const capture: GeneratorCapture = async (source, index, options = {}) => {
		const ticks = Math.ceil(
			(index * 120000 * source.frameRate.denominator) /
				source.frameRate.numerator,
		);
		const frame = resolveProgrammaticFrame({
			source,
			clipStart: 12000,
			clipDuration: 180000,
			trimStart: options.trim ?? 0,
			timelineTime: 12000 + ticks,
		});
		assert(frame, "Generator frame mapping was empty");
		const bitmap = await renderProgrammaticCanvas({
			source,
			frame,
			resources: options.resources ?? resources,
			signal: options.signal,
		});
		try {
			count++;
			const pixels = generatorPixels(bitmap, source.width, source.height);
			return {
				pixels,
				hash: await generatorHash(new Uint8Array(pixels).buffer),
			};
		} finally {
			bitmap.close();
		}
	};
	return { capture, count: () => count };
}
export const clearPixels = (data: Uint8ClampedArray) =>
	data.every((v, i) => i % 4 !== 3 || v === 0);
