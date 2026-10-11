import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { isValidElement, type ReactNode } from "react";
import { ProgrammaticRecipeFields } from "./programmatic-recipe-fields";
import { ProgrammaticRecipeDraft } from "./programmatic-recipe-draft";
import { recipeSource } from "./programmatic-recipe-fixture";
import { ProgrammaticRecipeGeneratorFields } from "./programmatic-recipe-generator-fields";

interface FieldProps {
	children?: ReactNode;
	id?: string;
	"aria-label"?: string;
	onChange?: (event: {
		target: { value: string; valueAsNumber?: number; checked?: boolean };
	}) => void;
	onClick?: () => void;
}

test("scan generator controls edit the same JSON draft and preserve graph metadata", async () => {
	for (const kind of ["asciiSweep", "particleScroll"] as const) {
		const settings =
			kind === "asciiSweep"
				? {
						textA: "Before",
						textB: "After",
						glyphs: "01",
						fontSize: 20,
						bandWidth: 0.2,
						opacity: 0.75,
						direction: "leftToRight",
					}
				: {
						columns: 4,
						rows: 2,
						band: 0.25,
						scatter: 0.8,
						spin: 1,
						opacity: 0.75,
						fit: "contain",
						direction: "left-to-right",
					};
		const source = {
			...recipeSource,
			recipe: {
				...recipeSource.recipe!,
				nodes: [
					{
						id: "scan",
						scene: {
							kind,
							role: "graphics",
							settings,
							span: { startFrame: 4, durationFrames: 24 },
							easing: "linear",
						},
					},
				],
			},
		} as typeof recipeSource;
		const draft = new ProgrammaticRecipeDraft(source);
		const generators = {
			[kind]: {
				parameters: {
					opacity: { type: "number", min: 0, max: 1, integer: false },
					direction: { type: "enum", options: [settings.direction] },
				},
			},
		};
		const fields = (disabled = false) =>
			ProgrammaticRecipeGeneratorFields({
				id: "scan",
				text: draft.getSnapshot().text,
				generators,
				disabled,
				onEdit: (text) => draft.edit(text),
			});
		const input = findField({
			node: fields(),
			label: "scan-generator-0-opacity",
		});
		if (!input?.onChange) throw Error("Scan opacity input missing");
		input.onChange({ target: { value: "0.4", valueAsNumber: 0.4 } });
		const changed = JSON.parse(draft.getSnapshot().text);
		expect(changed.nodes[0]).toEqual({
			...source.recipe!.nodes[0],
			scene: {
				...source.recipe!.nodes[0].scene,
				settings: { ...settings, opacity: 0.4 },
			},
		});
		expect(draft.getSnapshot().dirty).toBe(true);
		findField({
			node: fields(true),
			label: "scan-generator-0-opacity",
		})?.onChange?.({ target: { value: "0.9", valueAsNumber: 0.9 } });
		expect(
			JSON.parse(draft.getSnapshot().text).nodes[0].scene.settings.opacity,
		).toBe(0.4);
		await draft.apply(async (submitted) => ({
			...submitted.baseline,
			recipe: JSON.parse(submitted.text),
		}));
		expect(draft.getSnapshot().baseline.resources).toBe(source.resources);
		expect(draft.getSnapshot().dirty).toBe(false);
		draft.refresh(source);
		expect(
			JSON.parse(draft.getSnapshot().text).nodes[0].scene.settings.opacity,
		).toBe(0.75);
	}
	expect(
		ProgrammaticRecipeGeneratorFields({
			id: "broken",
			text: "{broken",
			generators: {},
			disabled: false,
			onEdit: () => {
				throw Error("Invalid draft must be retained");
			},
		}),
	).toBeNull();
});
test("catalog controls preserve neighbors and types for registered and future generators", () => {
	for (const kind of [
		"grid",
		"hexFloat",
		"shatter",
		"cloth",
		"particleReveal",
		"glyphRain",
		"futureGenerator",
	]) {
		const number = { type: "number", min: 0, max: 10, integer: true };
		const settings = {
			count: 2,
			title: "old",
			enabled: false,
			mode: "a",
			rect: [1, 2],
			vector: { x: 3, unknown: 9 },
			image: { id: "asset" },
			unknown: "keep",
		};
		let text = JSON.stringify({
			metadata: "keep",
			nodes: [
				{ id: "g", scene: { kind, settings, span: { durationFrames: 10 } } },
				{ id: "neighbor" },
			],
		});
		const generators = {
			[kind]: {
				parameters: {
					count: number,
					title: { type: "string" },
					enabled: { type: "boolean" },
					mode: { type: "enum", options: ["a", "b"] },
					rect: { type: "tuple", items: [number, number] },
					vector: { type: "object", properties: { x: number } },
					image: { type: "resource" },
					absent: number,
				},
			},
		};
		const fields = (disabled = false) =>
			ProgrammaticRecipeGeneratorFields({
				id: "catalog",
				text,
				generators,
				disabled,
				onEdit: (next) => {
					text = next;
				},
			});
		const edit = (
			key: string,
			value: string,
			valueAsNumber?: number,
			checked?: boolean,
			disabled = false,
		) => {
			const field = findField({
				node: fields(disabled),
				label: `catalog-generator-0-${key}`,
			});
			if (!field?.onChange) throw Error(`Missing ${kind}.${key}`);
			field.onChange({ target: { value, valueAsNumber, checked } });
		};
		for (const value of [NaN, Infinity, -1, 11, 1.5])
			edit("count", String(value), value);
		edit("count", "", 0);
		expect(JSON.parse(text).nodes[0].scene.settings.count).toBe(2);
		edit("count", "4", 4);
		edit("title", "new");
		edit("enabled", "on", undefined, true);
		edit("mode", "b");
		edit("mode", "invalid");
		edit("rect-1", "5", 5);
		edit("vector-x", "6", 6);
		const beforeDisabled = text;
		edit("title", "blocked", undefined, undefined, true);
		expect(text).toBe(beforeDisabled);
		expect(JSON.parse(text)).toEqual({
			metadata: "keep",
			nodes: [
				{
					id: "g",
					scene: {
						kind,
						span: { durationFrames: 10 },
						settings: {
							...settings,
							count: 4,
							title: "new",
							enabled: true,
							mode: "b",
							rect: [1, 5],
							vector: { x: 6, unknown: 9 },
						},
					},
				},
				{ id: "neighbor" },
			],
		});
		for (const key of ["image", "absent", "unknown"])
			expect(
				findField({ node: fields(), label: `catalog-generator-0-${key}` }),
			).toBeUndefined();
	}
});

test("catalog tuple, RGBA and numeric enums retain their authored types", () => {
	const settings = {
		wind: [0.3, 0, 0.8],
		color: [0, 1, 0.4, 1],
		numericMode: 1,
		malformed: "number expected",
		events: [{ atTicks: 2 }],
	};
	let text = JSON.stringify({
		nodes: [{ scene: { kind: "cloth", settings } }],
	});
	const number = { type: "number", min: -2, max: 2 };
	const generators = {
		cloth: {
			parameters: {
				wind: { type: "tuple", items: [number, number, number] },
				color: { type: "rgba", length: 4, min: 0, max: 1 },
				numericMode: { type: "enum", options: [1, 2] },
				malformed: number,
				events: { type: "array", items: { type: "object" } },
			},
		},
	};
	const fields = () =>
		ProgrammaticRecipeGeneratorFields({
			id: "typed",
			text,
			generators,
			disabled: false,
			onEdit: (next) => {
				text = next;
			},
		});
	findField({ node: fields(), label: "typed-generator-0-wind-2" })?.onChange?.({
		target: { value: "-1", valueAsNumber: -1 },
	});
	findField({ node: fields(), label: "typed-generator-0-color-1" })?.onChange?.(
		{ target: { value: "0.5", valueAsNumber: 0.5 } },
	);
	findField({
		node: fields(),
		label: "typed-generator-0-numericMode",
	})?.onChange?.({ target: { value: "2" } });
	expect(JSON.parse(text).nodes[0].scene.settings).toEqual({
		...settings,
		wind: [0.3, 0, -1],
		color: [0, 0.5, 0.4, 1],
		numericMode: 2,
	});
	for (const key of ["malformed", "events"])
		expect(
			findField({ node: fields(), label: `typed-generator-0-${key}` }),
		).toBeUndefined();
});

function findField({
	node,
	label,
}: {
	node: ReactNode;
	label: string;
}): FieldProps | undefined {
	if (Array.isArray(node)) {
		for (const child of node) {
			const found = findField({ node: child, label });
			if (found) return found;
		}
	} else if (isValidElement<FieldProps>(node)) {
		if (node.props.id === label || node.props["aria-label"] === label)
			return node.props;
		return findField({ node: node.props.children, label });
	}
	return undefined;
}

test("actual recipe fields wire edit, Apply and Discard to the retained draft", async () => {
	const draft = new ProgrammaticRecipeDraft(recipeSource);
	let applied = 0;
	const fields = () =>
		ProgrammaticRecipeFields({
			id: "recipe",
			state: draft.getSnapshot(),
			readOnly: null,
			conflict: false,
			onEdit: (text) => draft.edit(text),
			onDiscard: () => draft.discard(),
			onApply: () => {
				applied++;
			},
		});
	const text = JSON.stringify({ ...recipeSource.recipe, songStartSeconds: 2 });
	const input = findField({ node: fields(), label: "recipe-recipe" });
	if (!input?.onChange) throw Error("Recipe input missing");
	input.onChange({ target: { value: text } });
	expect(draft.getSnapshot().text).toBe(text);
	findField({ node: fields(), label: "Apply recipe" })?.onClick?.();
	expect(applied).toBe(1);
	findField({ node: fields(), label: "Discard recipe draft" })?.onClick?.();
	expect(draft.getSnapshot().dirty).toBe(false);
});

test("recipe component presents advanced parameters, accessible actions and recoverable read-only conflicts", () => {
	const draft = new ProgrammaticRecipeDraft(recipeSource);
	draft.edit("unapplied recipe");
	const render = ({
		readOnly,
		conflict,
	}: {
		readOnly: string | null;
		conflict: boolean;
	}) =>
		renderToStaticMarkup(
			<ProgrammaticRecipeFields
				id="recipe"
				state={draft.getSnapshot()}
				readOnly={readOnly}
				conflict={conflict}
				onEdit={() => {}}
				onApply={() => {}}
				onDiscard={() => {}}
			/>,
		);
	const editable = render({ readOnly: null, conflict: false });
	expect(editable).toContain("Recipe JSON (advanced)");
	expect(editable).toContain("Rust validates");
	expect(editable).toContain('aria-label="Apply recipe"');
	expect(editable).not.toContain('disabled=""');
	const readonly = render({
		readOnly: "Compiled sources must be rebuilt.",
		conflict: true,
	});
	expect(readonly).toContain("Previous recipe draft (read-only)");
	expect(readonly).toContain("unapplied recipe");
	expect(readonly).toContain('readonly=""');
	expect(readonly).toContain("Your edits are retained");
	expect(readonly).toContain('aria-label="Apply recipe" disabled=""');
	expect(readonly).not.toContain(
		'aria-label="Discard recipe draft" disabled=""',
	);
});

test("recipe component shows failure and pending state without hiding the draft", async () => {
	const draft = new ProgrammaticRecipeDraft(recipeSource);
	draft.edit("{}");
	await draft.apply(async () => {
		throw Error("Native validation rejected this recipe");
	});
	const html = renderToStaticMarkup(
		<ProgrammaticRecipeFields
			id="recipe"
			state={draft.getSnapshot()}
			readOnly={null}
			conflict={false}
			onEdit={() => {}}
			onApply={() => {}}
			onDiscard={() => {}}
		/>,
	);
	expect(html).toContain('role="alert"');
	expect(html).toContain("Native validation rejected");
	expect(html).toContain('aria-invalid="true"');
	expect(html).toContain("Unapplied recipe draft");
	let release!: (source: typeof recipeSource) => void;
	const pending = draft.apply(
		() =>
			new Promise((resolve) => {
				release = resolve;
			}),
	);
	const busy = renderToStaticMarkup(
		<ProgrammaticRecipeFields
			id="recipe"
			state={draft.getSnapshot()}
			readOnly={null}
			conflict={false}
			onEdit={() => {}}
			onApply={() => {}}
			onDiscard={() => {}}
		/>,
	);
	expect(busy).toContain("Applying recipe...");
	expect(busy).toContain('aria-label="Discard recipe draft" disabled=""');
	expect(busy).toContain('aria-label="Apply recipe" disabled=""');
	release(recipeSource);
	await pending;
});
