/* eslint-disable @typescript-eslint/no-unsafe-type-assertion -- CPU transport seams deliberately provide no media/Host resources and inject hostile DTOs. */
import { expect, mock, test } from "bun:test";
import * as installedCpuApi from "../../../../../../rust/wasm/pkg/opencut_wasm_sync.js";
import type { EffectElement } from "../../../timeline/types";
import type { ElementAnimations } from "../../../animation/types";

// Only the NEW native sampler is a transport seam. No interpolation is simulated.
const requests: Record<string, unknown>[] = [];
let result = JSON.stringify({ version: 1, params: { amount: 0.375 } });
mock.module("opencut-wasm", () => ({
	...installedCpuApi,
	resolveEffectLayerParamsJson: (raw: string) => {
		requests.push(JSON.parse(raw));
		return result;
	},
}));
const { resolveAnimationTarget } =
	await import("../../../timeline/animation-targets");
const { effectsRegistry, registerDefaultEffects } =
	await import("../../../effects");
const { resolveEffectLayerParams } =
	await import("../../../wasm/effect-layer-animation");
const { buildScene } = await import("../scene-builder");
const { resolveRenderTree } = await import("../resolve");
const { EffectLayerNode } = await import("../nodes/effect-layer-node");
registerDefaultEffects();
// Existing built catalog is evidence for descriptor wiring, not the unbuilt new API.
const catalogEffect = effectsRegistry
	.getAll()
	.find((definition) =>
		definition.params.some(
			(param) =>
				param.key === "amount" &&
				param.type === "number" &&
				param.keyframable !== false,
		),
	)!;

const animations: ElementAnimations = {
	"params.amount": {
		keys: [
			{
				id: "b",
				time: 200 as never,
				value: 0.8,
				segmentToNext: "bezier",
				tangentMode: "broken",
				leftHandle: { dt: -15 as never, dv: -0.2 },
			},
			{
				id: "a",
				time: 0 as never,
				value: 0.2,
				segmentToNext: "linear",
				tangentMode: "auto",
			},
		],
		extrapolation: { before: "linear", after: "hold" },
	},
};
const element = {
	id: "effect-clip",
	name: "Standalone",
	type: "effect",
	effectType: catalogEffect.type,
	startTime: 1000,
	duration: 10000,
	trimStart: 321,
	trimEnd: 0,
	params: { amount: 0 },
	animations,
} as unknown as EffectElement;

test("standalone numeric descriptor uses actual effect catalog and preserves static map", () => {
	const definition = effectsRegistry.get(element.effectType);
	for (const param of definition.params) {
		const descriptor = resolveAnimationTarget({
			element,
			path: `params.${param.key}`,
		});
		expect(Boolean(descriptor)).toBe(
			param.type === "number" && param.keyframable !== false,
		);
	}
	const descriptor = resolveAnimationTarget({ element, path: "params.amount" });
	expect(descriptor).not.toBeNull();
	expect(descriptor!.getBaseValue()).toBe(0);
	const updated = descriptor!.setBaseValue({ value: 0.5 });
	expect(updated.params.amount).toBe(0.5);
	expect(element.params.amount).toBe(0);
	expect(updated.animations).toBe(animations);
	expect(
		resolveAnimationTarget({ element, path: "params.unknown" }),
	).toBeNull();
	expect(
		resolveAnimationTarget({ element, path: "effects.fake.params.amount" }),
	).toBeNull();
	expect(
		resolveAnimationTarget({
			element: { ...element, effectType: "color-adjustment" },
			path: "params.exposure",
		}),
	).toBeNull();
});

test("transport preserves full legacy DTO without sorting, defaulting or sampling", () => {
	let captured = "";
	const request = {
		effectType: "bubble",
		params: { amount: 0, seed: 12 },
		animations,
		localTicks: 73.125,
	};
	const params = resolveEffectLayerParams({
		request,
		core: (raw) => {
			captured = raw;
			return JSON.stringify({
				version: 1,
				params: { amount: 0.375, seed: 12 },
			});
		},
	});
	expect(JSON.parse(captured)).toEqual({ version: 1, ...request });
	expect(params).toEqual({ amount: 0.375, seed: 12 });
	expect(animations["params.amount"]).toEqual(
		request.animations["params.amount"],
	);
});

test("native rejection and malformed output are fatal, never a static fallback", () => {
	const request = {
		effectType: "bubble",
		params: { amount: 0 },
		animations,
		localTicks: 1,
	};
	expect(() =>
		resolveEffectLayerParams({
			request,
			core: () =>
				JSON.stringify({
					version: 1,
					error: { path: "params.amount", message: "invalid schedule" },
				}),
		}),
	).toThrow("params.amount: invalid schedule");
	for (const raw of [
		"null",
		"{}",
		"{",
		JSON.stringify({ version: 2, params: {} }),
		JSON.stringify({ version: 1, params: { amount: null } }),
		JSON.stringify({ version: 1, error: "bad" }),
	]) {
		expect(() =>
			resolveEffectLayerParams({ request, core: () => raw }),
		).toThrow();
	}
});

test("actual scene builder carries standalone animations into effect node", () => {
	const root = buildScene({
		canvasSize: { width: 64, height: 32 },
		duration: 20000 as never,
		background: { type: "color", color: "transparent" },
		mediaAssets: [],
		assetResolver: {} as never,
		tracks: {
			main: {
				id: "main",
				name: "main",
				type: "video",
				elements: [],
				hidden: false,
				muted: false,
			},
			overlay: [
				{
					id: "fx",
					name: "fx",
					type: "effect",
					elements: [element],
					hidden: false,
				},
			],
			audio: [],
		},
	});
	const nodes = root.children.flatMap((node) => [node, ...node.children]);
	const effect = nodes.find(
		(node) => node instanceof EffectLayerNode,
	) as InstanceType<typeof EffectLayerNode>;
	expect(effect).toBeDefined();
	expect(effect.params.animations).toBe(animations);
	expect(effect.params.effectParams).toBe(element.params);
});

test("actual resolver passes clip-local ticks and uses native params before pass generation", async () => {
	let seen: unknown;
	effectsRegistry.register({
		key: "test-effect-layer-seam",
		definition: {
			type: "test-effect-layer-seam",
			name: "Transport seam",
			keywords: [],
			params: [],
			renderer: {
				passes: [],
				buildPasses: (input) => {
					seen = input;
					return [
						{
							shader: "invert",
							uniforms: { amount: input.effectParams.amount as number },
						},
					];
				},
			},
		},
	});
	const node = new EffectLayerNode({
		effectType: "test-effect-layer-seam",
		effectParams: { amount: 0 },
		animations,
		timeOffset: 1000,
		duration: 10000,
	});
	const resolve = (time: number) =>
		resolveRenderTree({
			node,
			time,
			renderer: { width: 64, height: 32 },
			frameRate: { numerator: 30, denominator: 1 },
			videoCache: {} as never,
		});
	requests.length = 0;
	result = JSON.stringify({ version: 1, params: { amount: 0.375 } });
	await resolve(1073.125);
	expect(requests).toEqual([
		{
			version: 1,
			effectType: "test-effect-layer-seam",
			params: { amount: 0 },
			animations,
			localTicks: 73.125,
		},
	]);
	expect(seen).toMatchObject({
		effectParams: { amount: 0.375 },
		frame: { localTime: 73.125 },
	});
	expect(node.resolved?.passes[0].uniforms.amount).toBe(0.375);
	result = JSON.stringify({
		version: 1,
		error: { path: "animations", message: "bad keys" },
	});
	await expect(resolve(1074)).rejects.toThrow("animations: bad keys");
	requests.length = 0;
	await resolve(999);
	await resolve(11000);
	expect(requests).toHaveLength(0);
	const staticNode = new EffectLayerNode({
		effectType: "test-effect-layer-seam",
		effectParams: { amount: 0.2 },
		animations: {},
		timeOffset: 0,
		duration: 10,
	});
	await resolveRenderTree({
		node: staticNode,
		time: 1,
		renderer: { width: 64, height: 32 },
		videoCache: {} as never,
	});
	expect(requests).toHaveLength(0);
	expect(staticNode.resolved?.passes[0].uniforms.amount).toBe(0.2);
});
