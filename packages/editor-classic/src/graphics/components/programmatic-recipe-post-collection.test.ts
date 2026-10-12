import { expect, test } from "bun:test";
import {
	editPostCollection,
	newPostEffect,
	newPostEffectRule,
	newPostGroup,
	postCollectionDraft,
	postRoleChoices,
	remapPostEffects,
} from "./programmatic-recipe-post-collection-data";

const effects = {
	vignette: {
		parameters: { amount: { type: "number", min: 0, max: 1, required: true } },
	},
	lightLeak: {
		parameters: {
			amount: { type: "number", min: 0, max: 1, required: true },
			alpha: { type: "enum", values: ["preserve", "expand"], required: true },
			speed: { type: "number", min: 0, max: 8, required: false, default: 1 },
		},
	},
	palette: {
		parameters: {
			colors: {
				type: "array",
				minItems: 2,
				maxItems: 16,
				required: true,
				items: {
					type: "tuple",
					items: [0, 1, 2, 3].map((index) => ({
						type: "number",
						min: index === 3 ? 1 : 0,
						max: 1,
					})),
				},
			},
			mix: { type: "number", min: 0, max: 1, required: true },
		},
	},
};
test("new effects require explicit catalog fields without optional/default injection", () => {
	expect(newPostEffect("vignette", {}, effects)).toBeUndefined();
	expect(newPostEffect("vignette", { amount: 0 }, effects)).toEqual({
		kind: "vignette",
		amount: 0,
	});
	expect(newPostEffect("vignette", { amount: 1.01 }, effects)).toBeUndefined();
	expect(
		newPostEffect("lightLeak", { amount: 0.2, alpha: "preserve" }, effects),
	).toEqual({ kind: "lightLeak", amount: 0.2, alpha: "preserve" });
	expect(
		newPostEffect("lightLeak", { amount: 0.2, alpha: "no" }, effects),
	).toBeUndefined();
	expect(
		newPostEffect("vignette", { amount: 0.2, kind: "other" }, effects),
	).toBeUndefined();
	expect(newPostEffect("unknown", { amount: 0.2 }, effects)).toBeUndefined();
	expect(
		newPostEffectRule("reserved", {
			reserved: {
				parameters: { kind: { type: "enum", options: ["vignette"] } },
			},
		}),
	).toBeUndefined();
	expect(newPostEffectRule("lightLeak", effects)?.required).toEqual([
		"amount",
		"alpha",
	]);
	const palette = {
		colors: [
			[0, 0, 0, 1],
			[1, 1, 1, 1],
		],
		mix: 0.5,
	};
	expect(newPostEffect("palette", palette, effects)).toEqual({
		kind: "palette",
		...palette,
	});
	expect(
		newPostEffect(
			"palette",
			{
				...palette,
				colors: [
					[0, 0, 0, 0.5],
					[1, 1, 1, 1],
				],
			},
			effects,
		),
	).toBeUndefined();
});

test("effect permutations preserve target identity, remove only deleted bindings, and retain extras", () => {
	const post = {
		stage: "role",
		roles: ["subject"],
		extra: { keep: true },
		effects: [
			{ kind: "vignette", amount: 0.2 },
			{ kind: "fade", amount: 0.3 },
			{ kind: "grain", amount: 0.4, fps: 24 },
		],
		automation: [
			{
				effect: 0,
				keyframes: [{ frame: 0, value: 0.1, easing: "linear" }],
				extra: "curve0",
			},
			{
				effect: 2,
				keyframes: [{ frame: 12, value: 0.5, easing: "linear" }],
				extra: "curve2",
			},
		],
		audio: [
			{ effect: 1, amount: 0.3, signal: { preserve: true } },
			{ effect: 2, amount: 0.1, extra: "audio2" },
		],
	};
	const before = structuredClone(post);
	const moved = remapPostEffects(post, [2, 0, 1], false)!;
	expect(moved.effects).toEqual([
		post.effects[2],
		post.effects[0],
		post.effects[1],
	]);
	expect(moved.automation).toEqual([
		{ ...post.automation[0], effect: 1 },
		{ ...post.automation[1], effect: 0 },
	]);
	expect(moved.audio).toEqual([
		{ ...post.audio[0], effect: 2 },
		{ ...post.audio[1], effect: 0 },
	]);
	expect(moved.extra).toEqual(post.extra);
	expect(moved.roles).toEqual(post.roles);
	const removed = remapPostEffects(post, [0, 2], false)!;
	expect(removed.audio).toEqual([{ ...post.audio[1], effect: 1 }]);
	expect(removed.automation).toEqual([
		{ ...post.automation[0], effect: 0 },
		{ ...post.automation[1], effect: 1 },
	]);
	expect(post).toEqual(before);
	for (const order of [[], [0, 0], [-1], [3], [0.5]])
		expect(remapPostEffects(post, order, false)).toBeUndefined();
	expect(remapPostEffects(post, [0, 1, 2], true)).toBeUndefined();
	for (const bindings of [
		null,
		{},
		[{ effect: 3 }],
		[{ effect: 0 }, { effect: 0 }],
		[{ effect: "0" }],
	]) {
		expect(
			remapPostEffects({ ...post, audio: bindings }, [0, 1, 2], false),
		).toBeUndefined();
	}
	const absent = remapPostEffects({ effects: post.effects }, [2, 1, 0], false)!;
	expect(Object.hasOwn(absent, "audio")).toBe(false);
	expect(Object.hasOwn(absent, "automation")).toBe(false);
});

test("post collections retain whole recipe and require explicit supported stage/roles", () => {
	const recipe = {
		root: "keep",
		nodes: [{ id: "keep" }],
		extras: { keep: true },
	};
	expect(postCollectionDraft(JSON.stringify(recipe))?.post).toEqual([]);
	for (const post of [null, {}, [null], [{ effects: null }]])
		expect(
			postCollectionDraft(JSON.stringify({ ...recipe, post })),
		).toBeUndefined();
	const postStages = { supported: ["role", "composite"] };
	const roleChoices = ["background", "subject", "graphics", "foreground"];
	const effect = { kind: "vignette", amount: 0.2 };
	const group = newPostGroup({
		stage: "role",
		roles: ["subject"],
		effect,
		postStages,
		roleChoices,
	})!;
	expect(group).toEqual({
		stage: "role",
		roles: ["subject"],
		effects: [effect],
	});
	expect(
		JSON.parse(editPostCollection(JSON.stringify(recipe), [group], false)!),
	).toEqual({ ...recipe, post: [group] });
	expect(
		editPostCollection(JSON.stringify(recipe), [group], true),
	).toBeUndefined();
	expect(editPostCollection("{", [group], false)).toBeUndefined();
	const create = (stage: string, roles: string[]) =>
		newPostGroup({ stage, roles, effect, postStages, roleChoices });
	expect(create("", [])).toBeUndefined();
	expect(create("role", [])).toBeUndefined();
	expect(create("role", ["subject", "subject"])).toBeUndefined();
	expect(create("role", ["unknown"])).toBeUndefined();
	expect(create("composite", ["subject"])).toBeUndefined();
	expect(create("composite", [])).toEqual({
		stage: "composite",
		effects: [effect],
	});
	expect(
		postRoleChoices({
			layers: {
				parameters: {
					items: {
						items: {
							properties: { roles: { items: { options: roleChoices } } },
						},
					},
				},
			},
		}),
	).toEqual(roleChoices);
	expect(postRoleChoices({})).toEqual([]);
});
