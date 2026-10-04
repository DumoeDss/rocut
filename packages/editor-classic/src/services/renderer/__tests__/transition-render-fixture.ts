import type { WrappedCanvas } from "mediabunny";
import type { SceneTracks, VideoElement } from "../../../timeline";
import type { MediaAsset } from "../../../media/types";
import { mediaTime } from "../../../wasm";
import { buildScene } from "../scene-builder";

export class SampleCanvas {
	width: number;
	height: number;
	sample = -1;
	constructor(...[width, height]: [number, number]) {
		this.width = width;
		this.height = height;
	}
	getContext() {
		return {
			drawImage: (source: SampleCanvas) => {
				this.sample = source.sample;
			},
		};
	}
}
export function installCanvases() {
	const original = Object.getOwnPropertyDescriptor(
		globalThis,
		"OffscreenCanvas",
	);
	Object.defineProperty(globalThis, "OffscreenCanvas", {
		configurable: true,
		value: SampleCanvas,
	});
	return () => {
		if (original)
			Object.defineProperty(globalThis, "OffscreenCanvas", original);
		else Reflect.deleteProperty(globalThis, "OffscreenCanvas");
	};
}
export function decoder() {
	const canvas = new OffscreenCanvas(640, 360);
	if (!(canvas instanceof SampleCanvas))
		throw new Error("Missing canvas fixture");
	const times: number[] = [];
	return {
		times,
		async getFrameAt({
			time,
		}: {
			time: number;
		}): Promise<WrappedCanvas | null> {
			times.push(time);
			canvas.sample = time;
			return { canvas, timestamp: time, duration: 1 / 30 };
		},
	};
}
export const frameRate = { numerator: 30, denominator: 1 };
export const renderer = { width: 640, height: 360 };
export function fixture({ blur = false, preview = false } = {}) {
	const source: MediaAsset = {
		id: "source",
		name: "source.mp4",
		type: "video",
		duration: 20,
		file: new File(["fixture"], "source.mp4"),
		url: "blob:source",
	};
	const outgoing: VideoElement = {
		id: "a",
		type: "video",
		name: "A",
		mediaId: source.id,
		startTime: mediaTime({ ticks: 0 }),
		duration: mediaTime({ ticks: 360_000 }),
		trimStart: mediaTime({ ticks: 120_000 }),
		trimEnd: mediaTime({ ticks: 0 }),
		params: { opacity: 0.7, blendMode: "multiply" },
	};
	const incoming: VideoElement = {
		...outgoing,
		id: "b",
		name: "B",
		startTime: mediaTime({ ticks: 360_000 }),
		params: { opacity: 0.3, blendMode: "screen" },
		transitionIn: {
			kind: "cross-dissolve",
			outgoingClipId: "a",
			durationFrames: 30,
		},
	};
	const tracks: SceneTracks = {
		main: {
			id: "main",
			type: "video",
			name: "Main",
			elements: [outgoing, incoming],
			hidden: false,
			muted: false,
		},
		overlay: [],
		audio: [],
	};
	const assets = [source];
	const build = () =>
		buildScene({
			tracks,
			mediaAssets: assets,
			canvasSize: renderer,
			duration: 720_000,
			background: blur
				? { type: "blur", blurIntensity: 10 }
				: { type: "color", color: "transparent" },
			isPreview: preview,
			assetResolver: { resolve: ({ ref }) => ref.path },
		});
	return { source, outgoing, incoming, tracks, assets, build };
}
