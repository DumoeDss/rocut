import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { BuildDraftSnapshot } from "./programmatic-build-draft";
import {
	authorObjectAnimation,
	objectAnimationAuthoringAvailable,
} from "./programmatic-object-animation-data";
import { addAnimationCatalogClip } from "./programmatic-animation-catalog-data";
import { ProgrammaticAnimationAddFields } from "./programmatic-animation-catalog-fields";
import { ProgrammaticObjectAnimationFields } from "./programmatic-object-animation-fields";
import { ProgrammaticBuildFields } from "./programmatic-build-fields";

const sha = "d".repeat(64);
const descriptor = (id: string, source = true) => ({
	id,
	kind: source ? ("source" as const) : ("model" as const),
	attachmentKey: `${source ? "programmatic-source" : "programmatic"}-sha256-${sha}`,
	mimeType: source ? "application/octet-stream" : "model/gltf-binary",
	sha256: sha,
	byteLength: 128,
});
const clips = [
	{ index: 0, name: "unique", duration: 1 },
	{ index: 1, name: "", duration: 2 },
	{ index: 2, name: "duplicate", duration: 3 },
	{ index: 3, name: "duplicate", duration: 4 },
];
function state(
	entry = "model-feature-scene.ts",
	marker = false,
): BuildDraftSnapshot {
	const inputProps = {
		assetKind: "model",
		modelId: "model.glb",
		untouched: { future: [false, 12] },
	};
	return {
		baseline: {
			build: {
				engine: "three",
				entryFile: entry,
				inputProps,
				inputs: [
					descriptor(entry),
					...(marker
						? [
								descriptor("object-animation.mjs"),
								descriptor("object-animation-clip-selection.mjs"),
							]
						: []),
				],
			},
			resources: [descriptor("model.glb", false)],
		},
		inputProps: JSON.stringify(inputProps),
		selectedId: entry,
		entryFile: entry,
		files: {},
		fileIds: [],
		dirty: false,
		phase: null,
		conflict: false,
		error: null,
	} as BuildDraftSnapshot;
}

test("optional animation authoring recognizes complete model and old/new Glass/Ink archives only", () => {
	for (const entry of [
		"model-feature-scene.ts",
		"glass-object-scene.ts",
		"ink-object-scene.ts",
	])
		for (const marker of [false, true])
			expect(objectAnimationAuthoringAvailable(state(entry, marker))).toBe(
				true,
			);
	for (const entry of [
		"particle-scene.ts",
		"particle-animated-scene.ts",
		"liquid-object-scene.ts",
		"liquid-animated-scene.ts",
		"unknown.ts",
	])
		expect(objectAnimationAuthoringAvailable(state(entry, true))).toBe(false);
	const snapshot = state(),
		build = snapshot.baseline.build!;
	for (const baseline of [
		{
			...snapshot.baseline,
			build: { ...build, inputs: [{ id: build.entryFile }] },
		},
		{
			...snapshot.baseline,
			build: {
				...build,
				inputs: [descriptor(build.entryFile), descriptor(build.entryFile)],
			},
		},
		{
			...snapshot.baseline,
			build: {
				...build,
				inputProps: { assetKind: "svg", modelId: "model.glb" },
			},
		},
		{
			...snapshot.baseline,
			resources: [
				{ ...descriptor("model.glb", false), mimeType: "image/svg+xml" },
			],
		},
		{
			...snapshot.baseline,
			resources: [
				{ ...descriptor("model.glb", false), attachmentKey: "wrong" },
			],
		},
	])
		expect(
			objectAnimationAuthoringAvailable({
				...snapshot,
				baseline,
			} as BuildDraftSnapshot),
		).toBe(false);
});

test("explicit catalog Add keeps chosen representation and props; legacy names never upgrade to indexes", () => {
	for (const entry of [
		"model-feature-scene.ts",
		"glass-object-scene.ts",
		"ink-object-scene.ts",
	]) {
		const legacy = state(entry),
			modern = state(entry, true);
		const named = addAnimationCatalogClip(
			legacy,
			clips,
			0,
			"name",
			"clamp",
			-2,
			-3,
		)!;
		expect(JSON.parse(named)).toEqual({
			...JSON.parse(legacy.inputProps),
			animation: { clip: "unique", mode: "clamp", speed: -2, offset: -3 },
		});
		for (const index of [1, 2, 3]) {
			expect(
				addAnimationCatalogClip(legacy, clips, index, "name", "loop", 1, 0),
			).toBeUndefined();
			expect(
				JSON.parse(
					addAnimationCatalogClip(modern, clips, index, "index", "loop", 1, 0)!,
				).animation.clip,
			).toBe(index);
			if (entry !== "model-feature-scene.ts")
				expect(
					addAnimationCatalogClip(legacy, clips, index, "index", "loop", 1, 0),
				).toBeUndefined();
		}
		const enabled = { ...legacy, inputProps: named };
		const removed = authorObjectAnimation({ state: enabled })!;
		expect(JSON.parse(removed)).toEqual(JSON.parse(legacy.inputProps));
		expect(authorObjectAnimation({ state: legacy })).toBeUndefined();
		expect(
			addAnimationCatalogClip(enabled, clips, 0, "name", "loop", 1, 0),
		).toBeUndefined();
	}
	const named = state();
	named.baseline = {
		...named.baseline,
		build: {
			...named.baseline.build!,
			inputProps: {
				...JSON.parse(named.inputProps),
				animation: { clip: "unique" },
			},
		},
	};
	expect(
		addAnimationCatalogClip(named, clips, 1, "index", "loop", 1, 0),
	).toBeUndefined();
});

test("native Glass/Ink helper props omit assetKind and still support explicit optional playback", () => {
	for (const entry of ["glass-object-scene.ts", "ink-object-scene.ts"]) {
		const snapshot = state(entry, true),
			props = JSON.parse(snapshot.inputProps);
		delete props.assetKind;
		snapshot.baseline = {
			...snapshot.baseline,
			build: { ...snapshot.baseline.build!, inputProps: props },
		};
		snapshot.inputProps = JSON.stringify(props);
		expect(objectAnimationAuthoringAvailable(snapshot)).toBe(true);
		const added = addAnimationCatalogClip(
			snapshot,
			clips,
			1,
			"index",
			"loop",
			1,
			0,
		)!;
		expect(JSON.parse(added).assetKind).toBeUndefined();
		expect(
			JSON.parse(
				authorObjectAnimation({ state: { ...snapshot, inputProps: added } })!,
			),
		).toEqual(props);
	}
});

test("author actions reject invalid, busy, conflicted or changed model drafts without edits", () => {
	const snapshot = state();
	for (const changes of [
		{ phase: "loading" },
		{ phase: "compiling" },
		{ phase: "saving" },
		{ conflict: true },
		{ inputProps: "{" },
		{
			inputProps: JSON.stringify({ assetKind: "model", modelId: "other.glb" }),
		},
	]) {
		const blocked = { ...snapshot, ...changes } as BuildDraftSnapshot;
		expect(
			addAnimationCatalogClip(blocked, clips, 0, "name", "loop", 1, 0),
		).toBeUndefined();
		expect(authorObjectAnimation({ state: blocked })).toBeUndefined();
	}
	for (const [speed, offset] of [
		[NaN, 0],
		[1, Infinity],
	])
		expect(
			addAnimationCatalogClip(
				snapshot,
				clips,
				0,
				"name",
				"loop",
				speed,
				offset,
			),
		).toBeUndefined();
	expect(
		addAnimationCatalogClip(snapshot, clips, 99, "index", "loop", 1, 0),
	).toBeUndefined();
});

test("disabled animation offers explicit catalog read, visible playback confirmation and one existing Apply", () => {
	const snapshot = state();
	const markup = renderToStaticMarkup(
		<ProgrammaticObjectAnimationFields
			id="a"
			state={snapshot}
			canCompile
			onEdit={() => {
				throw Error("render edit");
			}}
			onInspectAnimation={async () => {
				throw Error("render inspect");
			}}
		/>,
	);
	expect(markup).toContain("Animation is not enabled");
	expect(markup).toContain("Read archived GLB clips");
	expect(markup).not.toContain("Fix input props JSON");
	const add = renderToStaticMarkup(
		<ProgrammaticAnimationAddFields
			id="a"
			state={snapshot}
			clips={clips}
			disabled={false}
			onEdit={() => {
				throw Error("render edit");
			}}
		/>,
	);
	expect(add).toMatch(/<option value="" selected="">Choose a clip/);
	expect(add).toContain("animation.mode");
	expect(add).toContain("animation.speed");
	expect(add).toContain("animation.offset");
	expect(add).toMatch(/<button[^>]*disabled=""[^>]*>Add animation/);
	const enabled = {
		...snapshot,
		inputProps: addAnimationCatalogClip(
			snapshot,
			clips,
			0,
			"name",
			"loop",
			1,
			0,
		)!,
	};
	expect(
		renderToStaticMarkup(
			<ProgrammaticObjectAnimationFields
				id="a"
				state={enabled}
				canCompile
				onEdit={() => {}}
			/>,
		),
	).toContain("Remove animation");
	expect(
		renderToStaticMarkup(
			<ProgrammaticObjectAnimationFields
				id="a"
				state={enabled}
				canCompile
				onEdit={() => {}}
			/>,
		),
	).toContain('id="a-animation-clip"');
	const panel = renderToStaticMarkup(
		<ProgrammaticBuildFields
			id="a"
			state={snapshot}
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
	expect(panel.match(/Recompile and apply<\/button>/g)?.length).toBe(1);
});
