import { expect, test } from "bun:test";
import { validateClipEditingJson } from "opencut-wasm";
import {
	buildDefaultEffectInstance,
	effectsRegistry,
	registerDefaultEffects,
} from "../index";
import {
	appendBubblePoint,
	removeBubblePoint,
} from "../components/bubble-trajectory-edit";
import { saveEffectPreview } from "../components/effect-save-feedback";
import {
	buildEffectParamPath,
	buildGraphicParamPath,
	resolveAnimationPathValueAtTime,
	upsertPathKeyframe,
} from "../../animation";
import { mediaTime } from "../../wasm";
import { coerceParamValue, getParamChannelLayout } from "../../params";

registerDefaultEffects();

test("point additions and removals produce complete atomic Bubble params admitted by Rust", () => {
	const definitions = effectsRegistry.get("bubble").params;
	const admits = (params: typeof original) =>
		expect(
			JSON.parse(
				validateClipEditingJson(
					JSON.stringify({
						editing: { type: "effect", effectType: "bubble", params },
						duration: 240000,
						trackKind: "effect",
						hasMotionText: false,
						hasAdjustment: false,
						catalog: {
							elements: {},
							graphics: {},
							masks: {},
							effects: { bubble: definitions },
						},
					}),
				),
			),
		).toEqual([]);
	let params = buildDefaultEffectInstance({ effectType: "bubble" }).params;
	const original = structuredClone(params);
	for (let count = 2; count <= 16; count++) {
		const before = structuredClone(params);
		const next = appendBubblePoint({ params, definitions });
		expect(params).toEqual(before);
		expect(next.pointCount).toBe(count);
		expect(Object.keys(next)).toHaveLength(28 + count * 3);
		params = next;
		admits(params);
	}
	for (let count = 16; count > 1; count--) {
		const next = removeBubblePoint({ params, index: count - 1 });
		expect(next.pointCount).toBe(count - 1);
		expect(Object.hasOwn(next, `point${count - 1}Time`)).toBe(false);
		params = next;
		admits(params);
	}
	expect(params).toEqual(original);
	const editing = { type: "effect", effectType: "bubble", params };
	expect(
		JSON.parse(
			validateClipEditingJson(
				JSON.stringify({
					editing,
					duration: 240000,
					trackKind: "effect",
					hasMotionText: false,
					hasAdjustment: false,
					catalog: {
						elements: {},
						graphics: {},
						masks: {},
						effects: { bubble: definitions },
					},
				}),
			),
		),
	).toEqual([]);
});

test("removing an interior trajectory point compacts complete slots without altering optical values", () => {
	const definitions = effectsRegistry.get("bubble").params;
	const initial = buildDefaultEffectInstance({ effectType: "bubble" }).params;
	const two = appendBubblePoint({ params: initial, definitions });
	const three = appendBubblePoint({ params: two, definitions });
	const compacted = removeBubblePoint({ params: three, index: 1 });
	for (const axis of ["Time", "X", "Y"])
		expect(compacted[`point1${axis}`]).toBe(three[`point2${axis}`]);
	expect(compacted.refraction).toBe(three.refraction);
	expect(Object.hasOwn(compacted, "point2X")).toBe(false);
});

test("save feedback awaits rejection then discards preview, with success preserving it", async () => {
	const order: string[] = [];
	const error = await saveEffectPreview({
		commit: async () => {
			order.push("commit");
			await Promise.resolve();
			order.push("rejected");
			return false;
		},
		discard: () => {
			order.push("discard");
		},
	});
	expect(order).toEqual(["commit", "rejected", "discard"]);
	expect(error).toContain("not saved");
	expect(
		await saveEffectPreview({
			commit: async () => true,
			discard: () => {
				throw new Error("unexpected discard");
			},
		}),
	).toBe("");
	expect(
		await saveEffectPreview({
			commit: async () => {
				throw new Error("rejected transaction");
			},
			discard: () => {},
		}),
	).toContain("Previous values restored");
});

test("effect UI uses existing clip-local animation paths and retains static fallbacks", () => {
	const params = buildDefaultEffectInstance({ effectType: "bubble" }).params;
	const param = effectsRegistry
		.get("bubble")
		.params.find((item) => item.key === "refraction")!;
	for (const propertyPath of [
		buildEffectParamPath({ effectId: "bubble-id", paramKey: "refraction" }),
		buildGraphicParamPath({ paramKey: "refraction" }),
	]) {
		const animations = upsertPathKeyframe({
			animations: undefined,
			propertyPath,
			time: mediaTime({ ticks: 12000 }),
			value: 0.1,
			channelLayout: getParamChannelLayout({ param }),
			coerceValue: ({ value }) => coerceParamValue({ param, value }),
		});
		expect(
			resolveAnimationPathValueAtTime({
				animations,
				propertyPath,
				localTime: mediaTime({ ticks: 12000 }),
				fallbackValue: params.refraction,
			}),
		).toBe(0.1);
		expect(params).toEqual(
			buildDefaultEffectInstance({ effectType: "bubble" }).params,
		);
	}
});
