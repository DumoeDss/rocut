import { expect, test } from "bun:test";
import {
	effectsRegistry,
	registerDefaultEffects,
	resolveEffectPasses,
} from "../index";
import { resolveEffectPassGroups } from "../../services/renderer/resolve-visual-state";
import { mediaTime } from "../../wasm/media-time";
import { EffectLayerNode } from "../../services/renderer/nodes/effect-layer-node";
import { resolveRenderTree } from "../../services/renderer/resolve";
import type { ParamValues } from "../../params";

registerDefaultEffects();
const frameRate = { numerator: 24000, denominator: 1001 };
const resolve = ({
	type,
	localTime,
	params = {},
}: {
	type: string;
	localTime: number;
	params?: ParamValues;
}) =>
	resolveEffectPasses({
		definition: effectsRegistry.get(type),
		effectParams: params,
		width: 64,
		height: 32,
		frame: { localTime, frameRate },
	});

test("native catalog comes from Rust, resolves defaults and requires explicit time", () => {
	for (const type of [
		"vhs",
		"glitch",
		"retro-dither",
		"ascii",
		"mono-dither",
	]) {
		const definition = effectsRegistry.get(type);
		expect(definition.params).toHaveLength(
			["ascii", "retro-dither"].includes(type) ? 10 : 5,
		);
		expect(definition.params.find((p) => p.key === "seed")?.keyframable).toBe(
			false,
		);
		expect(resolve({ type, localTime: 75075 })[0].shader).toBe(type);
		expect(resolve({ type, localTime: 75075, params: { amount: 0 } })).toEqual(
			[],
		);
		expect(() =>
			resolveEffectPasses({
				definition,
				effectParams: {},
				width: 64,
				height: 32,
			}),
		).toThrow("explicit effect frame");
	}
	expect(resolve({ type: "vhs", localTime: 75075 })[0].uniforms.frame).toBe(15);
	expect(resolve({ type: "glitch", localTime: -1 })[0].uniforms.frame).toBe(
		16777215,
	);
	expect(
		resolve({ type: "retro-dither", localTime: 75075 })[0].uniforms.frame,
	).toBe(0);
	expect(resolve({ type: "ascii", localTime: -1 })[0].uniforms.frame).toBe(0);
	expect(resolve({ type: "mono-dither", localTime: -1 })[0].uniforms).toEqual({
		amount: 1,
		threshold: 0.5,
		cellSize: 2,
		spread: 1,
		seed: 1,
		frame: 0,
	});
	expect(
		resolve({
			type: "ascii",
			localTime: 0,
			params: { cellSize: 2, contrast: -9, color: 2 },
		})[0].uniforms,
	).toMatchObject({ cellSize: 6, contrast: -2, color: 1 });
});

test("visual effect groups propagate rate, time, order and enabled flags", () => {
	const groups = resolveEffectPassGroups({
		effects: [
			{
				id: "a",
				type: "glitch",
				params: { amount: 0.8, seed: 42 },
				enabled: true,
			},
			{ id: "b", type: "vhs", params: {}, enabled: false },
			{ id: "c", type: "retro-dither", params: {}, enabled: true },
		],
		animations: undefined,
		localTime: 75075,
		frameRate,
		width: 64,
		height: 32,
	});
	expect(groups.map((g) => g[0].shader)).toEqual(["glitch", "retro-dither"]);
	expect(groups[0][0].uniforms).toMatchObject({
		frame: 15,
		seed: 42,
		amount: 0.8,
	});
});

test("invalid author parameters fail instead of disappearing during adaptation", () => {
	for (const params of [{ amount: "1" }, { seed: Infinity }, { typo: 2 }])
		expect(() => resolve({ type: "vhs", localTime: 0, params })).toThrow();
	expect(() => resolve({ type: "vhs", localTime: 0.5 })).toThrow();
});

test("zero-strength passes never reach the compositor as an empty group", () => {
	expect(
		resolveEffectPassGroups({
			effects: [{ id: "a", type: "vhs", params: { amount: 0 }, enabled: true }],
			animations: undefined,
			localTime: 0,
			frameRate,
			width: 64,
			height: 32,
		}),
	).toEqual([]);
});

test("keyframed amount is evaluated before Rust normalizes the effect pass", () => {
	const resolveAt = (localTime: number) =>
		resolveEffectPassGroups({
			effects: [{ id: "a", type: "vhs", enabled: true, params: { amount: 1 } }],
			animations: {
				"effects.a.params.amount": {
					keys: [
						{
							id: "start",
							time: mediaTime({ ticks: 0 }),
							value: 0,
							segmentToNext: "linear",
							tangentMode: "auto",
						},
						{
							id: "end",
							time: mediaTime({ ticks: 120000 }),
							value: 1,
							segmentToNext: "linear",
							tangentMode: "auto",
						},
					],
				},
			},
			localTime,
			frameRate,
			width: 64,
			height: 32,
		});
	expect(resolveAt(0)).toEqual([]);
	expect(resolveAt(60000)[0][0].uniforms.amount).toBeCloseTo(0.5);
	expect(resolveAt(120000)[0][0].uniforms.amount).toBe(1);
});

test("scene effects use clip-local time and exclude the exact end boundary", async () => {
	const node = new EffectLayerNode({
		effectType: "vhs",
		effectParams: {},
		timeOffset: 12000,
		duration: 100100,
	});
	const at = async (time: number) => {
		await resolveRenderTree({
			node,
			renderer: { width: 64, height: 32 },
			time,
			frameRate,
			videoCache: { getFrameAt: async () => null },
		});
		return node.resolved;
	};
	expect(await at(11999)).toBeNull();
	expect((await at(87075))?.passes[0].uniforms.frame).toBe(15);
	expect((await at(12000))?.passes[0].uniforms.frame).toBe(0);
	expect(await at(112100)).toBeNull();
});
