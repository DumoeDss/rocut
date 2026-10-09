import { expect, test } from "bun:test";
import { buildFrameDescriptor } from "../compositor/frame-descriptor";
import { ColorNode } from "../nodes/color-node";
import { EffectLayerNode } from "../nodes/effect-layer-node";
import { IsolatedGroupNode } from "../nodes/isolated-group-node";
import { SceneTransitionNode } from "../nodes/scene-transition-node";
import { RootNode } from "../nodes/root-node";

const renderer = { width: 64, height: 48 };
const pass = { shader: "invert", uniforms: { amount: 1 } };
const group = (opacity = 1) =>
	new IsolatedGroupNode({
		effectPassGroups: [[pass]],
		opacity,
		blendMode: "normal",
	});
const color = (value: string) => new ColorNode({ color: value });

test("scene transition transports whole branch trees and post without flattening", async () => {
	const effect = new EffectLayerNode({
		effectType: "invert",
		effectParams: {},
		timeOffset: 0,
		duration: 120000,
	});
	effect.resolved = { passes: [pass] };
	const shared = group(0.5).add(color("red")).add(effect);
	const nested = new SceneTransitionNode({ progress: 0.8 })
		.add(group().add(color("green")))
		.add(group().add(color("blue")));
	const transition = new SceneTransitionNode({ progress: 0.25 })
		.add(shared)
		.add(group().add(shared).add(nested));
	const root = new RootNode({ duration: 120000 })
		.add(color("black"))
		.add(transition);
	const { frame, textures } = await buildFrameDescriptor({
		node: root,
		renderer,
	});
	expect(frame.items.map((item) => item.type)).toEqual([
		"layer",
		"sceneTransition",
	]);
	const item = frame.items[1];
	if (item.type !== "sceneTransition") throw Error("Missing scene transition");
	expect(item.progress).toBe(0.25);
	expect(item.outgoing.opacity).toBe(0.5);
	expect(item.outgoing.effectPassGroups).toEqual([[pass]]);
	expect(item.outgoing.items.map((child) => child.type)).toEqual([
		"layer",
		"sceneEffect",
	]);
	expect(item.incoming.items.map((child) => child.type)).toEqual([
		"group",
		"sceneTransition",
	]);
	expect(item.outgoing).not.toHaveProperty("type");
	expect(textures).toHaveLength(5);
	expect(new Set(textures.map((texture) => texture.id)).size).toBe(5);
	expect(textures.map((texture) => texture.id)).toEqual([
		"root:0:color",
		"root:1:outgoing:group:0:color",
		"root:1:incoming:group:0:group:0:color",
		"root:1:incoming:group:1:outgoing:group:0:color",
		"root:1:incoming:group:1:incoming:group:0:color",
	]);
});

test("endpoints and zero opacity do not prune inactive scene branches", async () => {
	for (const progress of [0, 1]) {
		const node = new SceneTransitionNode({ progress })
			.add(group(0).add(color("red")))
			.add(group(0).add(color("blue")));
		const { frame, textures } = await buildFrameDescriptor({ node, renderer });
		expect(textures).toHaveLength(2);
		const item = frame.items[0];
		if (item.type !== "sceneTransition")
			throw Error("Missing scene transition");
		expect(item.outgoing.items).toHaveLength(1);
		expect(item.incoming.items).toHaveLength(1);
	}
});

test("scene transition refuses malformed renderer branch ownership", async () => {
	for (const children of [
		[],
		[group()],
		[group(), color("red")],
		[group(), group(), group()],
	]) {
		const node = new SceneTransitionNode({ progress: 0.5 });
		children.forEach((child) => node.add(child));
		await expect(buildFrameDescriptor({ node, renderer })).rejects.toThrow(
			"two isolated group children",
		);
	}
});
