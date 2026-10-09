import { expect, test } from "bun:test";
import { buildFrameDescriptor } from "../compositor/frame-descriptor";
import { ColorNode } from "../nodes/color-node";
import { EffectLayerNode } from "../nodes/effect-layer-node";
import { IsolatedGroupNode } from "../nodes/isolated-group-node";
import { RootNode } from "../nodes/root-node";

const renderer = { width: 1920, height: 1080 };
const pass = { shader: "invert", uniforms: { amount: 1 } };
const group = (opacity = 1) =>
	new IsolatedGroupNode({
		effectPassGroups: [[pass]],
		opacity,
		blendMode: "normal",
	});
const color = (value: string) => new ColorNode({ color: value });

test("nested groups retain boundaries, effect layers and unique upload identities", async () => {
	const root = new RootNode({ duration: 120000 });
	const outer = group(0.5);
	const inner = group();
	const effect = new EffectLayerNode({
		effectType: "invert",
		effectParams: {},
		timeOffset: 0,
		duration: 120000,
	});
	effect.resolved = { passes: [pass] };
	root.add(color("blue")).add(outer).add(color("green"));
	outer.add(color("red")).add(inner).add(effect);
	inner.add(color("white"));
	const { frame, textures } = await buildFrameDescriptor({
		node: root,
		renderer,
	});
	expect(frame.items.map((item) => item.type)).toEqual([
		"layer",
		"group",
		"layer",
	]);
	const item = frame.items[1];
	if (item.type !== "group") throw Error("Missing group");
	expect(item.opacity).toBe(0.5);
	expect(item.effectPassGroups).toEqual([[pass]]);
	expect(item.items.map((child) => child.type)).toEqual([
		"layer",
		"group",
		"sceneEffect",
	]);
	expect(textures).toHaveLength(4);
	expect(new Set(textures.map((texture) => texture.id)).size).toBe(4);
	expect(textures.map((texture) => texture.id)).toEqual([
		"root:0:color",
		"root:1:group:0:color",
		"root:1:group:1:group:0:color",
		"root:2:color",
	]);
	// Group opacity must not be distributed onto children before their blend/post.
	expect(item.items[0].type === "layer" && item.items[0].opacity).toBe(1);
});

test("transparent and empty groups are transported without pruning child validation", async () => {
	const root = new RootNode({ duration: 120000 });
	root.add(group(0).add(color("red"))).add(group());
	const { frame, textures } = await buildFrameDescriptor({
		node: root,
		renderer,
	});
	expect(frame.items).toHaveLength(2);
	expect(textures).toHaveLength(1);
	expect(frame.items[0].type === "group" && frame.items[0].items).toHaveLength(
		1,
	);
	expect(frame.items[1].type === "group" && frame.items[1].items).toEqual([]);
});
