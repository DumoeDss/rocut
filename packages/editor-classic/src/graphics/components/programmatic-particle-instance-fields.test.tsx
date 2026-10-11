import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { BuildDraftSnapshot } from "./programmatic-build-draft";
import { ProgrammaticParticleInstanceFields } from "./programmatic-particle-instance-fields";
import {
	changeParticleInstanceTexts,
	editParticleInstanceDraft,
	particleInstanceFieldsVisible,
	particleInstanceTexts,
} from "./programmatic-particle-instance-data";

const matrix = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const props = {
	modelId: "assets/static.glb",
	instances: [matrix],
	instanceColors: [[0.2, 0.3, 0.4]],
	unknown: { keep: [false, "future"] },
	motion: { future: 17 },
};
const descriptor = (id: string) => ({
	id,
	kind: "source" as const,
	mimeType: "application/octet-stream",
	byteLength: 12,
	sha256: "e".repeat(64),
	attachmentKey: `programmatic-source-sha256-${"e".repeat(64)}`,
});
function state(
	text = JSON.stringify(props),
	changes: Partial<BuildDraftSnapshot> = {},
): BuildDraftSnapshot {
	return {
		baseline: {
			build: {
				engine: "three",
				capabilities: ["particle-surface-v1"],
				entryFile: "particle-instanced-scene.ts",
				inputs: [
					"particle-instanced-scene.ts",
					"particle-instanced-geometry.mjs",
					"particle-scene.ts",
				].map(descriptor),
				inputProps: props,
			},
			resources: [
				{
					...descriptor(props.modelId),
					attachmentKey: `programmatic-sha256-${"e".repeat(64)}`,
					kind: "model",
					mimeType: "model/gltf-binary",
				},
			],
		} as unknown as BuildDraftSnapshot["baseline"],
		selectedId: "particle-instanced-scene.ts",
		entryFile: "particle-instanced-scene.ts",
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
const html = (snapshot = state(), canCompile = true) =>
	renderToStaticMarkup(
		<ProgrammaticParticleInstanceFields
			id="p"
			state={snapshot}
			canCompile={canCompile}
			onEdit={() => {
				throw Error("render must not edit");
			}}
		/>,
	);

test("formal instancing author archive accepts source identity only, GLB remains generic resource identity", () => {
	// Exact readback from the successful real imported-GLB formal instancing compile.
	const inputs = [
		[
			"particle-instanced-geometry.mjs",
			6387,
			"f0e7173acb0345b1c28c3c79e9e40d7d083d688e4dd6ee2f887f8fb84717f2dc",
		],
		[
			"particle-instanced-scene.ts",
			2457,
			"2595c81813cfeeb6aa479b223cbebae68eda2b4fa8593dbb7e715cd26008d795",
		],
		[
			"particle-scene.ts",
			4119,
			"e0b16ad500be6aef97763ee34b650f30d734988aabac3efcf31ee4d498a28ae5",
		],
	] as const;
	const sourceInputs = inputs.map(([id, byteLength, sha256]) => ({
		id,
		byteLength,
		sha256,
		kind: "source" as const,
		mimeType: "application/octet-stream",
		attachmentKey: `programmatic-source-sha256-${sha256}`,
	}));
	const snapshot = state(),
		baseline = {
			...snapshot.baseline,
			build: { ...snapshot.baseline.build!, inputs: sourceInputs },
		};
	expect(
		particleInstanceFieldsVisible({ state: { ...snapshot, baseline } }),
	).toBe(true);
	for (const patch of [
		{ kind: "model" as const },
		{ mimeType: "text/plain" },
		{ byteLength: 0 },
		{ sha256: "invalid" },
	])
		expect(
			particleInstanceFieldsVisible({
				state: {
					...snapshot,
					baseline: {
						...baseline,
						build: {
							...baseline.build,
							inputs: sourceInputs.map((input) => ({ ...input, ...patch })),
						},
					},
				},
			}),
		).toBe(false);
	expect(
		particleInstanceFieldsVisible({
			state: {
				...snapshot,
				baseline: {
					...baseline,
					build: {
						...baseline.build,
						inputs: sourceInputs.map((input) => ({
							...input,
							attachmentKey: `programmatic-sha256-${input.sha256}`,
						})),
					},
				},
			},
		}),
	).toBe(false);
	expect(
		particleInstanceFieldsVisible({
			state: {
				...snapshot,
				baseline: {
					...baseline,
					resources: baseline.resources!.map((resource) => ({
						...resource,
						attachmentKey: `programmatic-source-sha256-${resource.sha256}`,
					})),
				},
			},
		}),
	).toBe(false);
});
test("gate binds actual baseline engine/capability, exact complete archive, corresponding complete GLB and instances", () => {
	expect(particleInstanceFieldsVisible({ state: state() })).toBe(true);
	const baseline = state().baseline,
		build = baseline.build!;
	for (const variant of [
		{ ...baseline, build: { ...build, engine: "remotion" as const } },
		{ ...baseline, build: { ...build, capabilities: [] } },
		{ ...baseline, build: { ...build, entryFile: "particle-scene.ts" } },
		{ ...baseline, build: { ...build, inputs: build.inputs.slice(0, 2) } },
		{
			...baseline,
			build: { ...build, inputs: [...build.inputs, descriptor("extra.ts")] },
		},
		{
			...baseline,
			build: {
				...build,
				inputs: build.inputs.map((x) => ({ ...x, attachmentKey: "forged" })),
			},
		},
		{
			...baseline,
			build: { ...build, inputProps: { ...props, modelId: "other.glb" } },
		},
		{
			...baseline,
			build: { ...build, inputProps: { modelId: props.modelId } },
		},
		{
			...baseline,
			resources: [{ ...baseline.resources![0], kind: "image" as const }],
		},
		{ ...baseline, resources: [{ ...baseline.resources![0], byteLength: 0 }] },
	])
		expect(
			particleInstanceFieldsVisible({
				state: state(undefined, { baseline: variant }),
			}),
		).toBe(false);
	expect(html(state("{}"))).toContain("original text is retained");
});

test("local invalid text survives without publishing and paired length edit commits only valid complete JSON", () => {
	const snapshot = state();
	let drafts = particleInstanceTexts(snapshot.inputProps)!;
	const broken = changeParticleInstanceTexts({
		state: snapshot,
		canCompile: true,
		drafts,
		key: "instances",
		next: "[",
	})!;
	expect(broken.drafts.instances).toBe("[");
	expect(broken.inputProps).toBeUndefined();
	expect(broken.error).toContain("valid JSON");
	drafts = broken.drafts;
	const longer = changeParticleInstanceTexts({
		state: snapshot,
		canCompile: true,
		drafts,
		key: "instances",
		next: JSON.stringify([matrix, matrix]),
	})!;
	expect(longer.inputProps).toBeUndefined();
	expect(longer.count).toBe(2);
	expect(longer.drafts.instances).toContain("[");
	const matched = changeParticleInstanceTexts({
		state: snapshot,
		canCompile: true,
		drafts: longer.drafts,
		key: "instanceColors",
		next: "[[1,0,0],[0,1,0]]",
	})!;
	expect(matched.error).toBeUndefined();
	const result = JSON.parse(matched.inputProps!);
	expect(result.instances).toEqual([matrix, matrix]);
	expect(result.instanceColors).toEqual([
		[1, 0, 0],
		[0, 1, 0],
	]);
	expect(result.unknown).toEqual(props.unknown);
	expect(result.motion).toEqual(props.motion);
	expect(snapshot.inputProps).toBe(JSON.stringify(props));
});

test("missing colors remain absent, no defaults, math or control rewrites; singular affine matrices reach compiler", () => {
	const { instanceColors: _omitted, ...sparse } = props,
		snapshot = state(JSON.stringify(sparse)),
		drafts = particleInstanceTexts(snapshot.inputProps)!;
	expect(drafts.instanceColors).toBeUndefined();
	expect(html(snapshot)).not.toContain('id="p-instanceColors"');
	expect(
		changeParticleInstanceTexts({
			state: snapshot,
			canCompile: true,
			drafts,
			key: "instanceColors",
			next: "[[1,1,1]]",
		}),
	).toBeUndefined();
	const singular = matrix.map((v, i) => (i === 0 ? 0 : v));
	const result = editParticleInstanceDraft({
		text: snapshot.inputProps,
		drafts: { instances: JSON.stringify([singular]) },
	});
	expect(result.error).toBeUndefined();
	expect(Object.hasOwn(JSON.parse(result.inputProps!), "instanceColors")).toBe(
		false,
	);
	expect(JSON.parse(result.inputProps!).motion).toEqual(props.motion);
});

test("presentation rejects finite/affine/RGB/count violations and retains full invalid JSON", () => {
	for (const next of [
		"[]",
		JSON.stringify(Array(65).fill(matrix)),
		"[[1e400]]",
		JSON.stringify([matrix.slice(1)]),
		JSON.stringify([matrix.map((v, i) => (i === 3 ? 1 : v))]),
	])
		expect(
			editParticleInstanceDraft({
				text: state().inputProps,
				drafts: { instances: next, instanceColors: "[[1,1,1]]" },
			}).inputProps,
		).toBeUndefined();
	for (const next of [
		"null",
		"[[2,0,0]]",
		"[[-1,0,0]]",
		"[[1,1,1,1]]",
		"[[1e400,0,0]]",
		'["red"]',
	])
		expect(
			editParticleInstanceDraft({
				text: state().inputProps,
				drafts: { instances: JSON.stringify([matrix]), instanceColors: next },
			}).inputProps,
		).toBeUndefined();
	for (const text of [
		"{",
		"null",
		"[]",
		'{"instances":[],"unknown":1e400}',
		"{}",
	])
		expect(
			editParticleInstanceDraft({
				text,
				drafts: { instances: JSON.stringify([matrix]) },
			}).inputProps,
		).toBeUndefined();
	expect(html()).toContain("Count: 1");
	expect(html()).toContain("linear RGB");
	expect(html()).not.toContain("<button");
});

test("busy/conflict/no compiler disable textareas and direct transitions cannot edit", () => {
	for (const changes of [
		{ phase: "loading" },
		{ phase: "compiling" },
		{ phase: "saving" },
		{ conflict: true },
		{},
	] as const) {
		const snapshot = state(undefined, changes),
			canCompile = Object.keys(changes).length > 0;
		expect(html(snapshot, canCompile).match(/disabled=""/g)?.length).toBe(3);
		for (const key of ["instances", "instanceColors"] as const)
			expect(
				changeParticleInstanceTexts({
					state: snapshot,
					canCompile,
					drafts: particleInstanceTexts(snapshot.inputProps)!,
					key,
					next: "[]",
				}),
			).toBeUndefined();
	}
});
