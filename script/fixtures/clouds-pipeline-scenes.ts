import type { ElementAnimations } from "../../packages/editor-classic/src/animation/types";
import { ColorNode } from "../../packages/editor-classic/src/services/renderer/nodes/color-node";
import { EffectLayerNode } from "../../packages/editor-classic/src/services/renderer/nodes/effect-layer-node";
import { ImageNode } from "../../packages/editor-classic/src/services/renderer/nodes/image-node";
import { RootNode } from "../../packages/editor-classic/src/services/renderer/nodes/root-node";
import { mediaTime } from "../../packages/editor-classic/src/wasm/media-time";
import {
	pipelineSource,
	type PipelineSourceKind,
} from "./clouds-pipeline-source";
import {
	pipelineSize,
	pipelineDuration,
	pipelineOffset,
	pipelineTrim,
	pipelineParams,
	pipelineExpected,
	pipelineAnimated,
} from "./clouds-pipeline-cases";
import type { PipelineChannel } from "./clouds-pipeline-cases";
import { check, pixels } from "./clouds-pipeline-support";

export type Placement = "attached" | "effect-layer";
const animations: ElementAnimations = Object.fromEntries(
	Object.entries(pipelineAnimated).map(([key, values]) => [
		`effects.cloud.params.${key}`,
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

export function cloudsScene({
	placement,
	kind,
	animated = false,
	onlyChannel,
	black = false,
	offset = pipelineOffset,
	trimmed = true,
}: {
	placement: Placement;
	kind: PipelineSourceKind;
	animated?: boolean;
	onlyChannel?: PipelineChannel;
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
	check(context, "Missing Clouds source context");
	context.putImageData(
		new ImageData(
			pipelineSource(canvas.width, canvas.height, kind),
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
									id: "cloud",
									type: "clouds",
									enabled: true,
									params: { ...pipelineParams },
								},
							],
							...(animated
								? {
										animations: onlyChannel
											? Object.fromEntries(
													Object.entries(animations).filter(
														([key]) =>
															key === `effects.cloud.params.${onlyChannel}`,
													),
												)
											: animations,
									}
								: {}),
						}
					: {}),
			}),
		);
		if (placement === "effect-layer" && active)
			root.add(
				new EffectLayerNode({
					effectType: "clouds",
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
		onlyChannel,
		black,
		offset,
		source,
		trimmed,
	};
}

export type CloudsScene = ReturnType<typeof cloudsScene>;

export function expectedAt(scene: CloudsScene, time: number) {
	return pipelineExpected(
		scene.source,
		scene.placement,
		time - scene.offset,
		scene.animated,
		scene.onlyChannel,
	);
}
