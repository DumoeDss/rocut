import { expect, test } from "bun:test";
import { buildScene } from "../scene-builder";
import { ColorNode } from "../nodes/color-node";
import { EffectLayerNode } from "../nodes/effect-layer-node";
import { buildFrameDescriptor } from "../compositor/frame-descriptor";
import { resolveRenderTree } from "../resolve";
import { registerDefaultEffects } from "../../../effects/definitions";
import { projectFixture } from "../../../editor/transactions/opencut/__tests__/fixture";

test("master post follows the full scene and backdrop once, preserving enabled effect order", async () => {
	const project = projectFixture();
	const params = {
		exposure: 0.5,
		contrast: 0,
		saturation: 0,
		temperature: 0,
		tint: 0,
	};
	const effects = [
		{
			id: "first",
			type: "color-adjustment",
			enabled: true,
			params: { ...params },
		},
		{
			id: "disabled",
			type: "color-adjustment",
			enabled: false,
			params: { ...params, exposure: 1 },
		},
		{
			id: "last",
			type: "color-adjustment",
			enabled: true,
			params: { ...params, exposure: 0.25 },
		},
	];
	const scene = buildScene({
		tracks: project.scenes[0].tracks,
		mediaAssets: [],
		canvasSize: { width: 128, height: 128 },
		duration: 240000,
		background: { type: "color", color: "#123456" },
		masterEffects: effects,
		assetResolver: { resolve: ({ ref }) => ref.path },
	});
	expect(scene.children).toHaveLength(3);
	expect(scene.children[0]).toBeInstanceOf(ColorNode);
	const post = scene.children.slice(1);
	for (const node of post) {
		if (!(node instanceof EffectLayerNode)) throw Error("Missing master post");
		expect(node.params.timeOffset).toBe(0);
		expect(node.params.duration).toBe(240000);
	}
	effects[0].params.exposure = 1;
	registerDefaultEffects();
	await resolveRenderTree({
		node: scene,
		renderer: { width: 128, height: 128 },
		time: 120000,
		frameRate: { numerator: 30, denominator: 1 },
		videoCache: { getFrameAt: async () => null },
	});
	const { frame } = await buildFrameDescriptor({
		node: scene,
		renderer: { width: 128, height: 128 },
	});
	expect(frame.items.map((item) => item.type)).toEqual([
		"layer",
		"sceneEffect",
		"sceneEffect",
	]);
	expect(
		frame.items
			.slice(1)
			.map(
				(item) =>
					item.type === "sceneEffect" &&
					item.effectPassGroups[0][0].uniforms.exposure,
			),
	).toEqual([0.5, 0.25]);
});
