import { recipeParameterValueFits } from "./programmatic-recipe-parameter-schema";

export type PostRecord = Record<string, unknown>;
export const postObject = (value: unknown): PostRecord | undefined =>
	value && typeof value === "object" && !Array.isArray(value)
		? (value as PostRecord)
		: undefined;

/** Adapt catalog spelling for presentation only; no inferred domains/defaults. */
export function postParameterRule(
	value: unknown,
	depth = 0,
): PostRecord | undefined {
	const rule = postObject(value);
	if (!rule || depth > 4) return undefined;
	if (rule.type === "integer")
		return { ...rule, type: "number", integer: true };
	if (rule.type === "rgb") return { ...rule, type: "rgba" };
	if (rule.type === "enum")
		return Array.isArray(rule.values)
			? { ...rule, options: rule.values }
			: rule;
	if (rule.type === "array") {
		const items = postParameterRule(rule.items, depth + 1);
		return items ? { ...rule, items } : undefined;
	}
	if (rule.type === "tuple" && Array.isArray(rule.items)) {
		const items = rule.items.map((item) => postParameterRule(item, depth + 1));
		return items.every(Boolean) ? { ...rule, items } : undefined;
	}
	if (rule.type === "object") {
		const properties = postObject(rule.properties);
		if (!properties) return undefined;
		const entries = Object.entries(properties).map(([key, child]) => [
			key,
			postParameterRule(child, depth + 1),
		]);
		return entries.every(([, child]) => !!child)
			? { ...rule, properties: Object.fromEntries(entries) }
			: undefined;
	}
	return rule;
}

export function postEffectParameters(
	effect: PostRecord,
	finishing: PostRecord,
): PostRecord | undefined {
	if (typeof effect.kind !== "string") return undefined;
	return postObject(postObject(finishing[effect.kind])?.parameters);
}

export function postEffectFits(
	effect: PostRecord,
	catalog: PostRecord,
): boolean {
	return Object.entries(catalog).every(([key, value]) => {
		const rule = postParameterRule(value);
		return (
			!!rule &&
			(!Object.hasOwn(effect, key)
				? rule.required !== true
				: recipeParameterValueFits({ value: effect[key], rule }))
		);
	});
}

export function postKnownEffectsFit(
	effects: PostRecord[],
	finishing: PostRecord,
): boolean {
	return effects.every((effect) => {
		const parameters = postEffectParameters(effect, finishing);
		return !parameters || postEffectFits(effect, parameters);
	});
}

export function postDraft(text: string): PostRecord | undefined {
	try {
		const recipe = postObject(JSON.parse(text));
		if (!recipe || !Array.isArray(recipe.post)) return undefined;
		if (
			!recipe.post.every((value) => {
				const post = postObject(value);
				return (
					!!post &&
					Array.isArray(post.effects) &&
					post.effects.every((effect) => !!postObject(effect))
				);
			})
		)
			return undefined;
		return recipe;
	} catch {
		return undefined;
	}
}

export function editPostDraft(
	text: string,
	postIndex: number,
	next: PostRecord,
	disabled: boolean,
): string | undefined {
	const recipe = postDraft(text);
	if (
		disabled ||
		!recipe ||
		!Number.isSafeInteger(postIndex) ||
		postIndex < 0 ||
		postIndex >= (recipe.post as unknown[]).length
	)
		return undefined;
	return JSON.stringify(
		{
			...recipe,
			post: (recipe.post as unknown[]).map((post, index) =>
				index === postIndex ? next : post,
			),
		},
		null,
		2,
	);
}
