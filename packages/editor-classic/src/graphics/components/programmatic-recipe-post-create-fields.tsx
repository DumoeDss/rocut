import { useState } from "react";
import { Button } from "../../components/ui/button";
import { recipeNewItemFields } from "./programmatic-recipe-new-item-fields";
import {
	newPostEffect,
	newPostEffectRule,
} from "./programmatic-recipe-post-collection-data";
import type { PostRecord } from "./programmatic-recipe-post-data";

export function ProgrammaticRecipePostCreateFields({
	id,
	label,
	effects,
	disabled,
	onAdd,
}: {
	id: string;
	label: string;
	effects: PostRecord;
	disabled: boolean;
	onAdd: (effect: PostRecord) => boolean;
}) {
	const [kind, setKind] = useState("");
	const [error, setError] = useState("");
	const choices = Object.keys(effects).filter(
		(name) => !!newPostEffectRule(name, effects),
	);
	const rule = newPostEffectRule(kind, effects);
	const authored = rule
		? recipeNewItemFields({ id: `${id}-${kind}`, label, rule, disabled })
		: undefined;
	return (
		<fieldset
			disabled={disabled}
			className="flex min-w-0 flex-col gap-2 rounded border p-2"
		>
			<legend className="px-1 text-xs">{label}</legend>
			<label htmlFor={`${id}-kind`} className="text-xs">
				Effect
			</label>
			<select
				id={`${id}-kind`}
				aria-label={`${label} kind`}
				value={kind}
				disabled={disabled}
				className="bg-input w-full rounded border p-1 text-xs"
				onChange={(event) => {
					if (!disabled) {
						setKind(event.target.value);
						setError("");
					}
				}}
			>
				<option value="">Choose effect</option>
				{choices.map((name) => (
					<option key={name} value={name}>
						{name}
					</option>
				))}
			</select>
			{authored && (
				<div key={kind} className="flex flex-col gap-2">
					{authored.fields}
				</div>
			)}
			<p className="text-muted-foreground text-xs">
				Fill required parameters explicitly. Add changes the draft; Apply saves
				it.
			</p>
			{error && (
				<p role="alert" className="text-destructive text-xs">
					{error}
				</p>
			)}
			<Button
				type="button"
				size="sm"
				variant="outline"
				aria-label={`Add ${label}`}
				disabled={disabled || !authored}
				onClick={() => {
					if (disabled || !authored) return;
					const effect = newPostEffect(kind, authored.read(), effects);
					if (!effect || !onAdd(effect)) {
						setError(
							"Complete required parameters using the catalog types and bounds.",
						);
						return;
					}
					setKind("");
					setError("");
				}}
			>
				Add effect
			</Button>
		</fieldset>
	);
}
