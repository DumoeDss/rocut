import { expect, test } from "bun:test";
import { isValidElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { BuildDraftSnapshot } from "./programmatic-build-draft";
import { ProgrammaticBuildFields } from "./programmatic-build-fields";
import { ProgrammaticObjectAnimationFields } from "./programmatic-object-animation-fields";
import {
	editObjectAnimationDraft,
	objectAnimationFieldsVisible,
	objectAnimationClipType,
} from "./programmatic-object-animation-data";

function modelState({
	clip = 0,
	text,
}: { clip?: string | number; text?: string } = {}): BuildDraftSnapshot {
	const snapshot = state();
	const inputProps = {
		...props,
		assetKind: "model",
		modelId: "assets/model.glb",
		animation: { ...props.animation, clip },
	};
	return {
		...snapshot,
		inputProps: text ?? JSON.stringify(inputProps),
		baseline: {
			...snapshot.baseline,
			resources: [
				{ ...snapshot.baseline.resources![0], id: "assets/model.glb" },
			],
			build: {
				...snapshot.baseline.build!,
				entryFile: "model-feature-scene.ts",
				inputs: [
					{
						...snapshot.baseline.build!.inputs[0],
						id: "model-feature-scene.ts",
					},
				],
				inputProps,
			},
		},
	};
}

test("ordinary model animation gate requires exact scene archive, model kind and matching GLB resource", () => {
	const snapshot = modelState();
	expect(objectAnimationFieldsVisible({ state: snapshot })).toBe(true);
	expect(objectAnimationClipType({ state: snapshot })).toBe("index");
	expect(
		objectAnimationClipType({ state: modelState({ clip: "Exact clip" }) }),
	).toBe("name");
	const baseline = snapshot.baseline;
	for (const variant of [
		{ ...baseline, build: { ...baseline.build!, engine: "remotion" as const } },
		{ ...baseline, build: { ...baseline.build!, entryFile: "unknown.ts" } },
		{ ...baseline, build: { ...baseline.build!, inputs: [] } },
		{
			...baseline,
			build: {
				...baseline.build!,
				inputProps: {
					assetKind: "svg",
					modelId: "assets/model.glb",
					animation: props.animation,
				},
			},
		},
		{
			...baseline,
			build: {
				...baseline.build!,
				inputProps: {
					assetKind: "model",
					modelId: "other.glb",
					animation: props.animation,
				},
			},
		},
		{
			...baseline,
			build: {
				...baseline.build!,
				inputProps: { assetKind: "model", modelId: "assets/model.glb" },
			},
		},
		{
			...baseline,
			resources: [{ ...baseline.resources![0], mimeType: "image/svg+xml" }],
		},
	])
		expect(
			objectAnimationFieldsVisible({
				state: { ...snapshot, baseline: variant },
			}),
		).toBe(false);
});

test("ordinary zero-based clip index remains numeric and named paths never admit numeric clip", () => {
	let text = modelState().inputProps;
	const fields = () =>
		ProgrammaticObjectAnimationFields({
			id: "m",
			state: modelState({ text }),
			canCompile: true,
			onEdit: (patch) => {
				text = patch.inputProps;
			},
		});
	const input = find({ node: fields(), id: "m-animation-clip" });
	expect(input).toBeDefined();
	input!.onChange!({ target: { value: "2", valueAsNumber: 2 } });
	expect(JSON.parse(text).animation.clip).toBe(2);
	expect(JSON.parse(text).unknown).toEqual(props.unknown);
	expect(JSON.parse(text).animation.future).toEqual(props.animation.future);
	const committed = text;
	for (const value of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1, NaN, Infinity])
		find({ node: fields(), id: "m-animation-clip" })!.onChange!({
			target: { value: String(value), valueAsNumber: value },
		});
	expect(text).toBe(committed);
	expect(
		editObjectAnimationDraft({
			text,
			key: "clip",
			next: "2",
			clipType: "index",
		}),
	).toBeUndefined();
	expect(
		editObjectAnimationDraft({
			text: JSON.stringify(props),
			key: "clip",
			next: 0,
		}),
	).toBeUndefined();
	const named = state({ text: '{"animation":{"clip":0,"mode":"loop"}}' });
	expect(
		find({
			node: ProgrammaticObjectAnimationFields({
				id: "n",
				state: named,
				canCompile: true,
				onEdit: () => {},
			}),
			id: "n-animation-clip",
		}),
	).toBeUndefined();
	expect(
		objectAnimationClipType({ state: modelState({ clip: -1 }) }),
	).toBeUndefined();
});

test("native numeric clips require one complete archived selection dependency; legacy remains name-only", () => {
	const marker = {
		id: "object-animation-clip-selection.mjs",
		kind: "source" as const,
		mimeType: "application/octet-stream",
		byteLength: 240,
		sha256: "a".repeat(64),
		attachmentKey: `programmatic-source-sha256-${"a".repeat(64)}`,
	};
	const native = (inputs: unknown[], clip: string | number = 0) => {
		const snapshot = state();
		const inputProps = { ...props, animation: { ...props.animation, clip } };
		return {
			...snapshot,
			inputProps: JSON.stringify(inputProps),
			baseline: {
				...snapshot.baseline,
				build: { ...snapshot.baseline.build!, inputs, inputProps },
			},
		} as BuildDraftSnapshot;
	};
	const legacy = { id: "object-animation.mjs" };
	expect(objectAnimationClipType({ state: native([legacy]) })).toBeUndefined();
	expect(objectAnimationClipType({ state: native([legacy], "Walk") })).toBe(
		"name",
	);
	for (const invalid of [
		{ id: marker.id },
		{ ...marker, kind: "model" },
		{ ...marker, mimeType: "text/javascript" },
		{ ...marker, byteLength: 0 },
		{ ...marker, byteLength: -1 },
		{ ...marker, byteLength: 1.5 },
		{ ...marker, sha256: "A".repeat(64) },
		{ ...marker, sha256: "a".repeat(63) },
		{ ...marker, attachmentKey: `programmatic-sha256-${marker.sha256}` },
		{ ...marker, unknown: true },
	])
		expect(
			objectAnimationClipType({ state: native([legacy, invalid]) }),
		).toBeUndefined();
	expect(
		objectAnimationClipType({ state: native([legacy, marker, marker]) }),
	).toBeUndefined();
	expect(objectAnimationClipType({ state: native([legacy, marker]) })).toBe(
		"index",
	);
	expect(
		objectAnimationClipType({ state: native([legacy, marker], "Walk") }),
	).toBe("name");
	let text = native([legacy, marker]).inputProps;
	const snapshot = native([legacy, marker]);
	const fields = ProgrammaticObjectAnimationFields({
		id: "native",
		state: { ...snapshot, inputProps: text },
		canCompile: true,
		onEdit: (patch) => {
			text = patch.inputProps;
		},
	});
	find({ node: fields, id: "native-animation-clip" })!.onChange!({
		target: { value: "1", valueAsNumber: 1 },
	});
	expect(JSON.parse(text)).toEqual({
		...props,
		animation: { ...props.animation, clip: 1 },
	});
});

interface Control {
	id?: string;
	children?: ReactNode;
	disabled?: boolean;
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
			const result = find({ node: child, id });
			if (result) return result;
		}
	} else if (isValidElement<Control>(node)) {
		if (node.props.id === id) return node.props;
		return find({ node: node.props.children, id });
	}
}
const props = {
	animation: {
		clip: "Walk",
		mode: "loop",
		speed: 1,
		offset: 0,
		future: { keep: true },
	},
	unknown: [1, false],
};
function state({
	text = JSON.stringify(props),
	changes = {},
}: {
	text?: string;
	changes?: Partial<BuildDraftSnapshot>;
} = {}): BuildDraftSnapshot {
	return {
		baseline: {
			build: {
				engine: "three",
				entryFile: "scene.ts",
				inputs: [{ id: "object-animation.mjs" }],
				inputProps: props,
			},
			resources: [{ kind: "model", mimeType: "model/gltf-binary" }],
		} as unknown as BuildDraftSnapshot["baseline"],
		selectedId: "scene.ts",
		entryFile: "scene.ts",
		fileIds: [],
		files: {},
		inputProps: text,
		dirty: false,
		conflict: false,
		phase: null,
		error: null,
		...changes,
	};
}
test("animation gate requires Three, actual GLB descriptor, archived module and existing baseline animation", () => {
	expect(objectAnimationFieldsVisible({ state: state() })).toBe(true);
	const baseline = state().baseline;
	for (const variant of [
		{ ...baseline, build: { ...baseline.build!, engine: "remotion" as const } },
		{ ...baseline, resources: [] },
		{
			...baseline,
			resources: [{ ...baseline.resources![0], mimeType: "image/svg+xml" }],
		},
		{ ...baseline, build: { ...baseline.build!, inputs: [] } },
		{ ...baseline, build: { ...baseline.build!, inputProps: {} } },
	]) {
		const snapshot = state({ changes: { baseline: variant } });
		expect(objectAnimationFieldsVisible({ state: snapshot })).toBe(false);
	}
});
test("existing clip/mode/speed/offset edit JSON without defaults, clamps, clip catalogs or loss", () => {
	let text = JSON.stringify(props);
	const fields = () =>
		ProgrammaticObjectAnimationFields({
			id: "a",
			state: state({ text }),
			canCompile: true,
			onEdit: (patch) => {
				text = patch.inputProps;
			},
		});
	for (const [key, value] of [
		["clip", "Exact named clip"],
		["mode", "clamp"],
		["speed", -2.125],
		["offset", -17.75],
	] as const) {
		const control = find({ node: fields(), id: `a-animation-${key}` });
		expect(control).toBeDefined();
		control!.onChange!({
			target: {
				value: String(value),
				valueAsNumber: typeof value === "number" ? value : undefined,
			},
		});
	}
	expect(JSON.parse(text)).toEqual({
		...props,
		animation: {
			...props.animation,
			clip: "Exact named clip",
			mode: "clamp",
			speed: -2.125,
			offset: -17.75,
		},
	});
	for (const [key, next] of [
		["clip", ""],
		["mode", "pingpong"],
		["speed", Infinity],
		["offset", NaN],
	] as const)
		expect(editObjectAnimationDraft({ text, key, next })).toBeUndefined();
	const sparse = '{"animation":{"clip":"Walk","mode":"loop"},"unknown":true}';
	expect(
		editObjectAnimationDraft({ text: sparse, key: "speed", next: 1 }),
	).toBeUndefined();
	const node = ProgrammaticObjectAnimationFields({
		id: "a",
		state: state({ text: sparse }),
		canCompile: true,
		onEdit: () => {},
	});
	expect(find({ node, id: "a-animation-speed" })).toBeUndefined();
	expect(find({ node, id: "a-animation-offset" })).toBeUndefined();
});
test("invalid JSON/shapes and malformed fields retain original text and expose repair guidance", () => {
	for (const text of [
		"{",
		"null",
		"[]",
		'{"animation":null}',
		'{"animation":{"speed":1e400}}',
	]) {
		expect(
			renderToStaticMarkup(
				ProgrammaticObjectAnimationFields({
					id: "a",
					state: state({ text }),
					canCompile: true,
					onEdit: () => {
						throw Error("Unexpected edit");
					},
				}),
			),
		).toContain("Fix input props JSON");
	}
	const text = '{"animation":{"clip":4,"mode":"bad","speed":null}}';
	expect(
		renderToStaticMarkup(
			ProgrammaticObjectAnimationFields({
				id: "a",
				state: state({ text }),
				canCompile: true,
				onEdit: () => {},
			}),
		),
	).toContain("Fix these values");
	expect(
		editObjectAnimationDraft({ text: "{", key: "clip", next: "Walk" }),
	).toBeUndefined();
});
test("busy, conflict and absent compiler disable every field and reject direct events", () => {
	for (const changes of [
		{ phase: "loading" },
		{ phase: "compiling" },
		{ phase: "saving" },
		{ conflict: true },
		{},
	] as const) {
		let edits = 0;
		const node = ProgrammaticObjectAnimationFields({
			id: "a",
			state: state({ changes }),
			canCompile: Object.keys(changes).length > 0,
			onEdit: () => {
				edits++;
			},
		});
		for (const key of ["clip", "mode", "speed", "offset"]) {
			const control = find({ node, id: `a-animation-${key}` });
			expect(control?.disabled).toBe(true);
			control?.onChange?.({
				target: { value: key === "mode" ? "clamp" : "2", valueAsNumber: 2 },
			});
		}
		expect(edits).toBe(0);
	}
});
test("production build panel keeps original JSON and one Apply while composing animation fields", () => {
	const html = renderToStaticMarkup(
		<ProgrammaticBuildFields
			id="a"
			state={state()}
			canLoad={true}
			canCompile={true}
			onEdit={() => {}}
			onSelect={() => {}}
			onRetry={() => {}}
			onApply={() => {}}
			onDiscard={() => {}}
			onCancel={() => {}}
			onFiles={() => {}}
		/>,
	);
	expect(html).toContain("GLB animation fields");
	expect(html).toContain('id="a-props"');
	expect(html.match(/Recompile and apply<\/button>/g)?.length).toBe(1);
});
