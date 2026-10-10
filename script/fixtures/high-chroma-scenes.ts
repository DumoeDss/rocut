import { CanvasRenderer } from "../../packages/editor-classic/src/services/renderer/canvas-renderer";
import { ColorNode } from "../../packages/editor-classic/src/services/renderer/nodes/color-node";
import { ImageNode } from "../../packages/editor-classic/src/services/renderer/nodes/image-node";
import { RootNode } from "../../packages/editor-classic/src/services/renderer/nodes/root-node";
import { dropletsDifference } from "./droplets-oracle";
import { dropletsScene, expectedAt } from "./droplets-pipeline-scenes";
import {
	base64,
	check,
	createDropletsPipeline,
	same,
} from "./droplets-pipeline-support";
import {
	highChromaContract,
	type HighChromaCaseId,
} from "./high-chroma-contract";
import {
	dropletsHighChromaReference,
	largerHighChromaReference,
} from "./high-chroma-reference";

export function createHighChromaPipeline(caseId: HighChromaCaseId) {
	const spec =
		caseId === highChromaContract.droplets.id
			? highChromaContract.droplets
			: highChromaContract.larger;
	const base = createDropletsPipeline();
	const params = {
		width: spec.width,
		height: spec.height,
		fps: { numerator: spec.fps, denominator: 1 },
		compositor: base.compositor,
		videoCache: base.videoCache,
	};
	return { ...base, ...params, renderer: new CanvasRenderer(params) };
}

export type HighChromaPipeline = ReturnType<typeof createHighChromaPipeline>;

export function highChromaPixels(
	source: CanvasImageSource,
	width: number,
	height: number,
) {
	const canvas = new OffscreenCanvas(width, height);
	const context = canvas.getContext("2d", { willReadFrequently: true });
	check(context, "Missing high-chroma readback context");
	context.drawImage(source, 0, 0);
	return context.getImageData(0, 0, width, height).data;
}

export async function prepareHighChromaScene(
	caseId: HighChromaCaseId,
	pipeline: HighChromaPipeline,
) {
	if (caseId === highChromaContract.droplets.id) {
		const reference = dropletsHighChromaReference();
		const scene = dropletsScene({
			placement: "attached",
			kind: "opaque",
			animated: true,
			black: true,
		});
		check(
			same(scene.source, reference.source),
			"Original Droplets source changed",
		);
		const referenceChecks = [];
		const captures: Uint8ClampedArray[] = [];
		for (const [index, time] of reference.timelineTicks.entries()) {
			const captured = await pipeline.renderer.renderAndCapture({
				node: scene.node,
				time,
				capture: (canvas) =>
					highChromaPixels(canvas, reference.width, reference.height),
			});
			const oracle = expectedAt(scene, time);
			check(
				same(oracle.pixels, reference.expected[index]),
				"Independent frozen oracle changed",
			);
			const difference = dropletsDifference(
				captured,
				oracle,
				reference.baseline,
			);
			check(
				!difference.failed && !difference.outsideFailed,
				"Production capture differs from the original optical oracle",
			);
			captures.push(captured);
			referenceChecks.push({ index, difference });
		}
		const reset = await pipeline.renderer.renderAndCapture({
			node: scene.baselineNode,
			time: reference.timelineTicks[0],
			capture: (canvas) =>
				highChromaPixels(canvas, reference.width, reference.height),
		});
		check(same(reset, reference.baseline), "Original baseline reset failed");
		return {
			...reference,
			rootNode: scene.node,
			reference:
				"Original frozen independent Droplets optical/time oracle over black; never derived from production capture",
			referenceChecks,
			captureEvidence: {
				source: base64([scene.source]),
				frames: base64(captures),
				stage:
					"production reference capture before export; not encoder interception",
			},
		};
	}
	const reference = largerHighChromaReference();
	const rootNode = new RootNode({
		duration: reference.frames * reference.frameTicks,
	});
	rootNode.add(new ColorNode({ color: "#000000" }));
	for (const [index, frame] of reference.expected.entries()) {
		const canvas = document.createElement("canvas");
		Object.assign(canvas, { width: reference.width, height: reference.height });
		const context = canvas.getContext("2d");
		check(context, "Missing larger-case source context");
		context.putImageData(
			new ImageData(frame, reference.width, reference.height),
			0,
			0,
		);
		rootNode.add(
			new ImageNode({
				url: canvas.toDataURL("image/png"),
				timeOffset: reference.timelineTicks[index],
				duration: reference.frameTicks,
				trimStart: 0,
				trimEnd: 0,
				transform: {
					position: { x: 0, y: 0 },
					scaleX: 1,
					scaleY: 1,
					rotate: 0,
				},
				opacity: 1,
				blendMode: "normal",
			}),
		);
	}
	return {
		...reference,
		rootNode,
		reference:
			"Six independently specified solid RGB images at exact 24fps interval boundaries; black baseline",
		referenceChecks: [],
		captureEvidence: null,
	};
}
