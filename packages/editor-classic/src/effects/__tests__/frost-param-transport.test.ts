import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { transformSync } from "esbuild";
import * as paramsApi from "../../params";
import * as animationApi from "../../animation";
import { upsertPathKeyframe } from "../../animation/keyframes";
import type {
	ElementAnimations,
	ScalarAnimationKey,
	AnimationPath,
} from "../../animation/types";
import type { ParamValue, ParamValues } from "../../params";
import type { AnimationPathDescriptor } from "../../timeline/animation-targets";
import { mediaTime } from "../../wasm/media-time";
import { frostTypedValue } from "../components/frost-stroke-edit";

// Local VM observations, not DOM or mock.module. Existing time helpers are
// used by real TS scalar transport; this is not new Frost native evidence.
interface Props {
	value: ParamValue;
	onFocus: () => void;
	onChange: (event: { target: { value: string } }) => void;
	onBlur: (event: { target: { value: string } }) => void;
	onPreview: (value: ParamValue) => void;
	beforeLabel?: NodeObservation;
	children?: NodeObservation | NodeObservation[];
}
interface NodeObservation {
	type: unknown;
	props: Props;
}
interface ElementObservation {
	type: string;
	effectType?: string;
	params: ParamValues;
	id?: string;
	effects?: { id: string; type: string; params: ParamValues }[];
	animations?: ElementAnimations;
}
interface FieldInput {
	param: typeof param;
	value: ParamValue;
	onPreview: (value: ParamValue) => void;
	onCommit: () => void;
	keyframe: { isActive: boolean; isDisabled: boolean; onToggle: () => void };
}
interface EffectInput {
	param: typeof param;
	effect: { id: string; type: string };
	element: ElementObservation;
	trackId: string;
	params: ParamValues;
	preview: (params: ParamValues) => void;
	commit: () => void;
	reportError: () => void;
	hasUnsavedDraft: boolean;
	prepareAnimated: () => void;
	rememberAnimated: () => void;
}
const param = {
	key: "amount",
	label: "Amount",
	type: "number" as const,
	min: 0,
	max: 1,
	step: 0.01,
	default: 1,
	keyframable: true,
};
function load<T>({
	relative,
	dependencies,
}: {
	relative: string;
	dependencies: Record<string, unknown>;
}): T {
	const source = readFileSync(new URL(relative, import.meta.url), "utf8");
	const { code } = transformSync(source, {
		loader: relative.endsWith("tsx") ? "tsx" : "ts",
		format: "cjs",
		jsx: "automatic",
		target: "es2022",
	});
	const module: { exports: unknown } = { exports: {} };
	runInNewContext(code, {
		module,
		exports: module.exports,
		require: (id: string) => {
			if (!(id in dependencies))
				throw new Error("Unobserved dependency: " + id);
			return dependencies[id];
		},
	});
	// Sole dynamic module boundary: actual exports are exercised by each test.
	// eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
	return module.exports as T;
}
const jsx = {
	// JSX runtime ABI is positional; test helper APIs use object parameters.
	// eslint-disable-next-line opencut/prefer-object-params
	jsx: (type: unknown, props: unknown) => ({ type, props }),
	// eslint-disable-next-line opencut/prefer-object-params
	jsxs: (type: unknown, props: unknown) => ({ type, props }),
};
function stateObservation() {
	const states: unknown[] = [];
	let cursor = 0;
	return {
		begin: () => {
			cursor = 0;
		},
		react: {
			useState: (initial: unknown) => {
				const index = cursor++;
				if (!(index in states)) states[index] = initial;
				return [
					states[index],
					(value: unknown) => {
						states[index] = value;
					},
				];
			},
		},
	};
}
function find({
	node,
	type,
}: {
	node: NodeObservation;
	type: unknown;
}): NodeObservation | undefined {
	if (node.type === type) return node;
	const children = node.props.children;
	for (const child of children
		? Array.isArray(children)
			? children
			: [children]
		: []) {
		const match = find({ node: child, type });
		if (match) return match;
	}
}
function inputNode({
	node,
	type,
}: {
	node: NodeObservation;
	type: unknown;
}): NodeObservation {
	const found = find({ node, type });
	if (!found) throw new Error("Missing observed input");
	return found;
}

function observedKey({
	animations,
	path,
	index,
}: {
	animations: ElementAnimations | undefined;
	path: AnimationPath;
	index: number;
}): unknown {
	const channel = animations?.[path];
	if (!channel || !Array.isArray(channel.keys))
		throw new Error("Expected leaf channel");
	const key: unknown = channel.keys[index];
	return key;
}
function observedValue({
	animations,
	path,
	index = 0,
}: {
	animations: ElementAnimations | undefined;
	path: AnimationPath;
	index?: number;
}): unknown {
	const key = observedKey({ animations, path, index });
	if (!key || typeof key !== "object" || !("value" in key))
		throw new Error("Expected key value");
	return key.value;
}
test("actual FrostNumberField/draft preserves numbers/raw text and toggle", () => {
	const state = stateObservation(),
		values: ParamValue[] = [];
	let commits = 0;
	const hook = load<unknown>({
		relative:
			"../../components/editor/panels/properties/hooks/use-property-draft.ts",
		dependencies: {
			react: state.react,
			"../../../../../utils/math": {
				evaluateMathExpression: () => {
					throw new Error("Expression evaluated");
				},
			},
		},
	});
	const NumberField = Symbol("NumberField"),
		Toggle = Symbol("KeyframeToggle");
	const { FrostNumberField } = load<{
		FrostNumberField: (input: FieldInput) => NodeObservation;
	}>({
		relative: "../components/frost-number-field.tsx",
		dependencies: {
			"react/jsx-runtime": jsx,
			"../../components/editor/panels/properties/components/property-param-field":
				{ PropertyParamField: Symbol("other") },
			"../../components/editor/panels/properties/components/keyframe-toggle": {
				KeyframeToggle: Toggle,
			},
			"../../components/editor/panels/properties/hooks/use-property-draft":
				hook,
			"../../components/ui/number-field": { NumberField },
			"../../components/section": { SectionField: Symbol("Section") },
			"./frost-stroke-edit": { frostTypedValue },
		},
	});
	const render = () => {
		state.begin();
		return FrostNumberField({
			param,
			value: 0.5,
			onPreview: (value) => values.push(value),
			onCommit: () => commits++,
			keyframe: { isActive: true, isDisabled: false, onToggle: () => {} },
		});
	};
	const input = () => inputNode({ node: render(), type: NumberField });
	for (const value of ["0.500125", "1.1", "1x", "1+2", "", "NaN"]) {
		input().props.onFocus();
		input().props.onChange({ target: { value } });
		expect(input().props.value).toBe(value);
		input().props.onBlur({ target: { value } });
		expect(values.at(-1)).toBe(
			["0.500125", "1.1"].includes(value) ? Number(value) : value,
		);
	}
	expect(commits).toBe(6);
	expect(render().props.beforeLabel?.type).toBe(Toggle);
});
function fieldHarness({
	effectType = "frost",
	within = true,
}: { effectType?: string; within?: boolean } = {}) {
	const updates: { animations?: ElementAnimations }[] = [],
		previews: ParamValues[] = [];
	const editor = {
		timeline: {
			previewElements: (v: {
				updates: { updates: { animations?: ElementAnimations } }[];
			}) => updates.push(v.updates[0].updates),
			upsertKeyframes: async () => {},
			removeKeyframes: async () => {},
		},
	};
	const hook = load<unknown>({
		relative:
			"../../components/editor/panels/properties/hooks/use-keyframed-param-property.ts",
		dependencies: {
			"../../../../../editor/use-editor": { useEditorInstance: () => editor },
			"../../../../../animation": animationApi,
			"../../../../../params": paramsApi,
		},
	});
	const Frost = Symbol("Frost"),
		Generic = Symbol("Generic");
	const { EffectParamField } = load<{
		EffectParamField: (input: EffectInput) => NodeObservation;
	}>({
		relative: "../components/effect-param-field.tsx",
		dependencies: {
			"react/jsx-runtime": jsx,
			"../../animation": animationApi,
			"../../components/editor/panels/properties/components/property-param-field":
				{ PropertyParamField: Generic },
			"../../components/editor/panels/properties/hooks/use-element-playhead": {
				useElementPlayhead: () => ({
					localTime: mediaTime({ ticks: 12001 }),
					isPlayheadWithinElementRange: within,
				}),
			},
			"../../components/editor/panels/properties/hooks/use-keyframed-param-property":
				hook,
			"../../editor/use-editor": { useEditorInstance: () => editor },
			"./frost-number-field": { FrostNumberField: Frost },
		},
	});
	const animations: ElementAnimations = {
		"params.amount": {
			keys: [
				{
					id: "existing",
					time: mediaTime({ ticks: 12001 }),
					value: 0.5,
					segmentToNext: "linear",
					tangentMode: "flat",
				},
			],
		},
	};
	const render = (fallback: ParamValue) =>
		EffectParamField({
			param,
			effect: { id: "ice", type: effectType },
			element: { id: "clip", type: "effect", params: {}, animations },
			trackId: "track",
			params: { amount: fallback },
			preview: (value) => previews.push(value),
			commit: () => {},
			reportError: () => {},
			hasUnsavedDraft: false,
			prepareAnimated: () => {},
			rememberAnimated: () => {},
		});
	return { render, updates, previews, animations, Frost, Generic };
}
test("actual effect/hook retains invalid fallback then repairs before exact upsert", () => {
	const h = fieldHarness();
	for (const text of ["1x", "1+2", "", "NaN"]) {
		h.render(0.5).props.onPreview(text);
		expect(h.previews.at(-1)).toEqual({ amount: text });
		expect(h.render(text).props.value).toBe(text);
		const count = h.previews.length;
		h.render(text).props.onPreview(0.500125);
		expect(h.previews[count]).toEqual({ amount: 0.500125 });
		expect(
			observedValue({
				animations: h.updates.at(-1)?.animations,
				path: "params.amount",
			}),
		).toBe(0.500125);
		expect(
			observedValue({ animations: h.animations, path: "params.amount" }),
		).toBe(0.5);
	}
	h.render(0.5).props.onPreview(1.1);
	expect(
		observedValue({
			animations: h.updates.at(-1)?.animations,
			path: "params.amount",
		}),
	).toBe(1.1);
	expect(h.render(0.5).type).toBe(h.Frost);
	const other = fieldHarness({ effectType: "bubble" });
	other.render(0.5).props.onPreview(0.500125);
	expect(
		observedValue({
			animations: other.updates.at(-1)?.animations,
			path: "params.amount",
		}),
	).toBe(0.5);
	expect(other.render(0.5).type).toBe(other.Generic);
	const outside = fieldHarness({ within: false });
	outside.render(0.5).props.onPreview(1.1);
	expect(outside.previews.at(-1)).toEqual({ amount: 1.1 });
	expect(outside.updates).toHaveLength(0);
});
test("actual target uses Frost identity for toggle/base in both placements only", () => {
	type Target = Omit<AnimationPathDescriptor, "setBaseValue"> & {
		setBaseValue: (input: { value: ParamValue }) => ElementObservation;
	};
	const { resolveAnimationTarget } = load<{
		resolveAnimationTarget: (input: {
			element: ElementObservation;
			path: AnimationPath;
		}) => Target | null;
	}>({
		relative: "../../timeline/animation-targets.ts",
		dependencies: {
			"../animation/effect-param-channel": animationApi,
			"../animation/graphic-param-channel": animationApi,
			"../effects": {
				effectsRegistry: { get: () => ({ params: [param] }) },
				registerDefaultEffects: () => {},
			},
			"../graphics": { getGraphicDefinition: () => ({ params: [param] }) },
			"../params": paramsApi,
			"../params/registry": { getElementParam: () => null },
			"./element-utils": {
				isVisualElement: (element: ElementObservation) =>
					element.type === "graphic",
			},
		},
	});
	for (const attached of [false, true])
		for (const type of ["frost", "bubble"]) {
			const element: ElementObservation = attached
				? {
						type: "graphic",
						params: {},
						effects: [
							{ id: "ice", type, params: { amount: 0.5 } },
							{ id: "neighbor", type: "vhs", params: { amount: 0.2 } },
						],
					}
				: { type: "effect", effectType: type, params: { amount: 0.5 } };
			const path: AnimationPath = attached
				? "effects.ice.params.amount"
				: "params.amount";
			const target = resolveAnimationTarget({ element, path });
			expect(target).not.toBeNull();
			if (!target) throw new Error("Missing target");
			for (const value of [0.500125, 1.1]) {
				const expected = type === "frost" ? value : value > 1 ? 1 : 0.5;
				expect(target.coerceValue({ value })).toBe(expected);
				const updated = target.setBaseValue({ value });
				expect(
					attached ? updated.effects?.[0].params.amount : updated.params.amount,
				).toBe(expected);
				if (attached)
					expect(updated.effects?.[1]).toEqual(element.effects?.[1]);
				const keys = upsertPathKeyframe({
					animations: undefined,
					propertyPath: path,
					time: mediaTime({ ticks: 12001 }),
					value,
					channelLayout: target.channelLayout,
					coerceValue: target.coerceValue,
				});
				expect(observedValue({ animations: keys, path })).toBe(expected);
			}
		}
});
test("real TS identity upsert preserves interior metadata and neighboring channels", () => {
	const mid: ScalarAnimationKey = {
		id: "keep",
		time: mediaTime({ ticks: 12001 }),
		value: 0.5,
		segmentToNext: "bezier",
		tangentMode: "broken",
		leftHandle: { dt: mediaTime({ ticks: -2 }), dv: 0.1 },
		rightHandle: { dt: mediaTime({ ticks: 3 }), dv: 0.2 },
	};
	const animations: ElementAnimations = {
		"params.amount": {
			keys: [
				{
					id: "first",
					time: mediaTime({ ticks: 0 }),
					value: 0,
					segmentToNext: "bezier",
					tangentMode: "flat",
				},
				mid,
				{
					id: "last",
					time: mediaTime({ ticks: 24000 }),
					value: 1,
					segmentToNext: "linear",
					tangentMode: "flat",
				},
			],
		},
		"params.opacity": {
			keys: [
				{
					id: "neighbor",
					time: mediaTime({ ticks: 0 }),
					value: 0.8,
					segmentToNext: "linear",
					tangentMode: "auto",
				},
			],
		},
	};
	const result = upsertPathKeyframe({
		animations,
		propertyPath: "params.amount",
		time: mediaTime({ ticks: 12001 }),
		value: 0.500125,
		channelLayout: paramsApi.getParamChannelLayout({ param }),
		coerceValue: ({ value }) => value,
	});
	expect(
		observedKey({ animations: result, path: "params.amount", index: 1 }),
	).toEqual({
		...mid,
		value: 0.500125,
	});
	expect(result?.["params.opacity"]).toEqual(animations["params.opacity"]);
	expect(mid.value).toBe(0.5);
});
