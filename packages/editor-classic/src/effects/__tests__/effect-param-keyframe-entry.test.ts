import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { transformSync } from "esbuild";
import * as animation from "../../animation";
import * as params from "../../params";
import type { ParamDefinition, ParamValue } from "../../params";
import type { ElementAnimations } from "../../animation/types";
import { mediaTime } from "../../wasm/media-time";
import { blurEffectDefinition } from "../definitions/blur";

// Exercise real field + real param hook without global mock.module replacement.
// Only editor/playhead and JSX leaf rendering are observed boundaries, not Host history.
function load<T>(relative: string, dependencies: Record<string, unknown>): T {
	const { code } = transformSync(
		readFileSync(new URL(relative, import.meta.url), "utf8"),
		{
			loader: relative.endsWith("tsx") ? "tsx" : "ts",
			format: "cjs",
			jsx: "automatic",
			target: "es2022",
		},
	);
	const module = { exports: {} };
	runInNewContext(code, {
		module,
		exports: module.exports,
		require: (name: string) => {
			if (!Object.hasOwn(dependencies, name))
				throw Error(`Unobserved dependency ${name}`);
			return dependencies[name];
		},
	});
	return module.exports as T;
}
interface Leaf {
	props: {
		value: ParamValue;
		onPreview: (value: ParamValue) => void;
		onCommit: () => void;
		keyframe?: { isActive: boolean; isDisabled: boolean; onToggle: () => void };
	};
}
type Entry = {
	trackId: string;
	elementId: string;
	propertyPath: string;
	time?: ReturnType<typeof mediaTime>;
	value?: ParamValue;
	keyframeId?: string;
};
function harness({
	standalone = true,
	param = blurEffectDefinition.params[0]!,
	within = true,
	unsaved = false,
	animations,
}: {
	standalone?: boolean;
	param?: ParamDefinition;
	within?: boolean;
	unsaved?: boolean;
	animations?: ElementAnimations;
} = {}) {
	const upserts: Entry[] = [],
		removals: Entry[] = [],
		previews: Record<string, unknown>[] = [],
		reports: string[] = [];
	let fail = false,
		commits = 0,
		prepare = 0,
		remember = 0;
	const editor = {
		timeline: {
			upsertKeyframes: async ({ keyframes }: { keyframes: Entry[] }) => {
				if (fail) throw Error("transaction rejected");
				upserts.push(...keyframes);
			},
			removeKeyframes: async ({ keyframes }: { keyframes: Entry[] }) => {
				if (fail) throw Error("transaction rejected");
				removals.push(...keyframes);
			},
			previewElements: ({
				updates,
			}: {
				updates: { updates: Record<string, unknown> }[];
			}) => {
				previews.push(...updates.map((item) => item.updates));
			},
			commitPreview: () => {
				commits++;
			},
		},
	};
	const hook = load<Record<string, unknown>>(
		"../../components/editor/panels/properties/hooks/use-keyframed-param-property.ts",
		{
			"../../../../../editor/use-editor": { useEditorInstance: () => editor },
			"../../../../../animation": animation,
			"../../../../../params": params,
		},
	);
	const source = load<{
		EffectParamField: (props: Record<string, unknown>) => Leaf;
	}>("../components/effect-param-field.tsx", {
		"react/jsx-runtime": {
			jsx: (type: unknown, props: unknown) => ({ type, props }),
		},
		"../../animation": animation,
		"../../components/editor/panels/properties/components/property-param-field":
			{ PropertyParamField: Symbol("field") },
		"../../components/editor/panels/properties/hooks/use-element-playhead": {
			useElementPlayhead: () => ({
				localTime: mediaTime({ ticks: 12001 }),
				isPlayheadWithinElementRange: within,
			}),
		},
		"../../components/editor/panels/properties/hooks/use-keyframed-param-property":
			hook,
		"../../editor/use-editor": { useEditorInstance: () => editor },
		"./frost-number-field": { FrostNumberField: Symbol("raw-field") },
	});
	const path = standalone
		? "params.intensity"
		: "effects.selected-blur.params.intensity";
	const input = {
		param,
		effect: { id: "selected-blur", type: "blur", params: { intensity: 15 } },
		element: {
			id: "clip",
			type: standalone ? "effect" : "image",
			params: { intensity: 15 },
			animations,
			effects: [
				{ id: "other-blur", type: "blur", params: { intensity: 3 } },
				{ id: "selected-blur", type: "blur", params: { intensity: 15 } },
			],
		},
		trackId: "track",
		params: { intensity: 15 },
		preview: (value: unknown) => {
			previews.push({ params: value });
		},
		commit: () => {
			commits++;
		},
		reportError: (message: string) => reports.push(message),
		hasUnsavedDraft: unsaved,
		prepareAnimated: () => {
			prepare++;
		},
		rememberAnimated: () => {
			remember++;
		},
	};
	return {
		render: () => source.EffectParamField(input),
		upserts,
		removals,
		previews,
		reports,
		path,
		fail: () => {
			fail = true;
		},
		get commits() {
			return commits;
		},
		get prepare() {
			return prepare;
		},
		get remember() {
			return remember;
		},
	};
}

test("implicit numeric eligibility exposes existing Blur create/delete paths without redefining the effect", async () => {
	expect(blurEffectDefinition.params[0]!.keyframable).toBeUndefined();
	for (const standalone of [true, false]) {
		const h = harness({ standalone });
		const field = h.render();
		expect(field.props.keyframe).toBeDefined();
		expect(field.props.keyframe?.isDisabled).toBe(false);
		field.props.keyframe!.onToggle();
		await Promise.resolve();
		expect(h.upserts).toEqual([
			{
				trackId: "track",
				elementId: "clip",
				propertyPath: h.path,
				time: mediaTime({ ticks: 12001 }),
				value: 15,
			},
		]);
		const animations = animation.upsertPathKeyframe({
			animations: undefined,
			propertyPath: h.path,
			time: mediaTime({ ticks: 12001 }),
			value: 15,
			keyframeId: "existing",
			channelLayout: params.getParamChannelLayout({
				param: blurEffectDefinition.params[0]!,
			}),
			coerceValue: ({ value }) => value,
		});
		const populated = harness({ standalone, animations });
		const active = populated.render();
		expect(active.props.keyframe?.isActive).toBe(true);
		active.props.keyframe!.onToggle();
		await Promise.resolve();
		expect(populated.removals).toEqual([
			{
				trackId: "track",
				elementId: "clip",
				propertyPath: h.path,
				keyframeId: "existing",
			},
		]);
	}
});

test("editing an existing implicit Blur key uses its channel and preserves other slot and key metadata", () => {
	const animations = animation.upsertPathKeyframe({
		animations: undefined,
		propertyPath: "effects.selected-blur.params.intensity",
		time: mediaTime({ ticks: 12001 }),
		value: 15,
		keyframeId: "selected-key",
		interpolation: "hold",
		channelLayout: params.getParamChannelLayout({
			param: blurEffectDefinition.params[0]!,
		}),
		coerceValue: ({ value }) => value,
	});
	const other = animation.upsertPathKeyframe({
		animations,
		propertyPath: "effects.other-blur.params.intensity",
		time: mediaTime({ ticks: 12001 }),
		value: 3,
		keyframeId: "other-key",
		channelLayout: params.getParamChannelLayout({
			param: blurEffectDefinition.params[0]!,
		}),
		coerceValue: ({ value }) => value,
	});
	if (!other) throw new Error("Expected populated animation channels");
	const before = structuredClone(other),
		h = harness({ standalone: false, animations: other });
	h.render().props.onPreview(24);
	h.render().props.onCommit();
	expect(h.prepare).toBe(1);
	expect(h.remember).toBe(1);
	expect(h.commits).toBe(1);
	const next = h.previews[0]!.animations as ElementAnimations;
	const selected = next["effects.selected-blur.params.intensity"];
	if (!selected || !Array.isArray(selected.keys))
		throw new Error("Expected scalar Blur channel");
	expect(selected.keys[0]).toMatchObject({
		id: "selected-key",
		value: 24,
		segmentToNext: "step",
	});
	expect(next["effects.other-blur.params.intensity"]).toEqual(
		before["effects.other-blur.params.intensity"],
	);
	expect(other).toEqual(before);
	expect(h.previews[0]).not.toHaveProperty("effects");
	expect(h.previews[0]).not.toHaveProperty("params");
});

test("explicit nonanimatable definition, out-of-range playhead and retained draft do not create keys", async () => {
	const base = blurEffectDefinition.params[0]!;
	expect(
		harness({ param: { ...base, keyframable: false } }).render().props.keyframe,
	).toBeUndefined();
	for (const options of [{ within: false }, { unsaved: true }]) {
		const h = harness(options);
		expect(h.render().props.keyframe?.isDisabled).toBe(true);
		h.render().props.keyframe!.onToggle();
		await Promise.resolve();
		expect(h.upserts).toEqual([]);
		expect(h.removals).toEqual([]);
	}
});

test("transaction rejection is visible and does not fall back to a static parameter write", async () => {
	const h = harness();
	h.fail();
	h.render().props.keyframe!.onToggle();
	await new Promise<void>((resolve) => setImmediate(resolve));
	expect(h.reports).toEqual([
		"Keyframe was not saved. Check the effect values and try again.",
	]);
	expect(h.previews).toEqual([]);
	expect(h.upserts).toEqual([]);
});
