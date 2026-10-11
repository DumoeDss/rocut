import type { ReactNode } from "react";
import { Input } from "../../components/ui/input";
import { RecipeNewArrayFields } from "./programmatic-recipe-new-array-fields";
import { recipeParameterSchemaKnown } from "./programmatic-recipe-parameter-schema";
import {
	RecipeResourceField,
	type RecipeResourceChoices,
} from "./programmatic-recipe-resource-field";

type Rule = Record<string, unknown>;
const object = (value: unknown): Rule | undefined =>
	value && typeof value === "object" && !Array.isArray(value)
		? (value as Rule)
		: undefined;

/** Blank author inputs, never catalog suggestions or inferred event values. */
export function recipeNewItemFields({
	id,
	label,
	rule,
	disabled,
	depth = 0,
	resources = [],
}: {
	id: string;
	label: string;
	rule: Rule;
	disabled: boolean;
	depth?: number;
	resources?: RecipeResourceChoices;
}): { fields: ReactNode; read: () => unknown } | undefined {
	if (depth > 4) return undefined;
	if (rule.type === "array" && recipeParameterSchemaKnown({ rule, depth })) {
		let read: (() => unknown) | undefined;
		return {
			fields: (
				<fieldset key={id} className="flex flex-col gap-2">
					<legend>{label}</legend>
					<RecipeNewArrayFields
						id={id}
						label={label}
						rule={rule}
						disabled={disabled}
						resources={resources}
						depth={depth}
						registerRead={(next) => {
							read = next;
						}}
					/>
				</fieldset>
			),
			read: () => read?.(),
		};
	}
	if (rule.type === "object") {
		const properties = object(rule.properties);
		if (!properties) return undefined;
		const keys = Object.keys(properties);
		const required = Array.isArray(rule.required) ? rule.required : keys;
		const children = keys.map((key) => {
			if (typeof key !== "string") return undefined;
			const child = object(properties[key]);
			return {
				key,
				editor: child
					? recipeNewItemFields({
							id: `${id}-${key}`,
							label: `${label}.${key}`,
							rule: child,
							disabled,
							depth: depth + 1,
							resources,
						})
					: undefined,
			};
		});
		if (
			!children.length ||
			children.some((child) => !child?.editor && required.includes(child?.key))
		)
			return undefined;
		const supported = children.filter((child) => child?.editor);
		return {
			fields: supported.map((child) => child!.editor!.fields),
			read: () => {
				const entries = supported
					.map((child) => [child!.key, child!.editor!.read()] as const)
					.filter(([, value]) => value !== undefined);
				return entries.length ? Object.fromEntries(entries) : undefined;
			},
		};
	}
	if (rule.type === "tuple" || rule.type === "rgba") {
		const rules =
			rule.type === "tuple"
				? rule.items
				: typeof rule.length === "number" && rule.length <= 16
					? Array.from({ length: rule.length }, () => ({
							...rule,
							type: "number",
						}))
					: undefined;
		if (!Array.isArray(rules)) return undefined;
		const children = rules.map((item, index) => {
			const child = object(item);
			return (
				child &&
				recipeNewItemFields({
					id: `${id}-${index}`,
					label: `${label}[${index}]`,
					rule: child,
					disabled,
					depth: depth + 1,
					resources,
				})
			);
		});
		if (children.some((child) => !child)) return undefined;
		return {
			fields: children.map((child) => child!.fields),
			read: () => {
				const entries = children.map((child) => child!.read());
				return entries.some((value) => value !== undefined)
					? entries
					: undefined;
			},
		};
	}
	if (
		rule.type === "resource" &&
		(rule.kind === "image" || rule.kind === "font")
	) {
		let selected: string | undefined;
		const control = RecipeResourceField({
			id,
			value: "",
			kind: rule.kind,
			resources,
			disabled,
			onChange: (value) => {
				selected = value;
			},
		});
		// Keep the existing constrained resource selector while reading its retained
		// DOM value after parent rerenders, just like the primitive author inputs.
		let input: HTMLSelectElement | null = null;
		const fields = (
			<label key={id} htmlFor={id} className="flex flex-col gap-1 text-xs">
				{label}
				<select
					{...control.props}
					ref={(element) => {
						input = element;
					}}
					value={undefined}
					defaultValue=""
				/>
			</label>
		);
		return {
			fields,
			read: () => {
				const value = input?.value ?? selected;
				return value &&
					resources.some(
						(resource) => resource.kind === rule.kind && resource.id === value,
					)
					? value
					: undefined;
			},
		};
	}
	if (
		!["number", "string", "text", "boolean", "enum"].includes(String(rule.type))
	)
		return undefined;
	let pending = "";
	let touched = false;
	let input: HTMLInputElement | HTMLSelectElement | null = null;
	const options = rule.type === "boolean" ? [false, true] : rule.options;
	const choice = rule.type === "boolean" || rule.type === "enum";
	if (
		choice &&
		(!Array.isArray(options) ||
			options.some(
				(value) => !["string", "number", "boolean"].includes(typeof value),
			))
	)
		return undefined;
	const control = choice ? (
		<select
			id={id}
			aria-label={label}
			defaultValue=""
			disabled={disabled}
			ref={(element) => {
				input = element;
			}}
			onChange={(event) => {
				if (!disabled) {
					pending = event.target.value;
					touched = true;
					if (event.target.dataset) event.target.dataset.authored = "true";
				}
			}}
			className="bg-input rounded border p-1 text-xs"
		>
			<option value="">Choose explicitly</option>
			{(options as unknown[]).map((value, index) => (
				<option key={index} value={String(index)}>
					{String(value)}
				</option>
			))}
		</select>
	) : (
		<Input
			id={id}
			aria-label={label}
			type={rule.type === "number" ? "number" : "text"}
			disabled={disabled}
			min={typeof rule.min === "number" ? rule.min : undefined}
			max={typeof rule.max === "number" ? rule.max : undefined}
			step={rule.integer === true ? 1 : "any"}
			ref={(element) => {
				input = element;
			}}
			onChange={(event) => {
				if (!disabled) {
					pending = event.target.value;
					touched = true;
					if (event.target.dataset) event.target.dataset.authored = "true";
				}
			}}
		/>
	);
	return {
		fields: (
			<label key={id} className="flex flex-col gap-1 text-xs" htmlFor={id}>
				{label}
				{control}
			</label>
		),
		read: () => {
			const text = input?.value ?? pending;
			if (choice)
				return text === "" ? undefined : (options as unknown[])[Number(text)];
			if (rule.type === "number") return text.trim() ? Number(text) : undefined;
			return touched || input?.dataset.authored === "true" ? text : undefined;
		},
	};
}
