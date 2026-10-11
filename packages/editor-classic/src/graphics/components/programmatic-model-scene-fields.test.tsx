import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { BuildDraftSnapshot } from "./programmatic-build-draft";
import { ProgrammaticModelSceneFields } from "./programmatic-model-scene-fields";
import {
	changeModelSceneText,
	editModelSceneDraft,
	modelSceneFields,
	modelSceneFieldKey,
	modelSceneTexts,
	modelSceneResourceFields,
	selectModelSceneResource,
} from "./programmatic-model-scene-data";
const descriptor = (id: string) => ({
	id,
	kind: "source" as const,
	mimeType: "application/octet-stream",
	byteLength: 12,
	sha256: "e".repeat(64),
	attachmentKey: `programmatic-source-sha256-${"e".repeat(64)}`,
});

test("archived GLB/SVG choices preserve kind and unknown JSON without importing or selecting defaults", () => {
	const base = state(),
		first = base.baseline.resources![0];
	const s: BuildDraftSnapshot = {
		...base,
		baseline: {
			...base.baseline,
			resources: [
				first,
				{ ...first, id: "second.glb" },
				{ ...first, id: "vector.svg", mimeType: "image/svg+xml" },
				{ ...first, id: "forged.glb", attachmentKey: "wrong" },
				{ ...first, id: "duplicate.glb" },
				{ ...first, id: "duplicate.glb" },
			],
		},
	};
	expect(modelSceneResourceFields(s)[0].choices.map((r) => r.id)).toEqual([
		props.modelId,
		"second.glb",
	]);
	const selected = selectModelSceneResource({
		state: s,
		canCompile: true,
		key: "modelId",
		next: "second.glb",
	})!;
	expect(JSON.parse(selected)).toEqual({ ...props, modelId: "second.glb" });
	for (const next of [
		"",
		"vector.svg",
		"forged.glb",
		"duplicate.glb",
		"unimported.glb",
	])
		expect(
			selectModelSceneResource({
				state: s,
				canCompile: true,
				key: "modelId",
				next,
			}),
		).toBeUndefined();
	const svgProps = {
		...props,
		assetKind: "svg",
		modelId: "vector.svg",
		shape: { modeling: { kind: "flat" } },
	};
	const svg = {
		...s,
		inputProps: JSON.stringify(svgProps),
		baseline: {
			...s.baseline,
			build: { ...s.baseline.build!, inputProps: svgProps },
		},
	};
	expect(modelSceneResourceFields(svg)[0].choices.map((r) => r.id)).toEqual([
		"vector.svg",
	]);
	expect(
		selectModelSceneResource({
			state: svg,
			canCompile: true,
			key: "modelId",
			next: "second.glb",
		}),
	).toBeUndefined();
	expect(
		JSON.parse(
			selectModelSceneResource({
				state: svg,
				canCompile: true,
				key: "modelId",
				next: "vector.svg",
			})!,
		).shape,
	).toEqual(svgProps.shape);
});
test("ordinary and Ink environments, Glass image background can be selected and explicitly removed without defaults", () => {
	const base = state();
	const s: BuildDraftSnapshot = {
		...base,
		baseline: {
			...base.baseline,
			resources: [
				...base.baseline.resources!,
				{
					...resourceDescriptor("studio.hdr"),
					kind: "environment",
					mimeType: "image/vnd.radiance",
				},
				{
					...resourceDescriptor("studio.exr"),
					kind: "environment",
					mimeType: "image/x-exr",
				},
				{
					...resourceDescriptor("back.png"),
					kind: "image",
					mimeType: "image/png",
				},
				{
					...resourceDescriptor("bad.hdr"),
					kind: "image",
					mimeType: "image/vnd.radiance",
				},
			],
		},
	};
	const env = selectModelSceneResource({
		state: s,
		canCompile: true,
		key: "environmentId",
		next: "studio.exr",
	})!;
	expect(JSON.parse(env)).toEqual({ ...props, environmentId: "studio.exr" });
	const cleared = selectModelSceneResource({
		state: { ...s, inputProps: env },
		canCompile: true,
		key: "environmentId",
		next: "",
	})!;
	expect(JSON.parse(cleared)).toEqual(props);
	expect(
		selectModelSceneResource({
			state: s,
			canCompile: true,
			key: "environmentId",
			next: "bad.hdr",
		}),
	).toBeUndefined();
	const glass = {
		...s,
		baseline: {
			...s.baseline,
			build: {
				...s.baseline.build!,
				entryFile: "glass-object-scene.ts",
				inputs: [descriptor("glass-object-scene.ts")],
			},
		},
	};
	const back = selectModelSceneResource({
		state: glass,
		canCompile: true,
		key: "backgroundId",
		next: "back.png",
	})!;
	expect(JSON.parse(back)).toEqual({ ...props, backgroundId: "back.png" });
	expect(
		JSON.parse(
			selectModelSceneResource({
				state: { ...glass, inputProps: back },
				canCompile: true,
				key: "backgroundId",
				next: "",
			})!,
		),
	).toEqual(props);
	const ink = {
		...s,
		baseline: {
			...s.baseline,
			build: {
				...s.baseline.build!,
				entryFile: "ink-object-scene.ts",
				inputs: [descriptor("ink-object-scene.ts")],
			},
		},
	};
	expect(modelSceneResourceFields(ink).map((f) => f.key)).toEqual([
		"modelId",
		"environmentId",
	]);
	expect(
		JSON.parse(
			selectModelSceneResource({
				state: ink,
				canCompile: true,
				key: "environmentId",
				next: "studio.hdr",
			})!,
		).environmentId,
	).toBe("studio.hdr");
});
test("missing/invalid IDs remain visible, unsupported closure and changed kind refuse selection, all busy phases guard events", () => {
	const s = state(
		JSON.stringify({
			...props,
			modelId: "missing.glb",
			environmentId: "missing.hdr",
		}),
	);
	expect(markup(s)).toContain("Unavailable resource (retained): missing.glb");
	expect(markup(s)).toContain("missing.hdr");
	expect(markup(state(JSON.stringify({ ...props, modelId: 7 })))).toContain(
		"retained: 7",
	);
	expect(
		markup(state(JSON.stringify({ ...props, modelId: undefined }))),
	).toContain("No model selected (retained)");
	for (const changes of [
		{ phase: "loading" },
		{ phase: "compiling" },
		{ phase: "saving" },
		{ conflict: true },
		{},
	] as const) {
		const blocked = { ...s, ...changes },
			canCompile = Object.keys(changes).length > 0;
		expect(markup(blocked, canCompile)).toMatch(/<select[^>]*disabled=""/);
		expect(
			selectModelSceneResource({
				state: blocked,
				canCompile,
				key: "modelId",
				next: props.modelId,
			}),
		).toBeUndefined();
	}
	expect(
		selectModelSceneResource({
			state: state("{"),
			canCompile: true,
			key: "modelId",
			next: props.modelId,
		}),
	).toBeUndefined();
	expect(
		selectModelSceneResource({
			state: state(JSON.stringify({ ...props, assetKind: "svg" })),
			canCompile: true,
			key: "modelId",
			next: props.modelId,
		}),
	).toBeUndefined();
	const unknown = {
		...s,
		baseline: {
			...s.baseline,
			build: { ...s.baseline.build!, entryFile: "unknown.ts" },
		},
	};
	expect(modelSceneResourceFields(unknown)).toEqual([]);
	expect(
		selectModelSceneResource({
			state: unknown,
			canCompile: true,
			key: "modelId",
			next: props.modelId,
		}),
	).toBeUndefined();
});
const resourceDescriptor = (id: string) => ({
	...descriptor(id),
	attachmentKey: `programmatic-sha256-${"e".repeat(64)}`,
});
const props = {
	assetKind: "model",
	modelId: "assets/model.glb",
	camera: {
		position: [0, 0, 4],
		target: [0, 0, 0],
		fov: 37,
		near: 0.1,
		far: 100,
		future: "keep",
	},
	scale: 1,
	position: [0, 0, 0],
	rotation: [0, 0, 0],
	rotationSpeed: [0, 0, 0],
	backgroundColor: "#202b3b",
	unknown: { keep: true },
	animation: { clip: "walk", mode: "loop" },
	motion: { timeTicks: 17, future: true },
};
function state(
	text = JSON.stringify(props),
	changes: Partial<BuildDraftSnapshot> = {},
): BuildDraftSnapshot {
	return {
		baseline: {
			build: {
				engine: "three",
				entryFile: "model-feature-scene.ts",
				inputs: [descriptor("model-feature-scene.ts")],
				inputProps: props,
			},
			resources: [
				{
					...resourceDescriptor(props.modelId),
					kind: "model",
					mimeType: "model/gltf-binary",
				},
			],
		} as unknown as BuildDraftSnapshot["baseline"],
		inputProps: text,
		selectedId: "model-feature-scene.ts",
		entryFile: "model-feature-scene.ts",
		fileIds: [],
		files: {},
		dirty: false,
		conflict: false,
		phase: null,
		error: null,
		...changes,
	};
}
const keys = (s: BuildDraftSnapshot) =>
	modelSceneFields({ state: s }).map(modelSceneFieldKey);
const markup = (s = state(), canCompile = true) =>
	renderToStaticMarkup(
		<ProgrammaticModelSceneFields
			id="m"
			state={s}
			canCompile={canCompile}
			onEdit={() => {
				throw Error("render edited");
			}}
		/>,
	);
function scene(
	entryFile: string,
	files: string[],
	capabilities?: readonly ("particle-surface-v1" | "liquid-object-v1")[],
	inputProps: Record<string, unknown> = props,
) {
	const s = state();
	return {
		...s,
		inputProps: JSON.stringify(inputProps),
		baseline: {
			...s.baseline,
			build: {
				...s.baseline.build!,
				entryFile,
				inputs: files.map(descriptor),
				capabilities,
				inputProps,
			},
		},
	};
}
test("formal compile source attachment identity is admitted without admitting resource keys or wrong kind/MIME", () => {
	// Read back from the real two-clip GLB Host compile, not a fabricated generic resource.
	const actual = {
		id: "model-feature-scene.ts",
		kind: "source" as const,
		mimeType: "application/octet-stream",
		byteLength: 4063,
		sha256: "c3327e4f0284145c550f9341a27b021fc155e5fd9f4cd98fa28f9482005e9ae3",
		attachmentKey:
			"programmatic-source-sha256-c3327e4f0284145c550f9341a27b021fc155e5fd9f4cd98fa28f9482005e9ae3",
	};
	const snapshot = state(),
		base = snapshot.baseline;
	const withInput = (input: typeof actual | Record<string, unknown>) =>
		({
			...snapshot,
			baseline: { ...base, build: { ...base.build!, inputs: [input] } },
		}) as BuildDraftSnapshot;
	expect(keys(withInput(actual))).toContain("camera.position");
	for (const patch of [
		{ kind: "model" },
		{ attachmentKey: `programmatic-sha256-${actual.sha256}` },
		{ mimeType: "text/plain" },
		{ byteLength: 0 },
		{ sha256: "invalid" },
	])
		expect(keys(withInput({ ...actual, ...patch }))).toEqual([]);
	const resource = base.resources![0];
	expect(
		keys({
			...snapshot,
			baseline: {
				...base,
				resources: [
					{
						...resource,
						attachmentKey: `programmatic-source-sha256-${resource.sha256}`,
					},
				],
			},
		}),
	).toEqual([]);
});
test("ordinary model gate requires fixed complete author closure, complete matching model and actual engine", () => {
	expect(keys(state())).toContain("camera.position");
	expect(keys(state())).toContain("position");
	const base = state().baseline;
	for (const variant of [
		{ ...base, build: { ...base.build!, engine: "remotion" as const } },
		{ ...base, build: { ...base.build!, entryFile: "custom-shader.ts" } },
		{ ...base, build: { ...base.build!, inputs: [] } },
		{
			...base,
			build: {
				...base.build!,
				inputs: [
					{ ...descriptor("model-feature-scene.ts"), attachmentKey: "forged" },
				],
			},
		},
		{
			...base,
			build: {
				...base.build!,
				inputProps: { ...props, modelId: "missing.glb" },
			},
		},
		{ ...base, resources: [{ ...base.resources![0], sha256: "invalid" }] },
		{ ...base, resources: [{ ...base.resources![0], kind: "image" as const }] },
	])
		expect(keys(state(undefined, { baseline: variant }))).toEqual([]);
});
test("only consumed public subsets: native object params untouched, Particle duplicate fields hidden, Liquid fixed camera hidden", () => {
	expect(
		keys(
			scene("glass-object-scene.ts", ["glass-object-scene.ts"], undefined, {
				...props,
				glass: { color: [1, 1, 1] },
			}),
		),
	).toContain("backgroundColor");
	const ink = keys(
		scene("ink-object-scene.ts", ["ink-object-scene.ts"], undefined, {
			...props,
			ink: { inkDensity: 1 },
		}),
	);
	expect(ink).toContain("rotationSpeed");
	expect(ink).not.toContain("backgroundColor");
	expect(ink).not.toContain("ink.inkDensity");
	const particle = scene(
		"particle-scene.ts",
		["particle-scene.ts"],
		["particle-surface-v1"],
	);
	expect(keys(particle)).toContain("camera.fov");
	expect(keys(particle)).toContain("rotation");
	for (const key of ["scale", "position", "rotationSpeed", "backgroundColor"])
		expect(keys(particle)).not.toContain(key);
	expect(keys(scene("particle-scene.ts", ["particle-scene.ts"]))).toEqual([]);
	const liquid = scene(
		"liquid-object-scene.ts",
		["liquid-object-scene.ts", "liquid-object-geometry.mjs"],
		["liquid-object-v1"],
		{ ...props, liquid: { amount: 0.3 } },
	);
	expect(keys(liquid)).toEqual(["backgroundColor"]);
	expect(
		keys(
			scene(
				"liquid-object-scene.ts",
				["liquid-object-scene.ts"],
				["liquid-object-v1"],
			),
		),
	).toEqual([]);
});
test("ordinary environment controls require complete corresponding environment, not arbitrary light or material fields", () => {
	const s = state(),
		declared = {
			...props,
			environmentId: "assets/studio.hdr",
			intensity: 0.75,
			environmentBackground: false,
			light: { intensity: 10 },
			material: { roughness: 0.5 },
		};
	const snapshot = {
		...s,
		inputProps: JSON.stringify(declared),
		baseline: {
			...s.baseline,
			build: { ...s.baseline.build!, inputProps: declared },
			resources: [
				...s.baseline.resources!,
				{
					...resourceDescriptor(declared.environmentId),
					kind: "environment" as const,
					mimeType: "image/vnd.radiance",
				},
			],
		},
	};
	expect(keys(snapshot)).toContain("intensity");
	expect(keys(snapshot)).toContain("environmentBackground");
	expect(keys(snapshot)).not.toContain("light.intensity");
	expect(keys(snapshot)).not.toContain("material.roughness");
	expect(
		keys({
			...snapshot,
			baseline: { ...snapshot.baseline, resources: s.baseline.resources },
		}),
	).not.toContain("intensity");
	const texts = modelSceneTexts({ state: snapshot })!;
	texts.environmentBackground = "true";
	const result = editModelSceneDraft({ state: snapshot, texts });
	expect(JSON.parse(result.inputProps!).environmentBackground).toBe(true);
});
test("local invalid input persists, valid batch changes only declared paths preserving unknown and clock", () => {
	const s = state(),
		texts = modelSceneTexts({ state: s })!;
	const invalid = changeModelSceneText({
		state: s,
		canCompile: true,
		texts,
		key: "camera.position",
		next: "[1,",
	})!;
	expect(invalid.texts["camera.position"]).toBe("[1,");
	expect(invalid.inputProps).toBeUndefined();
	const pending = changeModelSceneText({
		state: s,
		canCompile: true,
		texts: invalid.texts,
		key: "scale",
		next: "2",
	})!;
	expect(pending.inputProps).toBeUndefined();
	expect(pending.texts.scale).toBe("2");
	const repaired = changeModelSceneText({
		state: s,
		canCompile: true,
		texts: pending.texts,
		key: "camera.position",
		next: "[1,2,3]",
	})!;
	const result = JSON.parse(repaired.inputProps!);
	expect(result.camera.position).toEqual([1, 2, 3]);
	expect(result.scale).toBe(2);
	expect(result.camera.future).toBe("keep");
	expect(result.motion).toEqual(props.motion);
	expect(result.animation).toEqual(props.animation);
	expect(result.unknown).toEqual(props.unknown);
	expect(
		changeModelSceneText({
			state: s,
			canCompile: true,
			texts,
			key: "motion.timeTicks",
			next: "20",
		}),
	).toBeUndefined();
	for (const [key, next] of [
		["camera.fov", "1e400"],
		["scale", "null"],
		["rotation", "[0,0]"],
		["backgroundColor", "red"],
		["scale", ""],
	] as const)
		expect(
			changeModelSceneText({ state: s, canCompile: true, texts, key, next })!
				.inputProps,
		).toBeUndefined();
	// Finite presentation does not silently clamp native/author policy.
	expect(
		JSON.parse(
			changeModelSceneText({
				state: s,
				canCompile: true,
				texts,
				key: "scale",
				next: "-2",
			})!.inputProps!,
		).scale,
	).toBe(-2);
});
test("baseline missing fields not installed, draft missing remains absent, malformed JSON retained", () => {
	const s = state(),
		sparse = {
			assetKind: "model",
			modelId: props.modelId,
			camera: { fov: 37 },
			unknown: true,
		};
	const snapshot = {
		...s,
		inputProps: JSON.stringify(sparse),
		baseline: {
			...s.baseline,
			build: { ...s.baseline.build!, inputProps: sparse },
		},
	};
	expect(keys(snapshot)).toEqual(["camera.fov"]);
	expect(Object.keys(modelSceneTexts({ state: snapshot })!)).toEqual([
		"camera.fov",
	]);
	const result = editModelSceneDraft({
		state: snapshot,
		texts: { "camera.fov": "45" },
	});
	expect(JSON.parse(result.inputProps!)).toEqual({
		...sparse,
		camera: { fov: 45 },
	});
	const missing = state('{"camera":{"fov":37},"unknown":true}');
	expect(Object.keys(modelSceneTexts({ state: missing })!)).toEqual([
		"camera.fov",
	]);
	for (const text of ["{", "null", "[]", '{"camera":{"fov":1e400}}'])
		expect(markup(state(text))).toContain("original text is retained");
	expect(markup()).toContain("degrees");
	expect(markup()).toContain("radians/second");
	expect(markup()).not.toContain("<button");
});
test("busy/conflict/no compiler disable every input and direct transition, preserving draft flow", () => {
	for (const changes of [
		{ phase: "loading" },
		{ phase: "compiling" },
		{ phase: "saving" },
		{ conflict: true },
		{},
	] as const) {
		const s = state(undefined, changes),
			canCompile = Object.keys(changes).length > 0;
		expect(markup(s, canCompile)).toContain('disabled=""');
		expect(
			changeModelSceneText({
				state: s,
				canCompile,
				texts: modelSceneTexts({ state: s })!,
				key: "scale",
				next: "2",
			}),
		).toBeUndefined();
	}
});
