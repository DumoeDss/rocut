import { expect, test } from "bun:test";
import { isValidElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ProgrammaticRecipePostFields } from "./programmatic-recipe-post-fields";
import {
	changePostCurves,
	postCurvesFit,
} from "./programmatic-recipe-post-automation-data";
import { postParameterRule } from "./programmatic-recipe-post-data";

const finishingEffects = {
	lightLeak: {
		parameters: {
			amount: { type: "number", min: 0, max: 1, required: true },
			alpha: { type: "enum", values: ["preserve", "expand"], required: true },
			seedOffset: { type: "integer", min: 0, max: 4294967295, required: false },
		},
	},
	flash: {
		parameters: {
			amount: { type: "number", min: 0, max: 1, required: true },
			color: { type: "rgb", length: 3, min: 0, max: 1, required: true },
		},
	},
};
const automation = {
	version: 1,
	targetParameter: "amount",
	targetEffects: ["lightLeak", "flash"],
	maxCurves: 8,
	maxKeyframes: 256,
	easings: ["linear", "inOutSine"],
};
const recipe = () => ({
	root: "keep",
	unknown: { retain: true },
	post: [
		{
			stage: "role",
			roles: ["subject", "graphics"],
			audio: [{ effect: 0, clock: "song", custom: true }],
			effects: [
				{
					kind: "lightLeak",
					amount: 0.5,
					alpha: "preserve",
					seedOffset: 7,
					extra: "keep",
				},
				{ kind: "flash", amount: 0.2, color: [1, 0.5, 0] },
			],
			extra: "post",
		},
		{ stage: "composite", effects: [], extra: true },
	],
});
interface Control {
	children?: ReactNode;
	id?: string;
	"aria-label"?: string;
	disabled?: boolean;
	onClick?: () => void;
	onChange?: (event: {
		target: { value: string; valueAsNumber?: number };
	}) => void;
}
function find(node: ReactNode, name: string): Control | undefined {
	if (Array.isArray(node)) {
		for (const child of node) {
			const found = find(child, name);
			if (found) return found;
		}
	} else if (isValidElement<Control>(node)) {
		if (node.props.id === name || node.props["aria-label"] === name)
			return node.props;
		return find(node.props.children, name);
	}
}
test("post catalog spellings adapt without adding defaults or changing generic schema", () => {
	expect(postParameterRule({ type: "integer", min: 0, max: 7 })).toEqual({
		type: "number",
		integer: true,
		min: 0,
		max: 7,
	});
	expect(postParameterRule({ type: "rgb", length: 3, min: 0, max: 1 })).toEqual(
		{ type: "rgba", length: 3, min: 0, max: 1 },
	);
	expect(
		postParameterRule({ type: "enum", values: ["preserve", "expand"] })
			?.options,
	).toEqual(["preserve", "expand"]);
});
test("post parameter and explicit curve/keyframe edits preserve unknown fields and authored orders", () => {
	let text = JSON.stringify(recipe());
	const original = JSON.parse(text);
	const fields = (disabled = false) =>
		ProgrammaticRecipePostFields({
			id: "post",
			text,
			durationFrames: 24,
			finishing: { effects: finishingEffects, automation },
			disabled,
			onEdit: (next) => {
				text = next;
			},
		});
	find(fields(), "post-post-0-effect-0-seedOffset")?.onChange?.({
		target: { value: "11", valueAsNumber: 11 },
	});
	expect(JSON.parse(text).post[0].effects[0].seedOffset).toBe(11);
	const label = "effect 0 lightLeak",
		tree = fields();
	find(tree, `New ${label} keyframe frame`)?.onChange?.({
		target: { value: "0" },
	});
	find(tree, `New ${label} keyframe value`)?.onChange?.({
		target: { value: "0.25" },
	});
	find(tree, `New ${label} keyframe easing`)?.onChange?.({
		target: { value: "linear" },
	});
	find(tree, `Add amount curve for ${label}`)?.onClick?.();
	expect(JSON.parse(text).post[0].automation).toEqual([
		{ effect: 0, keyframes: [{ frame: 0, value: 0.25, easing: "linear" }] },
	]);
	const keyTree = fields();
	find(keyTree, `New ${label} keyframe frame`)?.onChange?.({
		target: { value: "24" },
	});
	find(keyTree, `New ${label} keyframe value`)?.onChange?.({
		target: { value: "1" },
	});
	find(keyTree, `New ${label} keyframe easing`)?.onChange?.({
		target: { value: "inOutSine" },
	});
	find(keyTree, `Add keyframe to ${label}`)?.onClick?.();
	find(fields(), `${label} keyframe 1 value`)?.onChange?.({
		target: { value: "0.75", valueAsNumber: 0.75 },
	});
	expect(JSON.parse(text).post[0].automation[0].keyframes[1]).toEqual({
		frame: 24,
		value: 0.75,
		easing: "inOutSine",
	});
	find(fields(), `Remove ${label} keyframe 0`)?.onClick?.();
	expect(JSON.parse(text).post[0].automation[0].keyframes).toHaveLength(1);
	find(fields(), `Remove amount curve for ${label}`)?.onClick?.();
	expect(JSON.parse(text).post[0].automation).toEqual([]);
	const next = JSON.parse(text);
	expect(next).not.toHaveProperty("durationFrames");
	expect(next.unknown).toEqual(original.unknown);
	expect(next.post[0].audio).toEqual(original.post[0].audio);
	expect(next.post[0].roles).toEqual(original.post[0].roles);
	expect(next.post[1]).toEqual(original.post[1]);
	expect(next.post[0].effects[1]).toEqual(original.post[0].effects[1]);
	expect(next.post[0].effects[0].extra).toBe("keep");
	const stable = text;
	find(fields(true), "post-post-0-effect-0-amount")?.onChange?.({
		target: { value: "0.1", valueAsNumber: 0.1 },
	});
	expect(text).toBe(stable);
});
test("curves reject bad frames, duplicate targets, values, budgets and easing without sorting", () => {
	const post = recipe().post[0]!,
		effects = post.effects;
	const good = {
		effect: 0,
		keyframes: [
			{ frame: 0, value: 0.2, easing: "linear" },
			{ frame: 24, value: 1, easing: "inOutSine" },
		],
	};
	expect(postCurvesFit([good], effects, 24, finishingEffects, automation)).toBe(
		true,
	);
	for (const curve of [
		{ ...good, effect: 2 },
		{ ...good, effect: -1 },
		{ ...good, keyframes: [] },
		{ ...good, keyframes: [{ frame: 0.5, value: 0.2, easing: "linear" }] },
		{ ...good, keyframes: [{ frame: 25, value: 0.2, easing: "linear" }] },
		{ ...good, keyframes: [{ frame: 0, value: 1.01, easing: "linear" }] },
		{ ...good, keyframes: [{ frame: 0, value: 0.2, easing: "fake" }] },
		{ ...good, keyframes: [...good.keyframes].reverse() },
	])
		expect(
			postCurvesFit([curve], effects, 24, finishingEffects, automation),
		).toBe(false);
	expect(
		postCurvesFit([good, good], effects, 24, finishingEffects, automation),
	).toBe(false);
	expect(
		postCurvesFit([good], effects, 24, finishingEffects, {
			...automation,
			maxKeyframes: 1,
		}),
	).toBe(false);
	expect(
		changePostCurves(
			{ ...post, automation: [good, good] },
			[],
			24,
			finishingEffects,
			automation,
			false,
		),
	).toBeUndefined();
	expect(
		changePostCurves(post, [good], 24, finishingEffects, automation, true),
	).toBeUndefined();
});
test("invalid JSON/catalog and invalid existing curve retain draft; forms are accessible", () => {
	let edits = 0;
	const props = {
		id: "p",
		durationFrames: 24,
		finishing: { effects: finishingEffects, automation },
		disabled: false,
		onEdit: () => edits++,
	};
	expect(ProgrammaticRecipePostFields({ ...props, text: "{" })).toBeNull();
	const bad = recipe();
	Object.assign(bad.post[0]!, {
		automation: [
			{ effect: 0, keyframes: [{ frame: 0, value: 99, easing: "linear" }] },
		],
	});
	find(
		ProgrammaticRecipePostFields({ ...props, text: JSON.stringify(bad) }),
		"p-post-0-effect-0-amount",
	)?.onChange?.({ target: { value: "0.1", valueAsNumber: 0.1 } });
	expect(edits).toBe(0);
	const html = renderToStaticMarkup(
		ProgrammaticRecipePostFields({ ...props, text: JSON.stringify(recipe()) })!,
	);
	expect(html).toContain("Add amount curve");
	expect(html).toContain("Choose explicitly");
	expect(html).toContain("New effect 0 lightLeak keyframe frame");
	expect(html).not.toContain("Apply recipe");
});

test("RGB, nested opaque palette and grade tuples retain exact channels and catalog domains", () => {
	const number = (min: number, max: number) => ({
		type: "number",
		min,
		max,
		required: true,
	});
	const tuple = (items: unknown[]) => ({
		type: "tuple",
		items,
		required: true,
	});
	const colorsCatalog = {
		grade: {
			parameters: {
				lift: { type: "rgb", length: 3, min: -1, max: 1, required: true },
				gain: tuple([number(0, 4), number(0, 4), number(0, 4)]),
			},
		},
		palette: {
			parameters: {
				colors: {
					type: "array",
					minItems: 2,
					maxItems: 16,
					required: true,
					items: tuple([
						number(0, 1),
						number(0, 1),
						number(0, 1),
						number(1, 1),
					]),
				},
				mix: number(0, 1),
			},
		},
		flash: finishingEffects.flash,
	};
	let text = JSON.stringify({
		post: [
			{
				effects: [
					{ kind: "grade", lift: [0, 0, 0], gain: [1, 1, 1] },
					{
						kind: "palette",
						colors: [
							[1, 0, 0, 1],
							[0, 0, 1, 1],
						],
						mix: 1,
					},
					{ kind: "flash", amount: 0.5, color: [1, 0.5, 0] },
				],
			},
		],
	});
	const fields = () =>
		ProgrammaticRecipePostFields({
			id: "color",
			text,
			durationFrames: 24,
			finishing: { effects: colorsCatalog, automation },
			disabled: false,
			onEdit: (next) => {
				text = next;
			},
		});
	find(fields(), "color-post-0-effect-0-lift-0")?.onChange?.({
		target: { value: "-0.75", valueAsNumber: -0.75 },
	});
	find(fields(), "color-post-0-effect-0-gain-2")?.onChange?.({
		target: { value: "3.5", valueAsNumber: 3.5 },
	});
	find(fields(), "color-post-0-effect-1-colors-0-1")?.onChange?.({
		target: { value: "0.5", valueAsNumber: 0.5 },
	});
	find(fields(), "color-post-0-effect-2-color-2")?.onChange?.({
		target: { value: "0.25", valueAsNumber: 0.25 },
	});
	const effects = JSON.parse(text).post[0].effects;
	expect(effects[0].lift).toEqual([-0.75, 0, 0]);
	expect(effects[0].gain).toEqual([1, 1, 3.5]);
	expect(effects[1].colors).toEqual([
		[1, 0.5, 0, 1],
		[0, 0, 1, 1],
	]);
	expect(effects[2].color).toEqual([1, 0.5, 0.25]);
	const stable = text;
	find(fields(), "color-post-0-effect-1-colors-0-3")?.onChange?.({
		target: { value: "0.5", valueAsNumber: 0.5 },
	});
	find(fields(), "color-post-0-effect-0-gain-2")?.onChange?.({
		target: { value: "4.01", valueAsNumber: 4.01 },
	});
	find(fields(), "color-post-0-effect-2-color-2")?.onChange?.({
		target: { value: "-0.1", valueAsNumber: -0.1 },
	});
	expect(text).toBe(stable);
	expect(find(fields(), "Add amount curve for effect 0 grade")).toBeUndefined();
	expect(
		find(fields(), "Add amount curve for effect 1 palette"),
	).toBeUndefined();
});

test("target membership is explicit; old catalog permits parameters but does not infer curves", () => {
	let text = JSON.stringify(recipe());
	const old = {
		version: 1,
		maxCurves: 8,
		maxKeyframes: 256,
		easings: ["linear"],
	};
	const fields = (catalog: Record<string, unknown>) =>
		ProgrammaticRecipePostFields({
			id: "old",
			text,
			durationFrames: 24,
			finishing: { effects: finishingEffects, automation: catalog },
			disabled: false,
			onEdit: (next) => {
				text = next;
			},
		});
	find(fields(old), "old-post-0-effect-0-amount")?.onChange?.({
		target: { value: ".75", valueAsNumber: 0.75 },
	});
	expect(JSON.parse(text).post[0].effects[0].amount).toBe(0.75);
	expect(
		find(fields(old), "Add amount curve for effect 0 lightLeak"),
	).toBeUndefined();
	expect(
		find(
			fields({ ...automation, targetEffects: ["flash"] }),
			"Add amount curve for effect 0 lightLeak",
		),
	).toBeUndefined();
	expect(
		find(
			fields({ ...automation, targetEffects: ["flash"] }),
			"Add amount curve for effect 1 flash",
		),
	).toBeDefined();
	expect(JSON.parse(text).post[0]).not.toHaveProperty("automation");
});

test("invalid existing automation/static parameters forbid writes, including null instead of absent", () => {
	for (const invalid of [
		null,
		"invalid",
		{ effect: 0 },
		[{ effect: 0, keyframes: [] }],
	]) {
		const draft = recipe();
		Object.assign(draft.post[0]!, { automation: invalid });
		let text = JSON.stringify(draft),
			stable = text;
		const tree = ProgrammaticRecipePostFields({
			id: "bad",
			text,
			durationFrames: 24,
			finishing: { effects: finishingEffects, automation },
			disabled: false,
			onEdit: (next) => {
				text = next;
			},
		});
		find(tree, "bad-post-0-effect-0-amount")?.onChange?.({
			target: { value: ".2", valueAsNumber: 0.2 },
		});
		expect(text).toBe(stable);
	}
	const draft = recipe();
	draft.post[0]!.effects[1]!.amount = 99;
	expect(
		changePostCurves(
			draft.post[0]!,
			[{ effect: 0, keyframes: [{ frame: 0, value: 0.2, easing: "linear" }] }],
			24,
			finishingEffects,
			automation,
			false,
		),
	).toBeUndefined();
});

test("curve and key extras survive edits; a nonunit domain and reduced catalog budgets are exact", () => {
	const effect = { kind: "lineBoil", amount: 2 };
	const effects = {
		lineBoil: {
			parameters: {
				amount: { type: "number", min: 0, max: 32, required: true },
			},
		},
	};
	const catalog = {
		...automation,
		targetEffects: ["lineBoil"],
		maxCurves: 1,
		maxKeyframes: 2,
	};
	const curve = {
		effect: 0,
		custom: { keep: true },
		keyframes: [
			{ frame: 0, value: 2, easing: "linear", note: "keep" },
			{ frame: 24, value: 32, easing: "inOutSine" },
		],
	};
	const post = {
		effects: [effect],
		automation: [curve],
		audio: [{ clock: "source" }],
		stage: "composite",
	};
	const next = changePostCurves(
		post,
		[
			{
				...curve,
				keyframes: [{ ...curve.keyframes[0]!, value: 12 }, curve.keyframes[1]!],
			},
		],
		24,
		effects,
		catalog,
		false,
	)!;
	expect(next.automation).toEqual([
		{
			...curve,
			keyframes: [{ ...curve.keyframes[0]!, value: 12 }, curve.keyframes[1]!],
		},
	]);
	expect(next.audio).toEqual(post.audio);
	expect(next.stage).toBe("composite");
	expect(
		postCurvesFit(
			[{ ...curve, keyframes: [{ frame: 0, value: 32.01, easing: "linear" }] }],
			[effect],
			24,
			effects,
			catalog,
		),
	).toBe(false);
	expect(
		postCurvesFit(
			[
				{
					...curve,
					keyframes: [
						...curve.keyframes,
						{ frame: 24, value: 2, easing: "linear" },
					],
				},
			],
			[effect],
			24,
			effects,
			catalog,
		),
	).toBe(false);
});
