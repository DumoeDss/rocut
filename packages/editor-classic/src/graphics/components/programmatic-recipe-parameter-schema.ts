type Rule = Record<string, unknown>;
const object = (value: unknown): Rule | undefined =>
	value && typeof value === "object" && !Array.isArray(value)
		? (value as Rule)
		: undefined;

/** Known catalog shapes only. Suggested values never become defaults. */
export function recipeParameterSchemaKnown({
	rule,
	depth = 0,
}: {
	rule: Rule;
	depth?: number;
}): boolean {
	if (depth > 4) return false;
	if (
		["number", "string", "text", "boolean", "rgba"].includes(String(rule.type))
	)
		return true;
	if (rule.type === "enum") return Array.isArray(rule.options);
	if (rule.type === "tuple")
		return (
			Array.isArray(rule.items) &&
			rule.items.every((item) => {
				const child = object(item);
				return (
					!!child &&
					recipeParameterSchemaKnown({ rule: child, depth: depth + 1 })
				);
			})
		);
	if (rule.type === "array") {
		const child = object(rule.items);
		return (
			!!child && recipeParameterSchemaKnown({ rule: child, depth: depth + 1 })
		);
	}
	if (rule.type === "resource")
		return rule.kind === "image" || rule.kind === "font";
	if (rule.type === "object") {
		const properties = object(rule.properties);
		return (
			!!properties &&
			Object.keys(properties).length > 0 &&
			Object.values(properties).every((item) => {
				const child = object(item);
				return (
					!!child &&
					recipeParameterSchemaKnown({ rule: child, depth: depth + 1 })
				);
			})
		);
	}
	return false;
}

/** Add requires a complete user entry or explicit default, not inferred values. */
export function recipeParameterValueFits({
	value,
	rule,
	depth = 0,
}: {
	value: unknown;
	rule: Rule;
	depth?: number;
}): boolean {
	if (depth > 4) return false;
	if (rule.type === "number")
		return (
			typeof value === "number" &&
			Number.isFinite(value) &&
			(rule.integer !== true || Number.isInteger(value)) &&
			(typeof rule.min !== "number" || value >= rule.min) &&
			(typeof rule.max !== "number" || value <= rule.max)
		);
	if (rule.type === "string" || rule.type === "text")
		return (
			typeof value === "string" &&
			(typeof rule.minLength !== "number" || value.length >= rule.minLength) &&
			(typeof rule.maxLength !== "number" || value.length <= rule.maxLength)
		);
	if (rule.type === "boolean") return typeof value === "boolean";
	if (rule.type === "enum")
		return Array.isArray(rule.options) && rule.options.includes(value);
	if (rule.type === "rgba")
		return (
			Array.isArray(value) &&
			value.length === rule.length &&
			value.every((entry) =>
				recipeParameterValueFits({
					value: entry,
					rule: { ...rule, type: "number" },
					depth: depth + 1,
				}),
			)
		);
	if (rule.type === "tuple")
		return (
			Array.isArray(value) &&
			Array.isArray(rule.items) &&
			value.length === rule.items.length &&
			rule.items.every((item, index) => {
				const child = object(item);
				return (
					!!child &&
					recipeParameterValueFits({
						value: value[index],
						rule: child,
						depth: depth + 1,
					})
				);
			})
		);
	if (rule.type === "array") {
		const child = object(rule.items);
		return (
			!!child &&
			Array.isArray(value) &&
			(typeof rule.minItems !== "number" || value.length >= rule.minItems) &&
			(typeof rule.maxItems !== "number" || value.length <= rule.maxItems) &&
			value.every((entry) =>
				recipeParameterValueFits({
					value: entry,
					rule: child,
					depth: depth + 1,
				}),
			)
		);
	}
	const properties = object(rule.properties),
		entry = object(value);
	if (rule.type === "resource")
		return (
			typeof value === "string" &&
			(rule.kind === "image" || rule.kind === "font")
		);
	if (rule.type === "object" && properties && entry) {
		const required = Array.isArray(rule.required)
			? rule.required
			: Object.keys(properties);
		return (
			required.every(
				(key) => typeof key === "string" && Object.hasOwn(entry, key),
			) &&
			(rule.additionalProperties !== false ||
				Object.keys(entry).every((key) => Object.hasOwn(properties, key))) &&
			Object.entries(properties).every(([key, item]) => {
				const child = object(item);
				return (
					!Object.hasOwn(entry, key) ||
					(!!child &&
						recipeParameterValueFits({
							value: entry[key],
							rule: child,
							depth: depth + 1,
						}))
				);
			})
		);
	}
	return false;
}
