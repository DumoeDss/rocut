import { expect, test } from "bun:test";
import { isValidElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { BuildDraftSnapshot } from "./programmatic-build-draft";
import { ProgrammaticBuildFields } from "./programmatic-build-fields";
import { ProgrammaticParticleImageFields } from "./programmatic-particle-image-fields";
import {
	editParticleImageDraft,
	particleImageFieldsVisible,
	particleImageResources,
} from "./programmatic-particle-image-data";

const sha = "a".repeat(64),
	entry = "particle-image-scene.ts";
const source = {
	id: entry,
	kind: "source" as const,
	mimeType: "application/octet-stream",
	byteLength: 100,
	sha256: sha,
	attachmentKey: `programmatic-source-sha256-${sha}`,
};
const image = (id: string, mimeType: string) => ({
	id,
	kind: "image" as const,
	mimeType,
	byteLength: 12,
	sha256: sha,
	attachmentKey: `programmatic-sha256-${sha}`,
});
const props = {
	imageId: "missing.png",
	plane: { width: 2, height: 3, future: false },
	alphaTest: 0.1,
	count: 321,
	sampling: { keep: true },
	unknown: [12, false],
};
function state(text = JSON.stringify(props)): BuildDraftSnapshot {
	return {
		baseline: {
			build: {
				engine: "three",
				entryFile: entry,
				inputs: [source],
				capabilities: ["particle-surface-v1"],
				inputProps: props,
			},
			resources: [
				image("a.png", "image/png"),
				image("b.jpg", "image/jpeg"),
				image("c.webp", "image/webp"),
			],
		},
		inputProps: text,
		selectedId: entry,
		entryFile: entry,
		fileIds: [entry],
		files: {},
		dirty: false,
		phase: null,
		conflict: false,
		error: null,
	} as BuildDraftSnapshot;
}
type Control = {
	id?: string;
	children?: ReactNode;
	disabled?: boolean;
	onChange?: (event: {
		target: { value: string; valueAsNumber?: number };
	}) => void;
};
function find(node: ReactNode, id: string): Control | undefined {
	if (Array.isArray(node)) {
		for (const child of node) {
			const result = find(child, id);
			if (result) return result;
		}
	} else if (isValidElement<Control>(node)) {
		if (node.props.id === id) return node.props;
		return find(node.props.children, id);
	}
}

test("image fields require exact archived image scene, capability and complete supported image resources", () => {
	const snapshot = state(),
		baseline = snapshot.baseline,
		build = baseline.build!;
	expect(particleImageFieldsVisible(snapshot)).toBe(true);
	expect(
		particleImageResources(snapshot).map((resource) => resource.id),
	).toEqual(["a.png", "b.jpg", "c.webp"]);
	for (const variant of [
		{ ...baseline, build: { ...build, engine: "remotion" } },
		{ ...baseline, build: { ...build, entryFile: "particle-scene.ts" } },
		{ ...baseline, build: { ...build, capabilities: [] } },
		{ ...baseline, build: { ...build, inputs: [{ id: entry }] } },
		{
			...baseline,
			build: { ...build, inputs: [{ ...source, attachmentKey: "wrong" }] },
		},
		{ ...baseline, build: { ...build, inputs: [source, source] } },
		{ ...baseline, resources: [image("a.svg", "image/svg+xml")] },
		{
			...baseline,
			resources: [{ ...image("a.png", "image/png"), kind: "model" }],
		},
		{
			...baseline,
			resources: [{ ...image("a.png", "image/png"), byteLength: 0 }],
		},
		{
			...baseline,
			resources: [{ ...image("a.png", "image/png"), sha256: "A".repeat(64) }],
		},
		{
			...baseline,
			resources: [image("a.png", "image/png"), image("a.png", "image/jpeg")],
		},
	])
		expect(
			particleImageFieldsVisible({
				...snapshot,
				baseline: variant,
			} as BuildDraftSnapshot),
		).toBe(false);
});

test("legal additional author files retain the image panel and existing field edits", () => {
	const snapshot = state();
	snapshot.baseline = {
		...snapshot.baseline,
		build: {
			...snapshot.baseline.build!,
			inputs: [
				{ ...source, id: "support.mjs" },
				source,
				{ ...source, id: "notes.txt" },
			],
		},
	};
	expect(particleImageFieldsVisible(snapshot)).toBe(true);
	let edited: string | undefined;
	const fields = ProgrammaticParticleImageFields({
		id: "a",
		state: snapshot,
		canCompile: true,
		onEdit: (patch) => {
			edited = patch.inputProps;
		},
	});
	expect(renderToStaticMarkup(fields)).toContain("Particle image surface");
	find(fields, "a-particle-image-width")!.onChange!({
		target: { value: "7", valueAsNumber: 7 },
	});
	expect(JSON.parse(edited!)).toEqual({
		...props,
		plane: { ...props.plane, width: 7 },
	});
	expect(snapshot.baseline.build!.inputs.map((input) => input.id)).toEqual([
		"support.mjs",
		entry,
		"notes.txt",
	]);
});

test("resource and explicit plane/alpha controls edit only the draft and preserve unknown IDs until selection", () => {
	let text = state().inputProps;
	const fields = () =>
		ProgrammaticParticleImageFields({
			id: "a",
			state: state(text),
			canCompile: true,
			onEdit: (patch) => {
				text = patch.inputProps;
			},
		});
	const original = text,
		markup = renderToStaticMarkup(fields());
	expect(markup).toContain("Unknown image: missing.png");
	expect(markup).toContain("plane.width (scene units)");
	expect(text).toBe(original);
	for (const [key, value] of [
		["id", "c.webp"],
		["width", 1.25],
		["height", 9],
		["alphaTest", 0],
	] as const)
		find(fields(), `a-particle-image-${key}`)!.onChange!({
			target: {
				value: String(value),
				valueAsNumber: typeof value === "number" ? value : undefined,
			},
		});
	expect(JSON.parse(text)).toEqual({
		...props,
		imageId: "c.webp",
		plane: { ...props.plane, width: 1.25, height: 9 },
		alphaTest: 0,
	});
	expect(state().baseline.build!.inputProps).toEqual(props);
	const committed = text;
	for (const value of [0, -1, NaN, Infinity])
		find(fields(), "a-particle-image-width")!.onChange!({
			target: { value: String(value), valueAsNumber: value },
		});
	for (const value of [-0.01, 1.01, NaN, Infinity])
		find(fields(), "a-particle-image-alphaTest")!.onChange!({
			target: { value: String(value), valueAsNumber: value },
		});
	find(fields(), "a-particle-image-id")!.onChange!({
		target: { value: "external.png" },
	});
	expect(text).toBe(committed);
});

test("missing or malformed plane fields stay omitted or require JSON repair; no inferred defaults", () => {
	for (const root of [
		{ imageId: "a.png" },
		{ imageId: "a.png", plane: { height: 2 } },
	]) {
		const snapshot = state(JSON.stringify(root)),
			markup = renderToStaticMarkup(
				<ProgrammaticParticleImageFields
					id="a"
					state={snapshot}
					canCompile
					onEdit={() => {}}
				/>,
			);
		expect(markup).not.toContain('id="a-particle-image-width"');
		expect(
			editParticleImageDraft({
				state: snapshot,
				canCompile: true,
				key: "width",
				next: 3,
			}),
		).toBeUndefined();
		expect(
			editParticleImageDraft({
				state: snapshot,
				canCompile: true,
				key: "alphaTest",
				next: 0.2,
			}),
		).toBeUndefined();
	}
	for (const text of [
		"{",
		'{"imageId":"a.png","plane":null}',
		'{"imageId":"a.png","plane":{"width":-1},"alphaTest":2}',
	])
		expect(
			renderToStaticMarkup(
				<ProgrammaticParticleImageFields
					id="a"
					state={state(text)}
					canCompile
					onEdit={() => {}}
				/>,
			),
		).toContain('role="alert"');
});

test("busy/conflict/no compiler reject direct events and the parent retains one existing Apply", () => {
	for (const changes of [
		{ phase: "loading" },
		{ phase: "compiling" },
		{ phase: "saving" },
		{ conflict: true },
		{},
	]) {
		let edits = 0;
		const snapshot = { ...state(), ...changes } as BuildDraftSnapshot,
			canCompile = Object.keys(changes).length > 0;
		const fields = ProgrammaticParticleImageFields({
			id: "a",
			state: snapshot,
			canCompile,
			onEdit: () => {
				edits++;
			},
		});
		for (const key of ["id", "width", "height", "alphaTest"]) {
			const control = find(fields, `a-particle-image-${key}`)!;
			expect(control.disabled).toBe(true);
			control.onChange!({
				target: { value: key === "id" ? "a.png" : "0.5", valueAsNumber: 0.5 },
			});
		}
		expect(edits).toBe(0);
	}
	const markup = renderToStaticMarkup(
		<ProgrammaticBuildFields
			id="a"
			state={state()}
			canLoad
			canCompile
			onEdit={() => {}}
			onSelect={() => {}}
			onRetry={() => {}}
			onApply={() => {}}
			onDiscard={() => {}}
			onCancel={() => {}}
			onFiles={() => {}}
		/>,
	);
	expect(markup).toContain("Particle image surface");
	expect(markup.match(/Recompile and apply<\/button>/g)?.length).toBe(1);
});
