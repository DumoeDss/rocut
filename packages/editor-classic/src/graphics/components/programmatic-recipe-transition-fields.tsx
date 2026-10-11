import { RecipeParameterFields } from "./programmatic-recipe-parameter-fields";
import {
	editRecipeTransitionParameter,
	recipeTransitionNodes,
} from "./programmatic-recipe-transition-data";

/** Existing recipe draft only. Apply and Rust remain the admission boundary. */
export function ProgrammaticRecipeTransitionFields({
	id,
	text,
	transitionParameters,
	disabled,
	onEdit,
}: {
	id: string;
	text: string;
	transitionParameters: Record<string, unknown>;
	disabled: boolean;
	onEdit: (text: string) => void;
}) {
	return recipeTransitionNodes({ text, transitionParameters }).map((node) => {
		const fields = RecipeParameterFields({
			id: `${id}-transition-${node.index}`,
			value: node.style,
			catalog: node.catalog,
			disabled,
			onChange: (next) => {
				if (disabled) return;
				const changed = Object.keys(node.catalog).filter(
					(key) => next[key] !== node.style[key],
				);
				if (changed.length !== 1) return;
				const key = changed[0];
				const edited = editRecipeTransitionParameter({
					text,
					transitionParameters,
					index: node.index,
					key,
					value: next[key],
				});
				if (edited !== undefined) onEdit(edited);
			},
		});
		if (!fields.length) return null;
		return (
			<fieldset
				key={node.index}
				disabled={disabled}
				data-testid={`recipe-transition-${node.index}`}
				className="flex min-w-0 flex-col gap-2 rounded border p-2"
			>
				<legend className="px-1 text-xs">
					{node.kind} / {String(node.nodeId ?? node.index)}
				</legend>
				{fields}
			</fieldset>
		);
	});
}
