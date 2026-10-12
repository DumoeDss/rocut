import { recipeParameterSchemaKnown } from "./programmatic-recipe-parameter-schema";
import {
	postDraft,
	postEffectFits,
	postEffectParameters,
	postObject,
	postParameterRule,
	type PostRecord,
} from "./programmatic-recipe-post-data";

export function newPostEffectRule(kind: string, effects: PostRecord) {
	const parameters = postEffectParameters({ kind }, effects);
	if (!parameters || Object.hasOwn(parameters, "kind")) return undefined;
	const properties: PostRecord = {};
	for (const [key, value] of Object.entries(parameters)) {
		const rule = postParameterRule(value);
		if (!rule || !recipeParameterSchemaKnown({ rule })) return undefined;
		properties[key] = rule;
	}
	return {
		type: "object",
		properties,
		required: Object.entries(properties)
			.filter(([, value]) => postObject(value)?.required !== false)
			.map(([key]) => key),
		additionalProperties: false,
	};
}

/** Collection changes are draft-only. Rust still owns whole-recipe admission. */
export function postCollectionDraft(text: string): PostRecord | undefined {
	try {
		const recipe = postObject(JSON.parse(text));
		if (!recipe) return undefined;
		return Object.hasOwn(recipe, "post")
			? postDraft(text)
			: { ...recipe, post: [] };
	} catch {
		return undefined;
	}
}

export function editPostCollection(
	text: string,
	posts: PostRecord[],
	disabled: boolean,
) {
	const recipe = postCollectionDraft(text);
	return !disabled && recipe
		? JSON.stringify({ ...recipe, post: posts }, null, 2)
		: undefined;
}

export function newPostEffect(
	kind: string,
	parameters: unknown,
	effects: PostRecord,
): PostRecord | undefined {
	const values = postObject(parameters),
		catalog = postEffectParameters({ kind }, effects);
	if (
		!values ||
		!catalog ||
		!newPostEffectRule(kind, effects) ||
		Object.keys(values).some((key) => !Object.hasOwn(catalog, key)) ||
		!postEffectFits(values, catalog)
	)
		return undefined;
	return { kind, ...values };
}

/** Refuse ambiguous bindings instead of silently repairing unknown indices. */
function indexedBindings(post: PostRecord, count: number) {
	return ["automation", "audio"].every((key) => {
		if (!Object.hasOwn(post, key)) return true;
		const items = post[key];
		if (!Array.isArray(items)) return false;
		const seen = new Set<number>();
		return items.every((value) => {
			const index = postObject(value)?.effect;
			if (
				typeof index !== "number" ||
				!Number.isSafeInteger(index) ||
				index < 0 ||
				index >= count ||
				seen.has(index)
			)
				return false;
			seen.add(index);
			return true;
		});
	});
}

export function remapPostEffects(
	post: PostRecord,
	order: number[],
	disabled: boolean,
): PostRecord | undefined {
	const effects = post.effects;
	if (
		disabled ||
		!Array.isArray(effects) ||
		!effects.every((effect) => !!postObject(effect)) ||
		!order.length ||
		new Set(order).size !== order.length ||
		order.some(
			(index) =>
				!Number.isSafeInteger(index) || index < 0 || index >= effects.length,
		) ||
		!indexedBindings(post, effects.length)
	)
		return undefined;
	const next: PostRecord = {
		...post,
		effects: order.map((index) => effects[index]),
	};
	for (const key of ["automation", "audio"]) {
		if (!Object.hasOwn(post, key)) continue;
		next[key] = (post[key] as PostRecord[]).flatMap((binding) => {
			const index = order.indexOf(binding.effect as number);
			return index < 0 ? [] : [{ ...binding, effect: index }];
		});
	}
	return next;
}

/** Role choices come from the same Rust structural catalog as Layers. */
export function postRoleChoices(sceneParameters: PostRecord): string[] {
	const layers = postObject(sceneParameters.layers),
		parameters = postObject(layers?.parameters),
		items = postObject(parameters?.items),
		item = postObject(items?.items),
		properties = postObject(item?.properties),
		roles = postObject(properties?.roles),
		role = postObject(roles?.items),
		options = role?.options;
	return Array.isArray(options) &&
		options.every((value) => typeof value === "string")
		? options
		: [];
}

export function newPostGroup({
	stage,
	roles,
	effect,
	postStages,
	roleChoices,
}: {
	stage: string;
	roles: string[];
	effect: PostRecord;
	postStages: PostRecord;
	roleChoices: string[];
}): PostRecord | undefined {
	if (
		!Array.isArray(postStages.supported) ||
		!postStages.supported.includes(stage) ||
		(stage !== "role" && stage !== "composite") ||
		new Set(roles).size !== roles.length ||
		roles.some((role) => !roleChoices.includes(role)) ||
		(stage === "role" ? !roles.length : roles.length !== 0)
	)
		return undefined;
	return { stage, ...(stage === "role" ? { roles } : {}), effects: [effect] };
}
