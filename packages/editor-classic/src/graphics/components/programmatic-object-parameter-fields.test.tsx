import { expect, test } from "bun:test";
import { isValidElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { BuildDraftSnapshot } from "./programmatic-build-draft";
import { ProgrammaticObjectParameterFields } from "./programmatic-object-parameter-fields";
import {
	OBJECT_PARAMETER_FIELDS,
	editObjectParameterDraft,
	objectParameterKind,
	type ObjectParameterKind,
} from "./programmatic-object-parameter-data";

interface Control {
	id?: string;
	children?: ReactNode;
	disabled?: boolean;
	onChange?: (event: {
		target: { value: string; valueAsNumber?: number; checked?: boolean };
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
			const result = find({ node: child, id });
			if (result) return result;
		}
	} else if (isValidElement<Control>(node)) {
		if (node.props.id === id) return node.props;
		return find({ node: node.props.children, id });
	}
}
const kinds: ObjectParameterKind[] = ["glass", "ink", "liquid"];
function props({
	kind,
	svg = false,
}: {
	kind: ObjectParameterKind;
	svg?: boolean;
}) {
	return {
		modelId: "assets/object",
		...(svg ? { assetKind: "svg", shape: { modeling: { kind: "flat" } } } : {}),
		unknown: { retain: [false, 12] },
		[kind]: {
			version: 1,
			seed: 19,
			clock: { keep: true },
			future: "retained",
			...Object.fromEntries(
				OBJECT_PARAMETER_FIELDS[kind].map((field) => [
					field.key,
					field.type === "number"
						? 0.5
						: field.type === "boolean"
							? true
							: "#ABCdef",
				]),
			),
		},
	};
}
function state({
	kind = "glass",
	svg = false,
	animated = false,
	text,
}: {
	kind?: ObjectParameterKind;
	svg?: boolean;
	animated?: boolean;
	text?: string;
} = {}): BuildDraftSnapshot {
	const inputProps = {
		...props({ kind, svg }),
		...(animated ? { animation: { clip: "Pose", mode: "loop" } } : {}),
	};
	const entry = animated
		? "liquid-animated-scene.ts"
		: `${kind}-object-scene.ts`;
	return {
		baseline: {
			build: {
				engine: "three",
				entryFile: entry,
				capabilities: kind === "liquid" ? ["liquid-object-v1"] : [],
				inputProps,
				inputs: [
					entry,
					...(kind === "liquid" ? ["liquid-object-geometry.mjs"] : []),
					...(animated
						? ["object-animation.mjs", "particle-pose-geometry.mjs"]
						: []),
				].map((id) => ({ id })),
			},
			resources: [
				{
					id: "assets/object",
					kind: "model",
					mimeType: svg ? "image/svg+xml" : "model/gltf-binary",
				},
			],
		} as unknown as BuildDraftSnapshot["baseline"],
		selectedId: entry,
		entryFile: entry,
		fileIds: [],
		files: {},
		inputProps: text ?? JSON.stringify(inputProps),
		dirty: false,
		conflict: false,
		phase: null,
		error: null,
	};
}

test("fixed object scenes gate matching GLB/SVG resource and actual Liquid static/animated closure", () => {
	for (const kind of kinds)
		for (const svg of [false, true])
			expect(objectParameterKind({ state: state({ kind, svg }) })).toBe(kind);
	expect(
		objectParameterKind({ state: state({ kind: "liquid", animated: true }) }),
	).toBe("liquid");
	expect(
		objectParameterKind({
			state: state({ kind: "liquid", animated: true, svg: true }),
		}),
	).toBeUndefined();
	for (const kind of kinds) {
		const snapshot = state({ kind }),
			baseline = snapshot.baseline;
		for (const variant of [
			{
				...baseline,
				build: { ...baseline.build!, engine: "remotion" as const },
			},
			{ ...baseline, build: { ...baseline.build!, entryFile: "unknown.ts" } },
			{ ...baseline, build: { ...baseline.build!, inputs: [] } },
			{ ...baseline, resources: [] },
			{
				...baseline,
				resources: [{ ...baseline.resources![0], id: "unrelated" }],
			},
			{
				...baseline,
				resources: [{ ...baseline.resources![0], mimeType: "image/svg+xml" }],
			},
			{
				...baseline,
				build: {
					...baseline.build!,
					inputProps: { modelId: "assets/object", [kind]: { version: 2 } },
				},
			},
			{
				...baseline,
				build: { ...baseline.build!, inputProps: { modelId: "assets/object" } },
			},
		])
			expect(
				objectParameterKind({ state: { ...snapshot, baseline: variant } }),
			).toBeUndefined();
	}
	const liquid = state({ kind: "liquid", animated: true });
	for (const removed of [
		"liquid-object-geometry.mjs",
		"object-animation.mjs",
		"particle-pose-geometry.mjs",
	])
		expect(
			objectParameterKind({
				state: {
					...liquid,
					baseline: {
						...liquid.baseline,
						build: {
							...liquid.baseline.build!,
							inputs: liquid.baseline.build!.inputs.filter(
								(input) => input.id !== removed,
							),
						},
					},
				},
			}),
		).toBeUndefined();
	expect(
		objectParameterKind({
			state: {
				...liquid,
				baseline: {
					...liquid.baseline,
					build: { ...liquid.baseline.build!, capabilities: [] },
				},
			},
		}),
	).toBeUndefined();
});

test("all public scalars/boolean/RGB edit existing paths without normalization or losing author data", () => {
	for (const kind of kinds) {
		let text = state({ kind }).inputProps;
		const fields = () =>
			ProgrammaticObjectParameterFields({
				id: "o",
				state: state({ kind, text }),
				canCompile: true,
				onEdit: (patch) => {
					text = patch.inputProps;
				},
			});
		for (const field of OBJECT_PARAMETER_FIELDS[kind]) {
			const control = find({
				node: fields(),
				id: `o-object-${kind}-${field.key}`,
			});
			expect(control).toBeDefined();
			control!.onChange!({
				target: {
					value: field.type === "rgb" ? "#DeAdBe" : "-123.456",
					valueAsNumber: -123.456,
					checked: false,
				},
			});
			expect(JSON.parse(text)[kind][field.key]).toBe(
				field.type === "number"
					? -123.456
					: field.type === "boolean"
						? false
						: "#DeAdBe",
			);
		}
		const value = JSON.parse(text);
		expect(value.unknown).toEqual(props({ kind }).unknown);
		expect(value[kind].future).toBe("retained");
		expect(value[kind].version).toBe(1);
		expect(value[kind].seed).toBe(19);
		expect(value[kind].clock).toEqual({ keep: true });
	}
});

test("missing and reserved values are not generated and invalid transport is not edited", () => {
	for (const kind of kinds) {
		const text = JSON.stringify({
			[kind]: { version: 1, seed: 19, future: true },
		});
		const node = ProgrammaticObjectParameterFields({
			id: "o",
			state: state({ kind, text }),
			canCompile: true,
			onEdit: () => {
				throw Error("Unexpected edit");
			},
		});
		for (const field of OBJECT_PARAMETER_FIELDS[kind]) {
			expect(
				find({ node, id: `o-object-${kind}-${field.key}` }),
			).toBeUndefined();
			expect(
				editObjectParameterDraft({
					text,
					kind,
					key: field.key,
					next:
						field.type === "number"
							? 1
							: field.type === "boolean"
								? true
								: "#ffffff",
				}),
			).toBeUndefined();
		}
		for (const key of ["version", "seed", "timeTicks", "clock", "future"])
			expect(
				editObjectParameterDraft({ text, kind, key, next: 2 }),
			).toBeUndefined();
		for (const next of [NaN, Infinity, "1", null])
			expect(
				editObjectParameterDraft({
					text: state({ kind }).inputProps,
					kind,
					key: OBJECT_PARAMETER_FIELDS[kind].find(
						(field) => field.type === "number",
					)!.key,
					next,
				}),
			).toBeUndefined();
	}
	expect(
		editObjectParameterDraft({
			text: state({ kind: "liquid" }).inputProps,
			kind: "liquid",
			key: "enabled",
			next: "false",
		}),
	).toBeUndefined();
	expect(
		editObjectParameterDraft({
			text: state().inputProps,
			kind: "glass",
			key: "color",
			next: [1, 0, 0],
		}),
	).toBeUndefined();
});

test("invalid JSON or malformed object stays in original draft with repair guidance", () => {
	for (const kind of kinds)
		for (const text of [
			"{",
			"[]",
			"null",
			`{"${kind}":null}`,
			`{"${kind}":{"bad":1e400}}`,
		]) {
			const node = ProgrammaticObjectParameterFields({
				id: "o",
				state: state({ kind, text }),
				canCompile: true,
				onEdit: () => {
					throw Error("Unexpected edit");
				},
			});
			expect(renderToStaticMarkup(node)).toContain("Fix input props JSON");
		}
	const malformed = ProgrammaticObjectParameterFields({
		id: "o",
		state: state({ text: '{"glass":{"transmission":"bad","color":null}}' }),
		canCompile: true,
		onEdit: () => {},
	});
	expect(renderToStaticMarkup(malformed)).toContain("Fix these values");
	expect(find({ node: malformed, id: "o-object-glass-color" })).toBeUndefined();
});

test("every busy phase, conflict and missing compiler disables controls and ignores direct events", () => {
	for (const kind of kinds)
		for (const patch of [
			{ phase: "loading" },
			{ phase: "compiling" },
			{ phase: "saving" },
			{ conflict: true },
			{},
		] as const) {
			let edits = 0;
			const node = ProgrammaticObjectParameterFields({
				id: "o",
				state: { ...state({ kind }), ...patch },
				canCompile: Object.keys(patch).length > 0,
				onEdit: () => {
					edits++;
				},
			});
			for (const field of OBJECT_PARAMETER_FIELDS[kind]) {
				const control = find({ node, id: `o-object-${kind}-${field.key}` });
				expect(control?.disabled).toBe(true);
				control?.onChange?.({
					target: { value: "#ffffff", valueAsNumber: 4, checked: false },
				});
			}
			expect(edits).toBe(0);
		}
});
