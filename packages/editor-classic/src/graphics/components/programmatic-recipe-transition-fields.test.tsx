import { expect, test } from "bun:test";
import { isValidElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
	editRecipeTransitionParameter,
	recipeTransitionNodes,
} from "./programmatic-recipe-transition-data";
import { ProgrammaticRecipeTransitionFields } from "./programmatic-recipe-transition-fields";

// Frozen Rust producer rules: mv_recipe/catalog.rs and transition_bend.rs.
// Suggestions are deliberately present and must never create absent fields.
const number = (min: number, max: number, integer = false) => ({
	type: "number",
	min,
	max,
	integer,
	suggested: max,
});
const direction = {
	type: "enum",
	options: ["left", "right", "up", "down"],
	suggested: "left",
};
const transitionParameters = {
	peel: {
		parameters: {
			direction,
			curl: number(0.05, 0.4),
			segments: number(8, 64, true),
			shading: number(0, 0.8),
			perspective: number(0, 0.8),
		},
	},
	bend: {
		parameters: {
			direction,
			hinge: number(0, 1),
			angle: number(Math.PI / 2, Math.PI),
			perspective: number(0, 0.8),
			shading: number(0, 1),
		},
	},
};
type RecipeNode = {
	id: string;
	unknown?: unknown;
	scene: {
		kind: string;
		style?: Record<string, unknown>;
		[key: string]: unknown;
	};
};
const recipe = (): {
	version: number;
	root: string;
	unknown: unknown;
	nodes: RecipeNode[];
} => ({
	version: 1,
	root: "fold",
	unknown: { retained: [1, 2] },
	nodes: [
		{
			id: "peel-node",
			unknown: "node",
			scene: {
				kind: "transition",
				from: "a",
				to: "b",
				span: { startFrame: 12, durationFrames: 30, unknown: true },
				easing: "inOutSine",
				unknown: "scene",
				style: {
					kind: "peel",
					direction: "left",
					curl: 0.17,
					segments: 32,
					shading: 0.6,
					perspective: 0.5,
					unknown: { nested: true },
				},
			},
		},
		{
			id: "bend-node",
			scene: {
				kind: "transition",
				from: "b",
				to: "a",
				span: { startFrame: 42, durationFrames: 30 },
				easing: "linear",
				style: {
					kind: "bend",
					direction: "up",
					hinge: 0.5,
					angle: Math.PI,
					perspective: 0.5,
					shading: 0.5,
				},
			},
		},
		{ id: "neighbor", scene: { kind: "solid", color: [0, 0, 0, 1] } },
	],
});
type Props = {
	id?: string;
	children?: ReactNode;
	disabled?: boolean;
	onChange?: (event: {
		target: { value: string; valueAsNumber: number };
	}) => void;
};
function find(node: ReactNode, id: string): Props | undefined {
	if (Array.isArray(node)) {
		for (const child of node) {
			const result = find(child, id);
			if (result) return result;
		}
	} else if (isValidElement<Props>(node)) {
		if (node.props.id === id) return node.props;
		return find(node.props.children, id);
	}
}
const edits = [
	{ index: 0, key: "direction", value: "right" },
	{ index: 0, key: "curl", value: 0.25 },
	{ index: 0, key: "segments", value: 48 },
	{ index: 0, key: "shading", value: 0.2 },
	{ index: 0, key: "perspective", value: 0.7 },
	{ index: 1, key: "direction", value: "down" },
	{ index: 1, key: "hinge", value: 0.25 },
	{ index: 1, key: "angle", value: 2 },
	{ index: 1, key: "perspective", value: 0.7 },
	{ index: 1, key: "shading", value: 0.2 },
];
for (const { index, key, value } of edits)
	test(`existing transition ${index}.${key} edits only its authored style path`, () => {
		const original = recipe();
		let text = JSON.stringify(original),
			calls = 0;
		const fields = ProgrammaticRecipeTransitionFields({
			id: "draft",
			text,
			transitionParameters,
			disabled: false,
			onEdit: (next) => {
				text = next;
				calls++;
			},
		});
		const input = find(fields, `draft-transition-${index}-${key}`);
		expect(input).toBeDefined();
		input?.onChange?.({
			target: { value: String(value), valueAsNumber: Number(value) },
		});
		const expected = structuredClone(original);
		Reflect.set(expected.nodes[index].scene.style!, key, value);
		expect(JSON.parse(text)).toEqual(expected);
		expect(calls).toBe(1);
	});

test("disabled controls cannot update text, including direct event callbacks", () => {
	const text = JSON.stringify(recipe());
	let calls = 0;
	const fields = ProgrammaticRecipeTransitionFields({
		id: "locked",
		text,
		transitionParameters,
		disabled: true,
		onEdit: () => {
			calls++;
		},
	});
	for (const { index, key, value } of edits) {
		const input = find(fields, `locked-transition-${index}-${key}`);
		expect(input?.disabled).toBe(true);
		input?.onChange?.({
			target: { value: String(value), valueAsNumber: Number(value) },
		});
	}
	expect(calls).toBe(0);
});
test("missing values are not created from catalog suggestions", () => {
	const source = recipe();
	Reflect.deleteProperty(source.nodes[0].scene.style!, "curl");
	const text = JSON.stringify(source);
	const fields = ProgrammaticRecipeTransitionFields({
		id: "missing",
		text,
		transitionParameters,
		disabled: false,
		onEdit: () => {
			throw Error("Unexpected write");
		},
	});
	expect(find(fields, "missing-transition-0-curl")).toBeUndefined();
	expect(
		editRecipeTransitionParameter({
			text,
			transitionParameters,
			index: 0,
			key: "curl",
			value: 0.2,
		}),
	).toBeUndefined();
	const next = editRecipeTransitionParameter({
		text,
		transitionParameters,
		index: 0,
		key: "segments",
		value: 48,
	});
	expect(Object.hasOwn(JSON.parse(next!).nodes[0].scene.style, "curl")).toBe(
		false,
	);
});
test("invalid JSON, unknown style and unknown schemas cannot rewrite the draft", () => {
	const unknownStyle = recipe();
	unknownStyle.nodes[0].scene.style!.kind = "wipe";
	for (const text of [
		"{ invalid json",
		"null",
		'{"nodes":{}}',
		JSON.stringify(unknownStyle),
	])
		expect(
			editRecipeTransitionParameter({
				text,
				transitionParameters,
				index: 0,
				key: "curl",
				value: 0.2,
			}),
		).toBeUndefined();
	for (const catalog of [
		{},
		{ peel: { parameters: { curl: { type: "future" } } } },
		{
			peel: {
				parameters: { curl: number(0.05, 0.4), unknown: { type: "future" } },
			},
		},
		{ peel: { parameters: { kind: direction, curl: number(0.05, 0.4) } } },
	]) {
		const text = JSON.stringify(recipe());
		expect(
			recipeTransitionNodes({ text, transitionParameters: catalog }),
		).toEqual([]);
		expect(
			editRecipeTransitionParameter({
				text,
				transitionParameters: catalog,
				index: 0,
				key: "curl",
				value: 0.2,
			}),
		).toBeUndefined();
	}
});
test("range, integer and enum rejection leave authored values and style type untouched", () => {
	const text = JSON.stringify(recipe());
	for (const [key, value] of [
		["curl", 0.41],
		["segments", 8.5],
		["direction", "sideways"],
		["kind", "bend"],
		["curl", "0.2"],
		["curl", NaN],
	] as const)
		expect(
			editRecipeTransitionParameter({
				text,
				transitionParameters,
				index: 0,
				key,
				value,
			}),
		).toBeUndefined();
	const markup = renderToStaticMarkup(
		<>
			{ProgrammaticRecipeTransitionFields({
				id: "labels",
				text,
				transitionParameters,
				disabled: false,
				onEdit: () => {},
			})}
		</>,
	);
	expect(markup).toContain('for="labels-transition-0-curl"');
	expect(markup).toContain('id="labels-transition-0-curl"');
	expect(markup).toContain("peel / peel-node");
	expect(markup).toContain("bend / bend-node");
});
