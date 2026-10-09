import type { ElementAnimations } from "../../packages/editor-classic/src/animation/types";
import { ColorNode } from "../../packages/editor-classic/src/services/renderer/nodes/color-node";
import { EffectLayerNode } from "../../packages/editor-classic/src/services/renderer/nodes/effect-layer-node";
import { ImageNode } from "../../packages/editor-classic/src/services/renderer/nodes/image-node";
import { RootNode } from "../../packages/editor-classic/src/services/renderer/nodes/root-node";
import { mediaTime } from "../../packages/editor-classic/src/wasm/media-time";
import { dropletsSource, type DropletsSourceKind } from "./droplets-cases";
import {
	pipelineSize,
	pipelineDuration,
	pipelineOffset,
	pipelineTrim,
	pipelineParams,
	pipelineExpected,
	pipelineOptical,
} from "./droplets-pipeline-cases";
import { check, pixels } from "./droplets-pipeline-support";

export type Placement = "attached" | "effect-layer";
const animations: ElementAnimations = Object.fromEntries(
	Object.entries(pipelineOptical).map(([key, values]) => [
		`effects.water.params.${key}`,
		{
			keys: values.map((value, index) => ({
				id: `${key}-${index}`,
				time: mediaTime({ ticks: index ? 68000 : 48000 }),
				value,
				segmentToNext: "linear",
				tangentMode: "auto",
			})),
		},
	]),
);

export function dropletsScene({
	placement,
	kind,
	animated = false,
	black = false,
	offset = pipelineOffset,
	trimmed = true,
}: {
	placement: Placement;
	kind: DropletsSourceKind;
	animated?: boolean;
	black?: boolean;
	offset?: number;
	trimmed?: boolean;
}) {
	check(
		!animated || placement === "attached",
		"Effect layers do not support animation",
	);
	const canvas = document.createElement("canvas");
	Object.assign(canvas, pipelineSize);
	const context = canvas.getContext("2d");
	check(context, "Missing Droplets source context");
	context.putImageData(
		new ImageData(
			dropletsSource(canvas.width, canvas.height, kind),
			canvas.width,
			canvas.height,
		),
		0,
		0,
	);
	// Read back legal canvas alpha/RGB quantization before using the independent oracle.
	const source = pixels(canvas);
	const url = canvas.toDataURL("image/png");
	const build = (active: boolean) => {
		const root = new RootNode({ duration: 180000 });
		if (black) root.add(new ColorNode({ color: "#000000" }));
		root.add(
			new ImageNode({
				url,
				duration: placement === "attached" ? pipelineDuration : 180000,
				timeOffset: placement === "attached" ? offset : 0,
				...(trimmed ? pipelineTrim : { trimStart: 0, trimEnd: 0 }),
				transform: {
					position: { x: 0, y: 0 },
					scaleX: 1,
					scaleY: 1,
					rotate: 0,
				},
				opacity: 1,
				blendMode: "normal",
				...(placement === "attached" && active
					? {
							effects: [
								{
									id: "water",
									type: "droplets",
									enabled: true,
									params: { ...pipelineParams },
								},
							],
							...(animated ? { animations } : {}),
						}
					: {}),
			}),
		);
		if (placement === "effect-layer" && active)
			root.add(
				new EffectLayerNode({
					effectType: "droplets",
					effectParams: { ...pipelineParams },
					timeOffset: offset,
					duration: pipelineDuration,
				}),
			);
		return root;
	};
	return {
		node: build(true),
		baselineNode: build(false),
		placement,
		kind,
		animated,
		black,
		offset,
		source,
		trimmed,
	};
}

export type DropletsScene = ReturnType<typeof dropletsScene>;

export function expectedAt(scene: DropletsScene, time: number) {
	return pipelineExpected(
		scene.source,
		scene.placement,
		time - scene.offset,
		scene.animated,
	);
}
