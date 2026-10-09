import { resolveStylizedEffectJson } from "opencut-wasm";
import type { EffectPass } from "../../packages/editor-classic/src/effects/types";
import type {
	FrameDescriptor,
	FrameLayerDescriptor,
} from "../../packages/editor-classic/src/services/renderer/compositor/types";
import {
	liquidParameters,
	liquidRate,
	liquidSource,
} from "./liquid-browser-cases";

export const cancellationSize = { width: 96, height: 64 };
export const cancellationPlacements = [
	"layer",
	"outgoing",
	"incoming",
	"scene",
	"multiple",
] as const;
export type CancellationPlacement = (typeof cancellationPlacements)[number];

export function cancellationTexture() {
	const { width, height } = cancellationSize;
	const canvas = new OffscreenCanvas(width, height);
	canvas
		.getContext("2d")!
		.putImageData(
			new ImageData(liquidSource(width, height), width, height),
			0,
			0,
		);
	return { id: "liquid-cancellation-source", source: canvas, width, height };
}

export function cancellationFrame(
	placement: CancellationPlacement,
	active = true,
): FrameDescriptor {
	const result = JSON.parse(
		resolveStylizedEffectJson(
			JSON.stringify({
				effectType: "liquid",
				params: liquidParameters(),
				localTime: 26500,
				frameRate: liquidRate,
			}),
		),
	) as { passes: EffectPass[]; error?: string };
	if (result.error) throw new Error(result.error);
	const passes = active ? [result.passes] : [];
	const base: FrameLayerDescriptor = {
		type: "layer",
		textureId: "liquid-cancellation-source",
		transform: {
			centerX: 48,
			centerY: 32,
			...cancellationSize,
			rotationDegrees: 0,
			flipX: false,
			flipY: false,
		},
		opacity: 1,
		blendMode: "normal",
		effectPassGroups: [],
		mask: null,
	};
	const effected = { ...base, effectPassGroups: passes };
	const frame: FrameDescriptor = {
		...cancellationSize,
		clear: { color: [0, 0, 0, 1] },
		items: [],
	};
	if (placement === "layer") frame.items = [effected];
	else if (placement === "scene")
		frame.items = [base, { type: "sceneEffect", effectPassGroups: passes }];
	else {
		frame.items = [
			{
				type: "transition",
				outgoing: [placement === "incoming" ? base : effected],
				incoming: [placement === "outgoing" ? base : effected],
				progress: 0.5,
			},
		];
		if (placement === "multiple")
			frame.items.push({ type: "sceneEffect", effectPassGroups: passes });
	}
	return frame;
}

export function cancellationPixels(canvas: HTMLCanvasElement) {
	const copy = new OffscreenCanvas(canvas.width, canvas.height);
	const context = copy.getContext("2d")!;
	context.drawImage(canvas, 0, 0);
	return context.getImageData(0, 0, copy.width, copy.height).data;
}

export function samePixels(a: Uint8ClampedArray, b: Uint8ClampedArray) {
	return a.length === b.length && a.every((value, index) => value === b[index]);
}
