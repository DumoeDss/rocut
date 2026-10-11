import type { ProgrammaticResource } from "@opencut/editor-contracts";

export type RecipeResourceChoices = readonly Pick<
	ProgrammaticResource,
	"id" | "kind"
>[];

/** Select existing declarations only; no import, repair or default selection. */
export function RecipeResourceField({
	id,
	value,
	kind,
	resources,
	disabled,
	onChange,
}: {
	id: string;
	value: string;
	kind: "image" | "font";
	resources: RecipeResourceChoices;
	disabled: boolean;
	onChange: (value: string) => void;
}) {
	const choices = [
		...new Set(
			resources
				.filter((resource) => resource.kind === kind)
				.map((resource) => resource.id),
		),
	];
	return (
		<select
			id={id}
			value={value}
			disabled={disabled}
			className="bg-input rounded border p-1 text-xs"
			onChange={(event) => {
				if (!disabled && choices.includes(event.target.value))
					onChange(event.target.value);
			}}
		>
			{!choices.includes(value) && (
				<option value={value}>
					{value || "(empty)"} (unresolved {kind})
				</option>
			)}
			{choices.map((choice) => (
				<option key={choice} value={choice}>
					{choice}
				</option>
			))}
		</select>
	);
}
