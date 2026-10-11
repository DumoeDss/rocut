import type { ReactNode } from "react";
import { Button } from "../../components/ui/button";
import { Textarea } from "../../components/ui/textarea";
import { recipeParameterValueFits } from "./programmatic-recipe-parameter-schema";
import { recipeNewItemFields } from "./programmatic-recipe-new-item-fields";
import type { RecipeResourceChoices } from "./programmatic-recipe-resource-field";

/** Collection controls only edit the JSON draft. Rust Apply owns admission. */
export function RecipeArrayFields({
	id,
	label,
	value,
	rule,
	disabled,
	renderItem,
	onChange,
	resources = [],
	itemDepth = 0,
}: {
	id: string;
	label: string;
	value: unknown[];
	rule: Record<string, unknown>;
	disabled: boolean;
	renderItem: (value: unknown, index: number) => ReactNode;
	onChange: (value: unknown[]) => void;
	resources?: RecipeResourceChoices;
	itemDepth?: number;
}) {
	const item = rule.items as Record<string, unknown>;
	const minimum = typeof rule.minItems === "number" ? rule.minItems : 0;
	const maximum = typeof rule.maxItems === "number" ? rule.maxItems : Infinity;
	const explicitDefault =
		Object.hasOwn(item, "default") &&
		recipeParameterValueFits({ value: item.default, rule: item });
	let pending = "";
	let input: HTMLTextAreaElement | null = null;
	const authored = !explicitDefault
		? recipeNewItemFields({
				id: `${id}-authored`,
				label: `New ${label}`,
				rule: item,
				resources,
				depth: itemDepth,
				disabled: disabled || value.length >= maximum,
			})
		: undefined;
	const add = () => {
		if (disabled || value.length >= maximum) return;
		let next: unknown;
		try {
			next = explicitDefault
				? structuredClone(item.default)
				: JSON.parse(input?.value ?? pending);
			if (!recipeParameterValueFits({ value: next, rule: item }))
				throw Error(
					"Complete every item field using the catalog types and bounds.",
				);
		} catch {
			input?.setCustomValidity(
				"Enter a complete item as JSON using the catalog fields.",
			);
			input?.reportValidity();
			return;
		}
		input?.setCustomValidity("");
		onChange([...value, next]);
	};
	const move = (index: number, offset: number) => {
		const destination = index + offset;
		if (disabled || destination < 0 || destination >= value.length) return;
		const next = [...value];
		[next[index], next[destination]] = [next[destination], next[index]];
		onChange(next);
	};
	return (
		<div className="flex min-w-0 flex-col gap-2">
			{authored && (
				<fieldset
					disabled={disabled || value.length >= maximum}
					className="flex min-w-0 flex-col gap-2 rounded border p-2"
				>
					<legend>New {label} item</legend>
					{authored.fields}
					<p className="text-muted-foreground text-xs">
						Enter every field explicitly. Add only changes the draft; Apply
						validates the complete recipe.
					</p>
					<Button
						size="sm"
						variant="outline"
						aria-label={`Add authored ${label} item`}
						disabled={disabled || value.length >= maximum}
						onClick={() => {
							if (disabled || value.length >= maximum) return;
							const next = authored.read();
							if (!recipeParameterValueFits({ value: next, rule: item }))
								return;
							onChange([...value, next]);
						}}
					>
						Add authored item
					</Button>
				</fieldset>
			)}
			{value.map((entry, index) => (
				<div
					key={index}
					className="flex min-w-0 flex-col gap-1 rounded border p-2"
				>
					{renderItem(entry, index)}
					<div className="flex gap-2">
						<Button
							size="sm"
							variant="ghost"
							aria-label={`Move ${label}[${index}] up`}
							disabled={disabled || index === 0}
							onClick={() => move(index, -1)}
						>
							Move up
						</Button>
						<Button
							size="sm"
							variant="ghost"
							aria-label={`Move ${label}[${index}] down`}
							disabled={disabled || index === value.length - 1}
							onClick={() => move(index, 1)}
						>
							Move down
						</Button>
					</div>
					<Button
						size="sm"
						variant="ghost"
						aria-label={`Remove ${label}[${index}]`}
						disabled={disabled || value.length <= minimum}
						onClick={() => {
							if (!disabled && value.length > minimum)
								onChange(value.filter((_, position) => position !== index));
						}}
					>
						Remove item
					</Button>
				</div>
			))}
			{!explicitDefault && (
				<>
					<label htmlFor={`${id}-new`}>New {label} item JSON</label>
					{Array.isArray(item.required) && (
						<p className="text-muted-foreground">
							Required fields:{" "}
							{item.required
								.filter((key) => typeof key === "string")
								.join(", ")}
						</p>
					)}
					<Textarea
						id={`${id}-new`}
						aria-label={`New ${label} item JSON`}
						disabled={disabled || value.length >= maximum}
						spellCheck={false}
						ref={(element) => {
							input = element;
						}}
						onChange={(event) => {
							if (!disabled) {
								pending = event.target.value;
								event.target.setCustomValidity?.("");
							}
						}}
					/>
				</>
			)}
			<Button
				size="sm"
				variant="outline"
				aria-label={`Add ${label} item`}
				disabled={disabled || value.length >= maximum}
				onClick={add}
			>
				Add item
			</Button>
		</div>
	);
}
