import { expect, test } from "bun:test";
import { isValidElement, type ReactNode } from "react";
import { mvRecipeCatalogJson } from "opencut-wasm";
import { ProgrammaticRecipeGeneratorFields } from "./programmatic-recipe-generator-fields";

interface Control {
	children?: ReactNode;
	id?: string;
	"aria-label"?: string;
	disabled?: boolean;
	onClick?: () => void;
	onChange?: (event: {
		target: { value: string; valueAsNumber?: number };
	}) => void;
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
		if (node.props.id === id || node.props["aria-label"] === id)
			return node.props;
		return find({ node: node.props.children, id });
	}
}

test("actual Cloth events catalog edits exact nested values and adds only complete authored entries", () => {
	const generators = JSON.parse(mvRecipeCatalogJson()).generators;
	expect(generators.cloth.parameters.events.items.required).toEqual([
		"atTicks",
		"center",
		"radius",
		"velocity",
	]);
	const event = {
		atTicks: 1001,
		center: [0.25, 0.5],
		radius: 0.25,
		velocity: [0, 1.23456789, -1],
	};
	let text = JSON.stringify({
		metadata: "keep",
		nodes: [
			{
				id: "cloth",
				scene: {
					kind: "cloth",
					span: { durationFrames: 90 },
					settings: {
						events: [event],
						image: { id: "exact-resource" },
						extra: "keep",
					},
				},
			},
			{
				id: "neighbor",
				scene: {
					kind: "shatter",
					settings: { image: { id: "neighbor-resource" }, fragments: 12 },
				},
			},
		],
	});
	const fields = (disabled = false) =>
		ProgrammaticRecipeGeneratorFields({
			id: "array",
			text,
			generators,
			disabled,
			onEdit: (next) => {
				text = next;
			},
		});
	const node = fields();
	find({ node, id: "array-generator-0-events-0-atTicks" })?.onChange?.({
		target: { value: "1235", valueAsNumber: 1235 },
	});
	find({
		node: fields(),
		id: "array-generator-0-events-0-velocity-1",
	})?.onChange?.({
		target: { value: "1.234567891", valueAsNumber: 1.234567891 },
	});
	expect(JSON.parse(text).nodes[0].scene.settings.events[0]).toEqual({
		...event,
		atTicks: 1235,
		velocity: [0, 1.234567891, -1],
	});
	const beforeAdd = text,
		addFields = fields();
	find({ node: addFields, id: "Add events item" })?.onClick?.();
	expect(text).toBe(beforeAdd);
	const input = find({ node: addFields, id: "array-generator-0-events-new" });
	input?.onChange?.({ target: { value: '{"atTicks":1236}' } });
	find({ node: addFields, id: "Add events item" })?.onClick?.();
	expect(text).toBe(beforeAdd);
	const second = { ...event, atTicks: 2345 };
	input?.onChange?.({ target: { value: JSON.stringify(second) } });
	find({ node: addFields, id: "Add events item" })?.onClick?.();
	expect(JSON.parse(text).nodes[0].scene.settings.events).toHaveLength(2);
	expect(JSON.parse(text).nodes[0].scene.settings.events[1]).toEqual(second);
	const locked = fields(true),
		beforeDisabled = text;
	find({ node: locked, id: "Remove events[0]" })?.onClick?.();
	find({ node: locked, id: "Add events item" })?.onClick?.();
	find({ node: locked, id: "array-generator-0-events-0-atTicks" })?.onChange?.({
		target: { value: "0", valueAsNumber: 0 },
	});
	expect(text).toBe(beforeDisabled);
	expect(find({ node: locked, id: "Add events item" })?.disabled).toBe(true);
	find({ node: fields(), id: "Remove events[0]" })?.onClick?.();
	expect(JSON.parse(text)).toMatchObject({
		metadata: "keep",
		nodes: [
			{
				id: "cloth",
				scene: {
					span: { durationFrames: 90 },
					settings: {
						events: [second],
						image: { id: "exact-resource" },
						extra: "keep",
					},
				},
			},
			{
				id: "neighbor",
				scene: {
					kind: "shatter",
					settings: { image: { id: "neighbor-resource" }, fragments: 12 },
				},
			},
		],
	});
	// Opaque resource catalogs have no declared editable properties.
	expect(
		find({ node: fields(), id: "array-generator-0-image-id" }),
	).toBeUndefined();
	expect(
		find({ node: fields(), id: "array-generator-1-image-id" }),
	).toBeUndefined();
	const full = JSON.parse(text);
	full.nodes[0].scene.settings.events = Array.from(
		{ length: 16 },
		() => second,
	);
	text = JSON.stringify(full);
	const maximum = fields();
	expect(find({ node: maximum, id: "Add events item" })?.disabled).toBe(true);
	const beforeMax = text;
	find({ node: maximum, id: "Add events item" })?.onClick?.();
	expect(text).toBe(beforeMax);
});

test("known nested arrays and object fields preserve extras, explicit defaults, minimum and unknown JSON", () => {
	let text = JSON.stringify({
		nodes: [
			{
				scene: {
					kind: "future",
					settings: {
						groups: [[2]],
						image: { id: "asset", nested: { value: 3, extra: 9 } },
						unknown: ["keep"],
					},
				},
			},
		],
	});
	const generators = {
		future: {
			parameters: {
				groups: {
					type: "array",
					minItems: 1,
					items: {
						type: "array",
						minItems: 1,
						default: [5],
						items: { type: "number", default: 4 },
					},
				},
				image: {
					type: "object",
					properties: {
						id: { type: "string" },
						nested: {
							type: "object",
							properties: { value: { type: "number" } },
						},
					},
				},
				unknown: { type: "array", items: { type: "new-schema" } },
			},
		},
	};
	const fields = () =>
		ProgrammaticRecipeGeneratorFields({
			id: "nested",
			text,
			generators,
			disabled: false,
			onEdit: (next) => {
				text = next;
			},
		});
	find({ node: fields(), id: "nested-generator-0-groups-0-0" })?.onChange?.({
		target: { value: "2.25", valueAsNumber: 2.25 },
	});
	find({ node: fields(), id: "Add groups[0] item" })?.onClick?.();
	find({ node: fields(), id: "Add groups item" })?.onClick?.();
	find({
		node: fields(),
		id: "nested-generator-0-image-nested-value",
	})?.onChange?.({ target: { value: "7", valueAsNumber: 7 } });
	expect(JSON.parse(text).nodes[0].scene.settings).toEqual({
		groups: [[2.25, 4], [5]],
		image: { id: "asset", nested: { value: 7, extra: 9 } },
		unknown: ["keep"],
	});
	find({ node: fields(), id: "Remove groups[1]" })?.onClick?.();
	expect(find({ node: fields(), id: "Remove groups[0]" })?.disabled).toBe(true);
	expect(find({ node: fields(), id: "Add unknown item" })).toBeUndefined();
});

test("empty Cloth event collections accept complete explicit structured entries without JSON or inferred suggestions", () => {
	const generators = JSON.parse(mvRecipeCatalogJson()).generators;
	let text = JSON.stringify({
		root: "cloth",
		provenance: "keep",
		nodes: [
			{
				id: "cloth",
				scene: {
					kind: "cloth",
					span: { startFrame: 0, durationFrames: 90 },
					settings: {
						events: [],
						image: { id: "image" },
						unknown: { retained: true },
					},
				},
			},
		],
	});
	const fields = (disabled = false) =>
		ProgrammaticRecipeGeneratorFields({
			id: "create",
			text,
			generators,
			disabled,
			onEdit: (next) => {
				text = next;
			},
		});
	const node = fields(),
		before = text;
	const add = find({ node, id: "Add authored events item" });
	expect(add).toBeDefined();
	add?.onClick?.();
	expect(text).toBe(before);
	const enter = (suffix: string, value: string) =>
		find({
			node,
			id: `create-generator-0-events-authored-${suffix}`,
		})?.onChange?.({ target: { value } });
	enter("atTicks", "1001");
	enter("center-0", "0.25");
	enter("center-1", "0.5");
	enter("radius", "0.25");
	enter("velocity-0", "0");
	enter("velocity-1", "1.234567891");
	add?.onClick?.();
	expect(text).toBe(before); // missing final component, no synthesized zero
	enter("velocity-2", "-1");
	add?.onClick?.();
	expect(JSON.parse(text)).toEqual({
		root: "cloth",
		provenance: "keep",
		nodes: [
			{
				id: "cloth",
				scene: {
					kind: "cloth",
					span: { startFrame: 0, durationFrames: 90 },
					settings: {
						events: [
							{
								atTicks: 1001,
								center: [0.25, 0.5],
								radius: 0.25,
								velocity: [0, 1.234567891, -1],
							},
						],
						image: { id: "image" },
						unknown: { retained: true },
					},
				},
			},
		],
	});
	const locked = fields(true),
		saved = text;
	find({
		node: locked,
		id: "create-generator-0-events-authored-atTicks",
	})?.onChange?.({ target: { value: "1234" } });
	find({ node: locked, id: "Add authored events item" })?.onClick?.();
	expect(text).toBe(saved);
	expect(find({ node: locked, id: "Add authored events item" })?.disabled).toBe(
		true,
	);
});

test("ordered collection controls move exact authored objects without sorting or losing neighboring metadata", () => {
	const generators = JSON.parse(mvRecipeCatalogJson()).generators;
	const events = [1001, 2001, 3001].map((atTicks) => ({
		atTicks,
		center: [0.25, 0.5],
		radius: 0.25,
		velocity: [0, 1, -1],
		unknown: { retained: atTicks },
	}));
	let text = JSON.stringify({
		metadata: "keep",
		nodes: [
			{
				id: "cloth",
				scene: {
					kind: "cloth",
					span: { durationFrames: 90 },
					settings: { events, neighbor: "keep" },
				},
			},
			{ id: "untouched", scene: { kind: "solid", color: [0, 0, 0, 1] } },
		],
	});
	const fields = (disabled = false) =>
		ProgrammaticRecipeGeneratorFields({
			id: "order",
			text,
			generators,
			disabled,
			onEdit: (next) => {
				text = next;
			},
		});
	expect(find({ node: fields(), id: "Move events[0] up" })?.disabled).toBe(
		true,
	);
	expect(find({ node: fields(), id: "Move events[2] down" })?.disabled).toBe(
		true,
	);
	const original = JSON.parse(text);
	find({ node: fields(), id: "Move events[0] up" })?.onClick?.();
	expect(JSON.parse(text)).toEqual(original);
	find({ node: fields(), id: "Move events[0] down" })?.onClick?.();
	expect(JSON.parse(text).nodes[0].scene.settings.events).toEqual([
		events[1],
		events[0],
		events[2],
	]);
	find({ node: fields(), id: "Move events[2] up" })?.onClick?.();
	expect(JSON.parse(text)).toEqual({
		...original,
		nodes: [
			{
				...original.nodes[0],
				scene: {
					...original.nodes[0].scene,
					settings: {
						...original.nodes[0].scene.settings,
						events: [events[1], events[2], events[0]],
					},
				},
			},
			original.nodes[1],
		],
	});
	const stable = text,
		locked = fields(true);
	find({ node: locked, id: "Move events[0] down" })?.onClick?.();
	find({ node: locked, id: "Move events[1] up" })?.onClick?.();
	expect(text).toBe(stable);
	expect(find({ node: locked, id: "Move events[1] up" })?.disabled).toBe(true);
});

test("new declared item fields consume resource choices and explicit typed values, omitting untouched optional fields", () => {
	const generators = {
		declared: {
			parameters: {
				layers: {
					type: "array",
					maxItems: 2,
					items: {
						type: "object",
						required: ["image", "name", "mode", "position"],
						properties: {
							image: { type: "resource", kind: "image" },
							name: { type: "string" },
							mode: { type: "enum", options: [false, 1, "screen"] },
							position: {
								type: "tuple",
								items: [{ type: "number" }, { type: "number" }],
							},
							optional: { type: "text" },
						},
					},
				},
			},
		},
	};
	let text = JSON.stringify({
		nodes: [
			{
				scene: { kind: "declared", settings: { layers: [], unknown: "keep" } },
			},
		],
	});
	const fields = (disabled = false) =>
		ProgrammaticRecipeGeneratorFields({
			id: "resource",
			text,
			generators,
			resources: [
				{ id: "photo", kind: "image" },
				{ id: "font", kind: "font" },
			],
			disabled,
			onEdit: (next) => {
				text = next;
			},
		});
	const node = fields(),
		original = text;
	const enter = (field: string, value: string) =>
		find({
			node,
			id: `resource-generator-0-layers-authored-${field}`,
		})?.onChange?.({ target: { value } });
	const add = find({ node, id: "Add authored layers item" });
	enter("name", "authored");
	enter("mode", "0");
	enter("position-0", "1.25");
	enter("position-1", "-2");
	add?.onClick?.();
	expect(text).toBe(original);
	enter("image", "font");
	add?.onClick?.();
	expect(text).toBe(original);
	enter("image", "photo");
	add?.onClick?.();
	expect(JSON.parse(text).nodes[0].scene.settings).toEqual({
		layers: [
			{ image: "photo", name: "authored", mode: false, position: [1.25, -2] },
		],
		unknown: "keep",
	});
	const next = fields(),
		stable = text;
	find({
		node: next,
		id: "resource-generator-0-layers-authored-image",
	})?.onChange?.({ target: { value: "photo" } });
	find({ node: next, id: "Add authored layers item" })?.onClick?.();
	expect(text).toBe(stable); // no automatic empty name or selected enum
	const locked = fields(true);
	find({
		node: locked,
		id: "resource-generator-0-layers-authored-image",
	})?.onChange?.({ target: { value: "photo" } });
	find({ node: locked, id: "Add authored layers item" })?.onClick?.();
	expect(text).toBe(stable);
});
