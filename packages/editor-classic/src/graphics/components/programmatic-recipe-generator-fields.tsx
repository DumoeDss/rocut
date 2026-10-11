import {
	recipeObject,
	RecipeParameterFields,
} from "./programmatic-recipe-parameter-fields";

/** Catalog presentation only; the existing JSON draft and Apply own admission. */
export function ProgrammaticRecipeGeneratorFields({
	id,
	text,
	generators,
	disabled,
	onEdit,
}: {
	id: string;
	text: string;
	generators: Record<string, unknown>;
	disabled: boolean;
	onEdit: (text: string) => void;
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
					!Object.hasOwn(generators, scene.kind)
				)
					return null;
				const settings = recipeObject(scene.settings);
				const catalog = recipeObject(
					recipeObject(generators[scene.kind])?.parameters,
				);
				if (!settings || !catalog) return null;
				const fields = RecipeParameterFields({
					id: `${id}-generator-${index}`,
					value: settings,
					catalog,
					disabled,
					onChange: (next) => {
						if (disabled) return;
						onEdit(
							JSON.stringify(
								{
									...recipe,
									nodes: nodes.map((entry, position) =>
										position === index
											? { ...node, scene: { ...scene, settings: next } }
											: entry,
									),
								},
								null,
								2,
							),
						);
					},
				});
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
