import { expect, test } from "bun:test";
import { isValidElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ProgrammaticRecipeGeneratorFields } from "./programmatic-recipe-generator-fields";
import { ProgrammaticRecipeFields } from "./programmatic-recipe-fields";
import { ProgrammaticRecipeDraft } from "./programmatic-recipe-draft";
import { recipeSource } from "./programmatic-recipe-fixture";
import { recipeParameterValueFits } from "./programmatic-recipe-parameter-schema";

// Frozen producer schema: scene-authoring-catalog.rs; no default or suggestion.
const frame = (min = 0) => ({
	type: "number",
	integer: true,
	min,
	max: 4294967295,
});
const input = { type: "string", minLength: 1 };
const point = {
	type: "object",
	required: ["atFrame", "sourceFrame"],
	additionalProperties: false,
	properties: { atFrame: frame(), sourceFrame: frame() },
};
const timeMap = { type: "array", minItems: 1, maxItems: 256, items: point };
const sceneParameters = {
	layers: {
		parameters: {
			items: {
				type: "array",
				minItems: 1,
				maxItems: 16,
				items: {
					type: "object",
					required: ["input", "roles"],
					additionalProperties: false,
					properties: {
						input,
						roles: {
							type: "array",
							minItems: 1,
							maxItems: 4,
							items: {
								type: "enum",
								options: ["background", "subject", "graphics", "foreground"],
							},
						},
					},
				},
			},
		},
	},
	sequence: {
		parameters: {
			items: {
				type: "array",
				minItems: 1,
				maxItems: 64,
				items: {
					type: "object",
					required: ["input", "span", "timeMap"],
					additionalProperties: false,
					properties: {
						input,
						span: {
							type: "object",
							required: ["startFrame", "durationFrames"],
							additionalProperties: false,
							properties: { startFrame: frame(), durationFrames: frame(1) },
						},
						timeMap,
					},
				},
			},
		},
	},
	ref: { parameters: { input, timeMap } },
};
interface Props {
	children?: ReactNode;
	id?: string;
	"aria-label"?: string;
	disabled?: boolean;
	onClick?: () => void;
	onChange?: (event: {
		target: { value: string; valueAsNumber?: number };
	}) => void;
}
function find(node: ReactNode, id: string): Props | undefined {
	if (Array.isArray(node)) {
		for (const child of node) {
			const result = find(child, id);
			if (result) return result;
		}
	} else if (isValidElement<Props>(node)) {
		if (node.props.id === id || node.props["aria-label"] === id)
			return node.props;
		return find(node.props.children, id);
	}
}
const recipe = () => ({
	unknown: { retain: true },
	nodes: [
		{
			id: "layers",
			unknown: "node",
			scene: {
				kind: "layers",
				items: [
					{ input: "a", roles: ["subject"] },
					{ input: "b", roles: ["foreground"] },
				],
				unknown: "scene",
			},
		},
		{
			id: "sequence",
			scene: {
				kind: "sequence",
				items: [
					{
						input: "a",
						span: { startFrame: 0, durationFrames: 30 },
						timeMap: [{ atFrame: 0, sourceFrame: 0 }],
					},
					{
						input: "b",
						span: { startFrame: 30, durationFrames: 30 },
						timeMap: [{ atFrame: 0, sourceFrame: 0 }],
					},
				],
			},
		},
		{
			id: "ref",
			scene: {
				kind: "ref",
				input: "a",
				timeMap: [
					{ atFrame: 0, sourceFrame: 0 },
					{ atFrame: 30, sourceFrame: 20 },
				],
			},
		},
		{ id: "neighbor", scene: { kind: "solid", color: [0, 0, 0, 1] } },
	],
});

test("top-level layers, sequence and ref controls edit actual scene fields without changing settings or order implicitly", () => {
	let text = JSON.stringify(recipe());
	const fields = (disabled = false) =>
		ProgrammaticRecipeGeneratorFields({
			id: "scene",
			text,
			generators: {},
			sceneParameters,
			disabled,
			onEdit: (next) => {
				text = next;
			},
		});
	find(fields(), "scene-scene-0-items-0-input")?.onChange?.({
		target: { value: "changed" },
	});
	find(fields(), "Move items[0] down")?.onClick?.();
	expect(JSON.parse(text).nodes[0]).toEqual({
		id: "layers",
		unknown: "node",
		scene: {
			kind: "layers",
			items: [
				{ input: "b", roles: ["foreground"] },
				{ input: "changed", roles: ["subject"] },
			],
			unknown: "scene",
		},
	});
	const roleNode = fields();
	find(roleNode, "scene-scene-0-items-0-roles-authored")?.onChange?.({
		target: { value: "0" },
	});
	find(roleNode, "Add authored roles item")?.onClick?.();
	expect(JSON.parse(text).nodes[0].scene.items[0].roles).toEqual([
		"foreground",
		"background",
	]);
	// Explicit point creation targets the existing ref array, not a second clock.
	const pointNode = fields();
	find(pointNode, "scene-scene-2-timeMap-authored-atFrame")?.onChange?.({
		target: { value: "60" },
	});
	find(pointNode, "scene-scene-2-timeMap-authored-sourceFrame")?.onChange?.({
		target: { value: "15" },
	});
	find(pointNode, "Add authored timeMap item")?.onClick?.();
	expect(JSON.parse(text).nodes[1].scene.items[0].timeMap).toEqual([
		{ atFrame: 0, sourceFrame: 0 },
	]); // first matching button belongs to sequence, incomplete is refused
	// Locate ref fieldset by its generated ids, then invoke only its Add.
	const ref = (fields() as any).props.children[2];
	find(ref, "scene-scene-2-timeMap-authored-atFrame")?.onChange?.({
		target: { value: "60" },
	});
	find(ref, "scene-scene-2-timeMap-authored-sourceFrame")?.onChange?.({
		target: { value: "15" },
	});
	find(ref, "Add authored timeMap item")?.onClick?.();
	expect(JSON.parse(text).nodes[2].scene.timeMap).toEqual([
		{ atFrame: 0, sourceFrame: 0 },
		{ atFrame: 30, sourceFrame: 20 },
		{ atFrame: 60, sourceFrame: 15 },
	]);
	const stable = text;
	find(fields(true), "Move items[0] down")?.onClick?.();
	find(fields(true), "scene-scene-2-input")?.onChange?.({
		target: { value: "blocked" },
	});
	expect(text).toBe(stable);
	expect(JSON.parse(text).unknown).toEqual({ retain: true });
	expect(JSON.parse(text).nodes[3]).toEqual(recipe().nodes[3]);
});

test("real recipe fields compose blank nested roles and timeMap forms while retaining sole Apply and old-core JSON fallback", () => {
	const source = { ...recipeSource, recipe: recipe() as any };
	const draft = new ProgrammaticRecipeDraft(source);
	const render = (catalog: Record<string, unknown>, conflict = false) =>
		renderToStaticMarkup(
			<ProgrammaticRecipeFields
				id="parent"
				state={draft.getSnapshot()}
				readOnly={null}
				conflict={conflict}
				generators={{}}
				sceneParameters={catalog}
				onEdit={(text) => draft.edit(text)}
				onApply={() => {}}
				onDiscard={() => draft.discard()}
			/>,
		);
	const html = render(sceneParameters);
	expect(html).toContain("New New items.roles");
	expect(html).toContain("New New items.timeMap");
	expect(html).toContain("Choose explicitly");
	expect(html.match(/aria-label="Apply recipe"/g)).toHaveLength(1);
	expect(render({})).not.toContain("Add authored items item");
	expect(render({})).toContain("Recipe JSON (advanced)");
	expect(render(sceneParameters, true)).toContain(
		'aria-label="Move items[0] down" disabled=""',
	);
	expect(recipeParameterValueFits({ value: "", rule: input })).toBe(false);
	expect(recipeParameterValueFits({ value: "actual-node", rule: input })).toBe(
		true,
	);
});
