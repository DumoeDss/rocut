import { useState } from "react";
import { RecipeArrayFields } from "./programmatic-recipe-array-fields";
import { RecipeParameterFields } from "./programmatic-recipe-parameter-fields";
import type { RecipeResourceChoices } from "./programmatic-recipe-resource-field";

/** A nested collection stays local until its complete parent item is added. */
export function RecipeNewArrayFields({
	id,
	label,
	rule,
	disabled,
	resources,
	depth,
	registerRead,
}: {
	id: string;
	label: string;
	rule: Record<string, unknown>;
	disabled: boolean;
	resources: RecipeResourceChoices;
	depth: number;
	registerRead: (read: () => unknown) => void;
}) {
	const [draft, setDraft] = useState<{ value: unknown[]; touched: boolean }>({
		value: [],
		touched: false,
	});
	registerRead(() => (draft.touched ? draft.value : undefined));
	return RecipeArrayFields({
		id,
		label,
		value: draft.value,
		rule,
		disabled,
		resources,
		itemDepth: depth + 1,
		onChange: (value) => {
			if (!disabled) setDraft({ value, touched: true });
		},
		renderItem: (value, index) =>
			RecipeParameterFields({
				id: `${id}-${index}`,
				value: { item: value },
				catalog: { item: rule.items },
				disabled,
				resources,
				depth: depth + 1,
				onChange: (next) => {
					if (!disabled)
						setDraft({
							value: draft.value.map((entry, position) =>
								position === index ? next.item : entry,
							),
							touched: true,
						});
				},
			}),
	});
}
