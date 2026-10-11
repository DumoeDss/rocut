import { expect, test } from "bun:test";
import { isValidElement, type ReactNode } from "react";
import { mvRecipeCatalogJson } from "opencut-wasm";
import type { ProgrammaticSource } from "@opencut/editor-contracts";
import { ProgrammaticRecipeGeneratorFields } from "./programmatic-recipe-generator-fields";
import { ProgrammaticRecipeFields } from "./programmatic-recipe-fields";
import { ProgrammaticRecipeDraft } from "./programmatic-recipe-draft";
import { recipeSource } from "./programmatic-recipe-fixture";

interface Control {
	children?: ReactNode;
	id?: string;
	value?: string;
	disabled?: boolean;
	onChange?: (event: { target: { value: string } }) => void;
}
function find({
	node,
	id,
}: {
	node: ReactNode;
	id: string;
}): Control | undefined {
	if (Array.isArray(node)) {
		for (const child of node) {
			const found = find({ node: child, id });
			if (found) return found;
		}
	} else if (isValidElement<Control>(node)) {
		if (node.props.id === id) return node.props;
		if (node.type === ProgrammaticRecipeGeneratorFields)
			return find({
				node: ProgrammaticRecipeGeneratorFields(
					node.props as Parameters<typeof ProgrammaticRecipeGeneratorFields>[0],
				),
				id,
			});
		return find({ node: node.props.children, id });
	}
}
function options(node: ReactNode): string[] {
	if (Array.isArray(node)) return node.flatMap(options);
	if (!isValidElement<Control>(node)) return [];
	return node.type === "option"
		? [node.props.value!]
		: options(node.props.children);
}
const resources = [
	{ id: "image-a", kind: "image" as const },
	{ id: "image-b", kind: "image" as const },
	{ id: "font-a", kind: "font" as const },
	{ id: "video-a", kind: "video" as const },
];

test("actual Cloth/Shatter/GlyphRain resource controls filter declarations and retain unresolved exact IDs", () => {
	const generators = JSON.parse(mvRecipeCatalogJson()).generators;
	for (const [kind, key, resourceKind] of [
		["cloth", "image", "image"],
		["shatter", "image", "image"],
		["glyphRain", "font", "font"],
	]) {
		expect(generators[kind].parameters[key]).toMatchObject({
			type: "resource",
			kind: resourceKind,
		});
		let text = JSON.stringify({
			extra: "keep",
			nodes: [
				{
					scene: {
						kind,
						settings: { [key]: "unresolved/original", retained: [1, 2] },
					},
				},
				{ id: "neighbor" },
			],
		});
		const fields = (disabled = false) =>
			ProgrammaticRecipeGeneratorFields({
				id: "resource",
				text,
				generators,
				resources,
				disabled,
				onEdit: (next) => {
					text = next;
				},
			});
		const select = find({ node: fields(), id: `resource-generator-0-${key}` });
		expect(select?.value).toBe("unresolved/original");
		expect(options(select?.children)).toEqual(
			resourceKind === "image"
				? ["unresolved/original", "image-a", "image-b"]
				: ["unresolved/original", "font-a"],
		);
		const original = text;
		select?.onChange?.({ target: { value: "video-a" } });
		expect(text).toBe(original);
		select?.onChange?.({ target: { value: "undeclared" } });
		expect(text).toBe(original);
		find({ node: fields(true), id: `resource-generator-0-${key}` })?.onChange?.(
			{ target: { value: resourceKind === "image" ? "image-b" : "font-a" } },
		);
		expect(text).toBe(original);
		select?.onChange?.({
			target: { value: resourceKind === "image" ? "image-b" : "font-a" },
		});
		expect(JSON.parse(text)).toEqual({
			extra: "keep",
			nodes: [
				{
					scene: {
						kind,
						settings: {
							[key]: resourceKind === "image" ? "image-b" : "font-a",
							retained: [1, 2],
						},
					},
				},
				{ id: "neighbor" },
			],
		});
	}
	expect(resources).toEqual([
		{ id: "image-a", kind: "image" },
		{ id: "image-b", kind: "image" },
		{ id: "font-a", kind: "font" },
		{ id: "video-a", kind: "video" },
	]);
});

test("baseline resources reach generator controls and conflicts/read-only/pending block resource draft changes", () => {
	const generators = JSON.parse(mvRecipeCatalogJson()).generators;
	const source = {
		...recipeSource,
		resources: resources.map((resource) => ({
			...recipeSource.resources![0],
			...resource,
		})),
		recipe: {
			...recipeSource.recipe!,
			nodes: [
				{
					id: "cloth",
					scene: { kind: "cloth", settings: { image: "image-a" } },
				},
			],
		},
	} as ProgrammaticSource;
	const draft = new ProgrammaticRecipeDraft(source),
		initialResources = JSON.stringify(source.resources);
	const fields = ({
		conflict = false,
		readOnly = null,
		pending = false,
	}: {
		conflict?: boolean;
		readOnly?: string | null;
		pending?: boolean;
	} = {}) =>
		ProgrammaticRecipeFields({
			id: "baseline",
			state: { ...draft.getSnapshot(), pending },
			conflict,
			readOnly,
			generators,
			onEdit: (text) => draft.edit(text),
			onApply: () => {},
			onDiscard: () => {},
		});
	const editable = find({ node: fields(), id: "baseline-generator-0-image" });
	expect(options(editable?.children)).toEqual(["image-a", "image-b"]);
	for (const state of [
		{ conflict: true },
		{ readOnly: "Read only" },
		{ pending: true },
	]) {
		const disabled = find({
			node: fields(state),
			id: "baseline-generator-0-image",
		});
		expect(disabled?.disabled).toBe(true);
		disabled?.onChange?.({ target: { value: "image-b" } });
		expect(draft.getSnapshot().dirty).toBe(false);
	}
	editable?.onChange?.({ target: { value: "image-b" } });
	expect(
		JSON.parse(draft.getSnapshot().text).nodes[0].scene.settings.image,
	).toBe("image-b");
	expect(draft.getSnapshot().dirty).toBe(true);
	expect(JSON.stringify(source.resources)).toBe(initialResources);
	expect(JSON.stringify(draft.getSnapshot().baseline.resources)).toBe(
		initialResources,
	);
});

test("mismatched resource shapes and schemas remain untouched in complete JSON", () => {
	const generators = {
		future: {
			parameters: {
				object: {
					type: "resource",
					kind: "image",
					properties: { id: { type: "string" } },
				},
				missingKind: { type: "resource" },
				unknownKind: { type: "resource", kind: "filesystem" },
				nested: {
					type: "object",
					properties: { font: { type: "resource", kind: "font" } },
				},
			},
		},
	};
	let text = JSON.stringify({
		nodes: [
			{
				scene: {
					kind: "future",
					settings: {
						object: { id: "image-a" },
						missingKind: "image-a",
						unknownKind: "image-a",
						nested: { font: "image-a", extra: 2 },
					},
				},
			},
		],
	});
	const fields = () =>
		ProgrammaticRecipeGeneratorFields({
			id: "fallback",
			text,
			generators,
			resources,
			disabled: false,
			onEdit: (next) => {
				text = next;
			},
		});
	for (const key of ["object", "missingKind", "unknownKind"])
		expect(
			find({ node: fields(), id: `fallback-generator-0-${key}` }),
		).toBeUndefined();
	const select = find({
		node: fields(),
		id: "fallback-generator-0-nested-font",
	});
	expect(select?.value).toBe("image-a");
	expect(options(select?.children)).toEqual(["image-a", "font-a"]);
	select?.onChange?.({ target: { value: "font-a" } });
	expect(JSON.parse(text).nodes[0].scene.settings).toEqual({
		object: { id: "image-a" },
		missingKind: "image-a",
		unknownKind: "image-a",
		nested: { font: "font-a", extra: 2 },
	});
});
