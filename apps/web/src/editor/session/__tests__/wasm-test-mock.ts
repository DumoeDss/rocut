import { mock } from "bun:test";

const TICKS_PER_SECOND = 120_000;

mock.module("opencut-wasm", () => ({
	TICKS_PER_SECOND: () => TICKS_PER_SECOND,
	applyEffectPasses: () => {},
	applyMaskFeather: () => {},
	formatTimecode: ({ time }: { time: number }) => String(time),
	getCompositorCanvas: () => null,
	getLastFrameProfile: () => null,
	initCompositor: () => {},
	initializeGpu: async () => false,
	lastFrameTime: ({ duration }: { duration: number }) => duration,
	mediaTimeFromSeconds: ({ seconds }: { seconds: number }) =>
		Math.round(seconds * TICKS_PER_SECOND),
	mediaTimeToSeconds: ({ time }: { time: number }) => time / TICKS_PER_SECOND,
	parseTimecode: () => null,
	releaseTexture: () => {},
	renderFrame: () => {},
	resizeCompositor: () => {},
	roundToFrame: ({ time }: { time: number }) => Math.round(time),
	snappedSeekTime: ({ time }: { time: number }) => time,
	uploadTexture: () => {},
}));
