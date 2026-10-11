import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { BuildDraftSnapshot } from "./programmatic-build-draft";
import { ProgrammaticObjectAnimationFields } from "./programmatic-object-animation-fields";
import { ProgrammaticAnimationCatalogChoices } from "./programmatic-animation-catalog-fields";
import {
	animationCatalogClips,
	animationCatalogResource,
	selectAnimationCatalogClip,
	readAnimationCatalog,
} from "./programmatic-animation-catalog-data";

const resource = {
	id: "model.glb",
	kind: "model" as const,
	mimeType: "model/gltf-binary",
	byteLength: 1744,
	sha256: "e".repeat(64),
	attachmentKey: `programmatic-sha256-${"e".repeat(64)}`,
};
const catalog = {
	version: 1,
	resource,
	clips: [
		{ index: 0, name: "move", duration: 2 },
		{ index: 1, name: "", duration: 1 },
	],
};
function state(clip: string | number): BuildDraftSnapshot {
	const inputProps = {
		assetKind: "model",
		modelId: resource.id,
		animation: { clip, mode: "loop", future: false },
		unknown: [12, false],
	};
	return {
		baseline: {
			resources: [resource],
			build: {
				engine: "three",
				entryFile: "model-feature-scene.ts",
				inputs: [{ id: "model-feature-scene.ts" }],
				inputProps,
			},
		},
		inputProps: JSON.stringify(inputProps),
		phase: null,
		conflict: false,
	} as unknown as BuildDraftSnapshot;
}

test("catalog selection preserves baseline clip representation and unknown draft fields", () => {
	const clips = animationCatalogClips(catalog, resource);
	for (const clip of ["manual", 7]) {
		const snapshot = state(clip);
		expect(animationCatalogResource(snapshot)).toEqual(resource);
		const result = JSON.parse(selectAnimationCatalogClip(snapshot, clips, 0)!);
		expect(result.animation.clip).toBe(typeof clip === "number" ? 0 : "move");
		expect(result.animation.future).toBe(false);
		expect(result.unknown).toEqual([12, false]);
		expect(JSON.parse(snapshot.inputProps).animation.clip).toBe(clip);
	}
	expect(selectAnimationCatalogClip(state("manual"), clips, 1)).toBeUndefined();
	expect(
		JSON.parse(selectAnimationCatalogClip(state(0), clips, 1)!).animation.clip,
	).toBe(1);
	expect(
		selectAnimationCatalogClip(
			state("manual"),
			[...clips, { index: 2, name: "move", duration: 1 }],
			0,
		),
	).toBeUndefined();
	expect(selectAnimationCatalogClip(state(0), clips, 99)).toBeUndefined();
	const originalModel = state(0);
	const changedModel = {
		...originalModel,
		inputProps: JSON.stringify({
			...JSON.parse(originalModel.inputProps),
			modelId: "other.glb",
		}),
	};
	expect(selectAnimationCatalogClip(changedModel, clips, 0)).toBeUndefined();
});

test("loaded directory presents index, name and duration without inventing a selected clip", () => {
	const markup = renderToStaticMarkup(
		<ProgrammaticAnimationCatalogChoices
			id="m"
			state={state("manual")}
			clips={catalog.clips}
			disabled={false}
			onEdit={() => {
				throw Error("render cannot edit");
			}}
		/>,
	);
	expect(markup).toContain("0: move (2 s)");
	expect(markup).toContain("1: (unnamed) (1 s)");
	expect(markup).toMatch(/<option value="" selected="">Choose a clip/);
	expect(markup).toMatch(/<option value="1" disabled="">/);
	const blocked = renderToStaticMarkup(
		<ProgrammaticAnimationCatalogChoices
			id="m"
			state={state(0)}
			clips={catalog.clips}
			disabled={true}
			onEdit={() => {}}
		/>,
	);
	expect(blocked).toMatch(/<select[^>]*disabled=""/);
});

test("catalog metadata rejects wrong identity and malformed values without parsing GLB", () => {
	for (const value of [
		{ ...catalog, version: 2 },
		{ ...catalog, resource: { ...resource, sha256: "f".repeat(64) } },
		{ ...catalog, clips: [{ index: 0, name: "bad", duration: NaN }] },
		{ ...catalog, clips: [catalog.clips[0], catalog.clips[0]] },
	])
		expect(() => animationCatalogClips(value, resource)).toThrow();
	expect(animationCatalogClips({ ...catalog, clips: [] }, resource)).toEqual(
		[],
	);
});

test("read-only catalog adapter rejects late cancelled responses and leaves the draft untouched", async () => {
	const controller = new AbortController(),
		snapshot = state("manual"),
		original = snapshot.inputProps;
	const result = await readAnimationCatalog(
		async (args) => {
			expect(args.resource).toEqual(resource);
			expect(args.signal).toBe(controller.signal);
			return catalog;
		},
		resource,
		controller.signal,
	);
	expect(result).toEqual(catalog.clips);
	expect(snapshot.inputProps).toBe(original);
	await expect(
		readAnimationCatalog(
			async () => {
				controller.abort(Error("stale resource"));
				return catalog;
			},
			resource,
			controller.signal,
		),
	).rejects.toThrow("stale resource");
	expect(snapshot.inputProps).toBe(original);
});

test("parent animation panel offers explicit catalog read but never inspects or edits during render", () => {
	let calls = 0;
	const snapshot = state(0);
	const markup = renderToStaticMarkup(
		<ProgrammaticObjectAnimationFields
			id="m"
			state={snapshot}
			canCompile={true}
			onInspectAnimation={async () => {
				calls++;
				return catalog;
			}}
			onEdit={() => {
				throw Error("unexpected edit");
			}}
		/>,
	);
	expect(markup).toContain("Read archived GLB clips");
	expect(markup).toContain('id="m-animation-clip"');
	expect(markup).not.toContain('id="m-animation-catalog"');
	expect(calls).toBe(0);
	const unavailable = renderToStaticMarkup(
		<ProgrammaticObjectAnimationFields
			id="m"
			state={snapshot}
			canCompile={true}
			onEdit={() => {}}
		/>,
	);
	expect(unavailable).toContain("Manual clip input remains available");
	expect(unavailable).toMatch(
		/<button[^>]*disabled=""[^>]*>Read archived GLB clips/,
	);
});

test("new native archive selects unnamed and duplicate clips by exact index, never converting legacy names", () => {
	const descriptor = (id: string) => ({
		id,
		kind: "source" as const,
		mimeType: "application/octet-stream",
		byteLength: 320,
		sha256: "c".repeat(64),
		attachmentKey: `programmatic-source-sha256-${"c".repeat(64)}`,
	});
	const native = (clip: string | number, marker = true) => {
		const snapshot = state(clip);
		return {
			...snapshot,
			baseline: {
				...snapshot.baseline,
				build: {
					...snapshot.baseline.build!,
					entryFile: "particle-animated-scene.ts",
					inputs: [
						descriptor("object-animation.mjs"),
						...(marker
							? [descriptor("object-animation-clip-selection.mjs")]
							: []),
					],
				},
			},
		};
	};
	const clips = [...catalog.clips, { index: 2, name: "move", duration: 4 }];
	for (const index of [0, 1, 2]) {
		const snapshot = native(7);
		const result = JSON.parse(
			selectAnimationCatalogClip(snapshot, clips, index)!,
		);
		expect(result.animation.clip).toBe(index);
		expect(result.animation.future).toBe(false);
		expect(result.unknown).toEqual([12, false]);
		expect(JSON.parse(snapshot.inputProps).animation.clip).toBe(7);
		expect(
			selectAnimationCatalogClip(native(7, false), clips, index),
		).toBeUndefined();
		expect(
			selectAnimationCatalogClip(native("manual"), clips, index),
		).toBeUndefined();
	}
	for (const changes of [
		{ phase: "loading" as const },
		{ phase: "compiling" as const },
		{ phase: "saving" as const },
		{ conflict: true },
	])
		expect(
			selectAnimationCatalogClip({ ...native(7), ...changes }, clips, 1),
		).toBeUndefined();
	for (const clip of [7, "move"]) {
		const markup = renderToStaticMarkup(
			<ProgrammaticAnimationCatalogChoices
				id="native"
				state={native(clip)}
				clips={clips}
				disabled={false}
				onEdit={() => {
					throw Error("render must not edit");
				}}
			/>,
		);
		expect(markup).toMatch(/<option value="" selected="">Choose a clip/);
		if (typeof clip === "number")
			expect(markup).not.toMatch(/<option value="[012]" disabled=""/);
		else
			for (const index of [0, 1, 2])
				expect(markup).toContain(`<option value="${index}" disabled="">`);
	}
	const markup = renderToStaticMarkup(
		<ProgrammaticObjectAnimationFields
			id="native"
			state={native(7)}
			canCompile={true}
			onInspectAnimation={async () => {
				throw Error("render must not inspect");
			}}
			onEdit={() => {}}
		/>,
	);
	expect(markup).toContain("Read archived GLB clips");
	expect(markup).toContain("zero-based index");
	expect(markup).not.toContain('id="native-animation-catalog"');
});
