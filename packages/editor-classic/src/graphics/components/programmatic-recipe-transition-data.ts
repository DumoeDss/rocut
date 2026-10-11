import {
	recipeParameterSchemaKnown,
	recipeParameterValueFits,
} from "./programmatic-recipe-parameter-schema";

type ObjectValue = Record<string, unknown>;
const object = (value: unknown): ObjectValue | undefined =>
	value && typeof value === "object" && !Array.isArray(value)
		? (value as ObjectValue)
		: undefined;

function recipeNodes(text: string) {
	try {
		const recipe = object(JSON.parse(text));
		return recipe && Array.isArray(recipe.nodes)
			? { recipe, nodes: recipe.nodes as unknown[] }
			: undefined;
	} catch {
		return undefined;
	}
}

/** Only existing Peel/Bend styles with known producer schemas get controls. */
export function recipeTransitionNodes({
	text,
	transitionParameters,
}: {
	text: string;
	transitionParameters: ObjectValue;
}) {
	const parsed = recipeNodes(text);
	if (!parsed) return [];
	return parsed.nodes.flatMap((value, index) => {
		const node = object(value),
			scene = object(node?.scene),
			style = object(scene?.style);
		if (
			scene?.kind !== "transition" ||
			!style ||
			(style.kind !== "peel" && style.kind !== "bend") ||
			!Object.hasOwn(transitionParameters, style.kind)
		)
			return [];
		const catalog = object(
			object(transitionParameters[style.kind])?.parameters,
		);
		if (
			!catalog ||
			!Object.keys(catalog).length ||
			Object.hasOwn(catalog, "kind") ||
			!Object.values(catalog).every((value) => {
				const rule = object(value);
				return !!rule && recipeParameterSchemaKnown({ rule });
			})
		)
			return [];
		return [{ index, nodeId: node?.id, kind: style.kind, style, catalog }];
	});
}

/** A draft-only field replacement: no node, style, or missing value is created. */
export function editRecipeTransitionParameter({
	text,
	transitionParameters,
	index,
	key,
	value,
}: {
	text: string;
	transitionParameters: ObjectValue;
	index: number;
	key: string;
	value: unknown;
}): string | undefined {
	const target = recipeTransitionNodes({ text, transitionParameters }).find(
		(node) => node.index === index,
	);
	if (
		!target ||
		!Object.hasOwn(target.style, key) ||
		!Object.hasOwn(target.catalog, key)
	)
		return undefined;
	const rule = object(target.catalog[key]);
	if (!rule || !recipeParameterValueFits({ rule, value })) return undefined;
	const parsed = recipeNodes(text);
	if (!parsed) return undefined;
	const node = object(parsed.nodes[index]),
		scene = object(node?.scene);
	if (!node || !scene) return undefined;
	return JSON.stringify(
		{
			...parsed.recipe,
			nodes: parsed.nodes.map((entry, position) =>
				position === index
					? {
							...node,
							scene: {
								...scene,
								style: { ...target.style, [key]: value },
							},
						}
					: entry,
			),
		},
		null,
		2,
	);
}
