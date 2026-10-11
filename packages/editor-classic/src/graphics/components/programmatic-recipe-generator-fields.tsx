import {
	recipeObject,
	RecipeParameterFields,
} from "./programmatic-recipe-parameter-fields";
import type { RecipeResourceChoices } from "./programmatic-recipe-resource-field";

/** Catalog presentation only; the existing JSON draft and Apply own admission. */
export function ProgrammaticRecipeGeneratorFields({
	id,
	text,
	generators,
	disabled,
	onEdit,
	resources = [],
	sceneParameters = {},
}: {
	id: string;
	text: string;
	generators: Record<string, unknown>;
	disabled: boolean;
	onEdit: (text: string) => void;
	resources?: RecipeResourceChoices;
	sceneParameters?: Record<string, unknown>;
}) {
	let recipe;
	try {
		recipe = recipeObject(JSON.parse(text));
	} catch {
		return null;
	}
	if (!recipe || !Array.isArray(recipe.nodes)) return null;
	const nodes = recipe.nodes;
	return (
		<>
			{nodes.map((value, index) => {
				const node = recipeObject(value),
					scene = recipeObject(node?.scene);
				if (
					!scene ||
					typeof scene.kind !== "string" ||
					(!Object.hasOwn(generators, scene.kind) &&
						!Object.hasOwn(sceneParameters, scene.kind))
				)
					return null;
				const settings = recipeObject(scene.settings);
				const catalog = recipeObject(
					recipeObject(generators[scene.kind])?.parameters,
				);
				const editScene = (next: Record<string, unknown>) => {
					if (disabled) return;
					onEdit(
						JSON.stringify(
							{
								...recipe,
								nodes: nodes.map((entry, position) =>
									position === index ? { ...node, scene: next } : entry,
								),
							},
							null,
							2,
						),
					);
				};
				const fields =
					settings && catalog
						? RecipeParameterFields({
								id: `${id}-generator-${index}`,
								value: settings,
								catalog,
								disabled,
								resources,
								onChange: (next) => editScene({ ...scene, settings: next }),
							})
						: [];
				const topLevel = recipeObject(
					recipeObject(sceneParameters[scene.kind])?.parameters,
				);
				if (topLevel)
					fields.push(
						...RecipeParameterFields({
							id: `${id}-scene-${index}`,
							value: scene,
							catalog: topLevel,
							disabled,
							resources,
							onChange: editScene,
						}),
					);
				if (!fields.length) return null;
				return (
					<fieldset
						key={index}
						disabled={disabled}
						className="flex min-w-0 flex-col gap-2 rounded border p-2"
					>
						<legend className="px-1 text-xs">
							{scene.kind} / {String(node?.id ?? index)}
						</legend>
						{fields}
					</fieldset>
				);
			})}
		</>
	);
}
