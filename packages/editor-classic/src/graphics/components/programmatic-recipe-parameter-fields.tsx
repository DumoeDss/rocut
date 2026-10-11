import type { ReactNode } from "react";
import { Input } from "../../components/ui/input";
import { Textarea } from "../../components/ui/textarea";
import { RecipeArrayFields } from "./programmatic-recipe-array-fields";
import { recipeParameterSchemaKnown } from "./programmatic-recipe-parameter-schema";
import {
	RecipeResourceField,
	type RecipeResourceChoices,
} from "./programmatic-recipe-resource-field";

type ObjectValue = Record<string, unknown>;
export function recipeObject(value: unknown): ObjectValue | undefined {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as ObjectValue)
		: undefined;
}

/** Unknown schemas and mismatched values remain in the complete JSON editor. */
function parameter({
	id,
	label,
	value,
	rule,
	disabled,
	change,
	depth = 0,
	resources = [],
}: {
	id: string;
	label: string;
	value: unknown;
	rule: ObjectValue;
	disabled: boolean;
	change: (value: unknown) => void;
	depth?: number;
	resources?: RecipeResourceChoices;
}): ReactNode {
	if (depth > 4) return null;
	const update = (next: unknown) => {
		if (!disabled) change(next);
	};
	let control: ReactNode;
	if (
		rule.type === "number" &&
		typeof value === "number" &&
		Number.isFinite(value)
	) {
		control = (
			<Input
				id={id}
				type="number"
				disabled={disabled}
				value={value}
				min={typeof rule.min === "number" ? rule.min : undefined}
				max={typeof rule.max === "number" ? rule.max : undefined}
				step={rule.integer === true ? 1 : "any"}
				onChange={(event) => {
					const next = event.target.valueAsNumber;
					if (
						!event.target.value.trim() ||
						!Number.isFinite(next) ||
						(rule.integer === true && !Number.isInteger(next))
					)
						return;
					if (
						(typeof rule.min === "number" && next < rule.min) ||
						(typeof rule.max === "number" && next > rule.max)
					)
						return;
					update(next);
				}}
			/>
		);
	} else if (
		(rule.type === "text" || rule.type === "string") &&
		typeof value === "string"
	) {
		control = (
			<Textarea
				id={id}
				disabled={disabled}
				value={value}
				spellCheck={false}
				onChange={(event) => update(event.target.value)}
			/>
		);
	} else if (
		rule.type === "resource" &&
		typeof value === "string" &&
		(rule.kind === "image" || rule.kind === "font")
	) {
		control = RecipeResourceField({
			id,
			value,
			kind: rule.kind,
			resources,
			disabled,
			onChange: update,
		});
	} else if (rule.type === "boolean" && typeof value === "boolean") {
		control = (
			<input
				id={id}
				type="checkbox"
				disabled={disabled}
				checked={value}
				onChange={(event) => update(event.target.checked)}
			/>
		);
	} else if (rule.type === "enum" && Array.isArray(rule.options)) {
		const options = rule.options.filter(
			(item): item is string | number | boolean =>
				(typeof item === "string" ||
					typeof item === "boolean" ||
					(typeof item === "number" && Number.isFinite(item))) &&
				typeof item === typeof value,
		);
		if (!options.length) return null;
		control = (
			<select
				id={id}
				disabled={disabled}
				value={String(value)}
				className="bg-input rounded border p-1 text-xs"
				onChange={(event) => {
					const next = options.find(
						(item) => String(item) === event.target.value,
					);
					if (next !== undefined) update(next);
				}}
			>
				{!options.includes(value as string | number | boolean) && (
					<option value={String(value)}>{String(value)}</option>
				)}
				{options.map((item) => (
					<option key={String(item)} value={String(item)}>
						{String(item)}
					</option>
				))}
			</select>
		);
	} else if (
		rule.type === "rgba" &&
		Array.isArray(value) &&
		typeof rule.length === "number" &&
		value.length === rule.length
	) {
		control = value.map((entry, index) =>
			parameter({
				id: `${id}-${index}`,
				label: `${label}[${index}]`,
				value: entry,
				rule: { ...rule, type: "number" },
				disabled,
				depth: depth + 1,
				resources,
				change: (next) =>
					update(
						value.map((item, position) => (position === index ? next : item)),
					),
			}),
		);
	} else if (
		rule.type === "tuple" &&
		Array.isArray(rule.items) &&
		Array.isArray(value) &&
		rule.items.length === value.length
	) {
		control = rule.items.map((item, index) => {
			const child = recipeObject(item);
			return child
				? parameter({
						id: `${id}-${index}`,
						label: `${label}[${index}]`,
						value: value[index],
						rule: child,
						disabled,
						depth: depth + 1,
						resources,
						change: (next) =>
							update(
								value.map((entry, position) =>
									position === index ? next : entry,
								),
							),
					})
				: null;
		});
	} else if (
		rule.type === "array" &&
		Array.isArray(value) &&
		recipeParameterSchemaKnown({ rule, depth })
	) {
		control = RecipeArrayFields({
			id,
			label,
			value,
			rule,
			disabled,
			resources,
			itemDepth: depth + 1,
			onChange: update,
			renderItem: (entry, index) =>
				parameter({
					id: `${id}-${index}`,
					label: `${label}[${index}]`,
					value: entry,
					rule: rule.items as ObjectValue,
					disabled,
					depth: depth + 1,
					resources,
					change: (next) =>
						update(
							value.map((item, position) => (position === index ? next : item)),
						),
				}),
		});
	} else if (
		rule.type === "object" &&
		recipeObject(rule.properties) &&
		recipeObject(value)
	) {
		control = RecipeParameterFields({
			id,
			value: value as ObjectValue,
			catalog: rule.properties as ObjectValue,
			disabled,
			depth: depth + 1,
			resources,
			onChange: update,
		});
	} else return null;
	return (
		<div key={id} className="flex min-w-0 flex-col gap-1 text-xs">
			<label htmlFor={id}>{label}</label>
			{control}
		</div>
	);
}

export function RecipeParameterFields({
	id,
	value,
	catalog,
	disabled,
	onChange,
	depth = 0,
	resources = [],
}: {
	id: string;
	value: ObjectValue;
	catalog: ObjectValue;
	disabled: boolean;
	onChange: (value: ObjectValue) => void;
	depth?: number;
	resources?: RecipeResourceChoices;
}) {
	return Object.entries(catalog).flatMap(([key, metadata]) => {
		const rule = recipeObject(metadata);
		if (!rule || !Object.hasOwn(value, key)) return [];
		const field = parameter({
			id: `${id}-${key}`,
			label: key,
			value: value[key],
			rule,
			disabled,
			depth,
			resources,
			change: (next) => onChange({ ...value, [key]: next }),
		});
		return field ? [field] : [];
	});
}
