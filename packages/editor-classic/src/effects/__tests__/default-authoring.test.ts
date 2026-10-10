import { expect, test } from "bun:test";
import { validateClipEditingJson } from "opencut-wasm";
import {
	buildDefaultEffectInstance,
	effectsRegistry,
	registerDefaultEffects,
} from "../index";
import { buildEffectElement } from "../../timeline/element-utils";
import { mediaTime } from "../../wasm/media-time";

registerDefaultEffects();

function issues(editing: unknown, trackKind: string) {
	return JSON.parse(
		validateClipEditingJson(
			JSON.stringify({
				editing,
				duration: 240000,
				trackKind,
				hasMotionText: false,
				hasAdjustment: false,
				catalog: {
					elements: {},
					graphics: {},
					masks: {},
					effects: { bubble: effectsRegistry.get("bubble").params },
				},
			}),
		),
	);
}

test("default Bubble materializes only its active trajectory point and admits as a clip effect", () => {
	const effect = buildDefaultEffectInstance({ effectType: "bubble" });
	expect(effectsRegistry.get("bubble").params).toHaveLength(76);
	expect(Object.keys(effect.params)).toHaveLength(31);
	expect(effect.params.pointCount).toBe(1);
	for (const key of ["point0Time", "point0X", "point0Y"])
		expect(Object.hasOwn(effect.params, key)).toBe(true);
	for (let index = 1; index < 16; index++)
		for (const axis of ["Time", "X", "Y"])
			expect(Object.hasOwn(effect.params, `point${index}${axis}`)).toBe(false);
	expect(
		issues({ type: "text", params: {}, effects: [effect] }, "text"),
	).toEqual([]);
});

test("default standalone Bubble uses the same admissible factory output", () => {
	const layer = buildEffectElement({
		effectType: "bubble",
		startTime: mediaTime({ ticks: 0 }),
	});
	expect(Object.keys(layer.params)).toHaveLength(31);
	expect(
		issues(
			{ type: "effect", effectType: "bubble", params: layer.params },
			"effect",
		),
	).toEqual([]);
});

test("all 21 optical animation channels retain required static defaults", () => {
	const effect = buildDefaultEffectInstance({ effectType: "bubble" });
	const optical = effectsRegistry
		.get("bubble")
		.params.filter((param) => param.keyframable === true);
	expect(optical).toHaveLength(21);
	const animations = Object.fromEntries(
		optical.map((param) => {
			expect(effect.params[param.key]).toBe(param.default);
			return [
				`effects.${effect.id}.params.${param.key}`,
				{
					keys: [0, 120000].map((time, index) => ({
						id: `${param.key}-${index}`,
						time,
						value: param.default,
						segmentToNext: "linear",
						tangentMode: "auto",
					})),
				},
			];
		}),
	);
	expect(
		issues({ type: "text", params: {}, effects: [effect], animations }, "text"),
	).toEqual([]);
});

test("default omission follows catalog required:false without mutating definitions or other instances", () => {
	const definitions = effectsRegistry.getAll();
	for (const definition of definitions) {
		const before = structuredClone(definition.params);
		const expected = Object.fromEntries(
			definition.params
				.filter((param) => param.required !== false)
				.map((param) => [param.key, param.default]),
		);
		const first = buildDefaultEffectInstance({ effectType: definition.type });
		expect(first.params).toEqual(expected);
		first.params.__testMutation = 1;
		expect(
			buildDefaultEffectInstance({ effectType: definition.type }).params,
		).toEqual(expected);
		expect(definition.params).toEqual(before);
	}
});

test("empty thumbnail params reuse admissible authoring defaults before GPU dispatch", async () => {
	const { EffectPreviewService } =
		await import("../../services/renderer/effect-preview");
	const definition = effectsRegistry.get("bubble");
	const original = definition.renderer.buildPasses;
	const observed: unknown[] = [];
	const source = {} as OffscreenCanvas;
	const service = new EffectPreviewService({
		getTestSource: () => source,
	} as unknown as ConstructorParameters<typeof EffectPreviewService>[0]);
	Reflect.set(service, "applyGpuEffect", () => source);
	definition.renderer.buildPasses = (input) => {
		observed.push(input.effectParams);
		return [];
	};
	try {
		service.renderPreview({
			effectType: "bubble",
			params: {},
			targetCanvas: {
				getContext: () => ({ drawImage() {}, clearRect() {} }),
			} as unknown as HTMLCanvasElement,
		});
		expect(observed).toHaveLength(1);
		expect(observed[0]).toEqual(
			buildDefaultEffectInstance({ effectType: "bubble" }).params,
		);
		expect(
			issues(
				{ type: "effect", effectType: "bubble", params: observed[0] },
				"effect",
			),
		).toEqual([]);
	} finally {
		definition.renderer.buildPasses = original;
	}
});
