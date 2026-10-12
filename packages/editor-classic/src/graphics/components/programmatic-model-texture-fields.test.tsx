import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { isValidElement, type ReactNode } from "react";
import type { ProgrammaticSource } from "@opencut/editor-contracts";
import type { BuildDraftSnapshot } from "./programmatic-build-draft";
import { cleanBuildDraft } from "./programmatic-build-draft-state";
import {
	blankModelTexture,
	editModelTexture,
	modelTextureContext,
	modelTextureTexts,
	MODEL_TEXTURE_SLOTS,
	MODEL_TEXTURE_CONSUMER_MARKER,
	MODEL_TEXTURE_CONSUMER_MARKER_V2,
	MODEL_TEXTURE_SLOTS_V2,
	modelTextureConsumerVersion,
	modelTextureConsumerIssue,
} from "./programmatic-model-texture-data";
import { ProgrammaticModelTextureFields } from "./programmatic-model-texture-fields";
import { ProgrammaticBuildFields } from "./programmatic-build-fields";

const sha = "a".repeat(64);
const descriptor = (
	id: string,
	kind: "source" | "model" | "image",
	mimeType: string,
) => ({
	id,
	kind,
	mimeType,
	byteLength: 123,
	sha256: sha,
	attachmentKey: `${kind === "source" ? "programmatic-source" : "programmatic"}-sha256-${sha}`,
});
function state(
	props: Record<string, unknown> = {
		assetKind: "model",
		modelId: "model.glb",
		unknown: { keep: true },
	},
) {
	const entry = descriptor(
		"model-feature-scene.ts",
		"source",
		"application/octet-stream",
	);
	const source = {
		version: 1,
		runtime: "html-document",
		code: "",
		documentId: "document.html",
		width: 320,
		height: 240,
		frameRate: { numerator: 30, denominator: 1 },
		durationFrames: 60,
		seed: 7,
		resources: [
			descriptor("model.glb", "model", "model/gltf-binary"),
			descriptor("texture.png", "image", "image/png"),
			descriptor("other.jpg", "image", "image/jpeg"),
			descriptor("other.webp", "image", "image/webp"),
		],
		build: {
			version: 1,
			engine: "three",
			engineVersion: "0.185.1",
			entryFile: entry.id,
			compositionId: "Model",
			inputs: [entry],
			inputProps: props,
			toolchainLock: { ...entry, id: "_rocut/toolchain-lock.json" },
		},
	} as ProgrammaticSource;
	const draft = cleanBuildDraft({ source });
	const code = `${MODEL_TEXTURE_CONSUMER_MARKER}\nexport function createScene() {}`;
	return { ...draft, files: { [entry.id]: { original: code, code } } };
}
const binding = {
	imageId: "texture.png",
	mesh: "Exact Mesh",
	material: 0,
	slot: "map",
	flipY: false,
};
const texts = () => ({
	imageId: "texture.png",
	mesh: "Exact Mesh",
	material: "0",
	slot: "map",
	flipY: "false",
});

test("AO slot requires matching archived v2; old or ambiguous consumers are never upgraded", () => {
	const base = state(),
		id = "model-feature-scene.ts";
	const marked = (original: string, code = original) => ({
		...base,
		files: { [id]: { original, code } },
	});
	const modern = marked(MODEL_TEXTURE_CONSUMER_MARKER_V2);
	expect(modelTextureConsumerVersion(base)).toBe(1);
	expect(modelTextureContext(base)?.slots).toEqual(MODEL_TEXTURE_SLOTS);
	expect(modelTextureConsumerVersion(modern)).toBe(2);
	expect(modelTextureContext(modern)?.slots).toEqual(MODEL_TEXTURE_SLOTS_V2);
	const ao = { ...texts(), slot: "aoMap" };
	expect(
		editModelTexture({ state: base, canCompile: true, texts: ao }).inputProps,
	).toBeUndefined();
	const accepted = editModelTexture({
		state: modern,
		canCompile: true,
		texts: ao,
	});
	expect(JSON.parse(accepted.inputProps!).textureBindings).toEqual([
		{ ...binding, slot: "aoMap" },
	]);
	expect(modern.baseline).toEqual(base.baseline);
	const render = (current: typeof base) =>
		renderToStaticMarkup(
			<ProgrammaticModelTextureFields
				id="ao"
				state={current}
				canCompile
				onEdit={() => {}}
			/>,
		);
	expect(render(modern)).toContain('<option value="aoMap">aoMap</option>');
	expect(render(base)).not.toContain('<option value="aoMap">aoMap</option>');
	for (const current of [
		marked(MODEL_TEXTURE_CONSUMER_MARKER, MODEL_TEXTURE_CONSUMER_MARKER_V2),
		marked(MODEL_TEXTURE_CONSUMER_MARKER_V2, MODEL_TEXTURE_CONSUMER_MARKER),
		marked(MODEL_TEXTURE_CONSUMER_MARKER_V2.repeat(2)),
		marked(
			`${MODEL_TEXTURE_CONSUMER_MARKER}\n${MODEL_TEXTURE_CONSUMER_MARKER_V2}`,
		),
		marked("// rocut-model-texture-bindings-v3"),
		marked("// rocut-model-texture-bindings-v02"),
		marked(
			`${MODEL_TEXTURE_CONSUMER_MARKER_V2}\n// rocut-model-texture-bindings-v3`,
		),
	]) {
		expect(modelTextureContext(current)).toBeUndefined();
		expect(modelTextureConsumerIssue(current)).toBeDefined();
		expect(
			editModelTexture({ state: current, canCompile: true, texts: ao })
				.inputProps,
		).toBeUndefined();
	}
});

test("strict archived model identity and unique complete resource choices gate texture authoring", () => {
	const base = state();
	expect(modelTextureContext(base)?.images).toEqual([
		"texture.png",
		"other.jpg",
		"other.webp",
	]);
	const build = base.baseline.build!;
	for (const replacement of [
		{ ...build, entryFile: "custom.ts" },
		{ ...build, inputProps: { ...build.inputProps, assetKind: "svg" } },
		{ ...build, inputs: [{ ...build.inputs[0], attachmentKey: "forged" }] },
		{ ...build, inputs: [{ ...build.inputs[0], byteLength: 0 }] },
		{
			...build,
			inputs: [...build.inputs, { ...build.inputs[0], byteLength: 0 }],
		},
	])
		expect(
			modelTextureContext({
				...base,
				baseline: { ...base.baseline, build: replacement },
			}),
		).toBeUndefined();
	expect(
		modelTextureContext({ ...base, entryFile: "changed.ts" }),
	).toBeUndefined();
	const resource = base.baseline.resources![1];
	const filtered = {
		...base,
		baseline: {
			...base.baseline,
			resources: [
				base.baseline.resources![0],
				resource,
				{ ...resource },
				{ ...resource, id: "bad", attachmentKey: "forged" },
				{ ...resource, id: "unsupported", mimeType: "image/gif" },
				base.baseline.resources![2],
			],
		},
	};
	expect(modelTextureContext(filtered)?.images).toEqual(["other.jpg"]);
	expect(
		modelTextureContext({
			...base,
			baseline: { ...base.baseline, resources: [base.baseline.resources![0]] },
		}),
	).toBeUndefined();
});

test("explicit missing/empty binding add, typed edits and removal preserve full source and unknown records", () => {
	let s = state();
	const original = structuredClone(s.baseline);
	const add = editModelTexture({ state: s, canCompile: true, texts: texts() });
	expect(JSON.parse(add.inputProps!)).toEqual({
		assetKind: "model",
		modelId: "model.glb",
		unknown: { keep: true },
		textureBindings: [binding],
	});
	expect(s.baseline).toEqual(original);
	s = { ...s, inputProps: add.inputProps! };
	for (const slot of MODEL_TEXTURE_SLOTS) {
		const edited = editModelTexture({
			state: s,
			canCompile: true,
			index: 0,
			texts: { ...texts(), slot, material: "2", flipY: "true" },
		});
		expect(JSON.parse(edited.inputProps!).textureBindings).toEqual([
			{ ...binding, slot, material: 2, flipY: true },
		]);
	}
	const extra = { ...binding, unknown: { keep: "binding" } };
	s = {
		...s,
		inputProps: JSON.stringify({
			...JSON.parse(s.inputProps),
			textureBindings: [extra, "old-unrecognized"],
		}),
	};
	const updated = editModelTexture({
		state: s,
		canCompile: true,
		index: 0,
		texts: { ...texts(), imageId: "other.webp", mesh: "Other Mesh" },
	});
	expect(JSON.parse(updated.inputProps!).textureBindings).toEqual([
		{ ...extra, imageId: "other.webp", mesh: "Other Mesh" },
		"old-unrecognized",
	]);
	expect(
		editModelTexture({ state: s, canCompile: true, index: 1, texts: texts() })
			.inputProps,
	).toBeUndefined();
	const removed = editModelTexture({
		state: s,
		canCompile: true,
		index: 1,
		remove: true,
	});
	expect(JSON.parse(removed.inputProps!).textureBindings).toEqual([extra]);
	const empty = editModelTexture({
		state: { ...s, inputProps: removed.inputProps! },
		canCompile: true,
		index: 0,
		remove: true,
	});
	expect(JSON.parse(empty.inputProps!).textureBindings).toEqual([]);
	expect(
		editModelTexture({
			state: { ...s, inputProps: empty.inputProps! },
			canCompile: true,
			texts: texts(),
		}).inputProps,
	).toBeDefined();
	expect(modelTextureTexts(extra)).toEqual(texts());
});

test("partial invalid text and busy/conflict/read-only states never write input props", () => {
	const s = state();
	for (const value of [
		blankModelTexture(),
		{ ...texts(), imageId: "missing" },
		{ ...texts(), mesh: " " },
		{ ...texts(), material: "" },
		{ ...texts(), material: "0.1" },
		{ ...texts(), material: "-1" },
		{ ...texts(), material: "9007199254740992" },
		{ ...texts(), slot: "unsupported" },
		{ ...texts(), flipY: "" },
	]) {
		const result = editModelTexture({
			state: s,
			canCompile: true,
			texts: value,
		});
		expect(result.inputProps).toBeUndefined();
		expect(result.error).toBeDefined();
	}
	for (const phase of ["loading", "compiling", "saving"] as const)
		expect(
			editModelTexture({
				state: { ...s, phase },
				canCompile: true,
				texts: texts(),
			}).inputProps,
		).toBeUndefined();
	expect(
		editModelTexture({
			state: { ...s, conflict: true },
			canCompile: true,
			texts: texts(),
		}).inputProps,
	).toBeUndefined();
	expect(
		editModelTexture({ state: s, canCompile: false, texts: texts() })
			.inputProps,
	).toBeUndefined();
	expect(
		editModelTexture({
			state: { ...s, inputProps: "{broken" },
			canCompile: true,
			texts: texts(),
		}).inputProps,
	).toBeUndefined();
	expect(
		editModelTexture({
			state: state({
				assetKind: "model",
				modelId: "model.glb",
				textureBindings: "old-malformed",
			}),
			canCompile: true,
			texts: texts(),
		}).inputProps,
	).toBeUndefined();
});

test("actual build panel composes empty texture authoring with one original Recompile action and retained malformed values", () => {
	const s = state();
	const render = (current = s, canCompile = true) =>
		renderToStaticMarkup(
			<ProgrammaticBuildFields
				id="texture"
				state={current}
				canCompile={canCompile}
				canLoad={true}
				onSelect={() => {}}
				onEdit={() => {}}
				onRetry={() => {}}
				onApply={() => {}}
				onDiscard={() => {}}
				onCancel={() => {}}
				onFiles={() => {}}
			/>,
		);
	const html = render();
	expect(html).toContain("Archived model texture bindings");
	expect(html).toContain('id="texture-texture-new-imageId"');
	expect(html).toContain("Choose orientation explicitly");
	expect(html).toContain("Choose a slot explicitly");
	expect(html.match(/Recompile and apply<\/button>/g)).toHaveLength(1);
	expect(html).toContain("Input props (JSON)");
	expect(render(s, false)).toContain(
		'aria-label="Add texture binding" disabled=""',
	);
	expect(render({ ...s, conflict: true })).toContain(
		'aria-label="Add texture binding" disabled=""',
	);
	const malformed = state({
		assetKind: "model",
		modelId: "model.glb",
		textureBindings: [
			"old-unrecognized",
			{ ...binding, imageId: "missing", slot: "future" },
		],
	});
	const retained = render(malformed);
	expect(retained).toContain("Unrecognized binding retained");
	expect(retained).toContain("Unavailable image (retained): missing");
	expect(retained).toContain("Unknown slot (retained): future");
	expect(retained).toContain("Remove texture binding 0");
	expect(
		renderToStaticMarkup(
			<ProgrammaticModelTextureFields
				id="svg"
				state={state({ assetKind: "svg", modelId: "model.glb" })}
				canCompile
				onEdit={() => {}}
			/>,
		),
	).toBe("");
});

test("old/unloaded/changed consumers cannot gain texture bindings and invalid mesh types require an explicit repair", () => {
	const s = state(),
		id = "model-feature-scene.ts";
	const consumerCases: BuildDraftSnapshot["files"][] = [
		{},
		{ [id]: { original: "old scene", code: MODEL_TEXTURE_CONSUMER_MARKER } },
		{
			[id]: { original: MODEL_TEXTURE_CONSUMER_MARKER, code: "changed scene" },
		},
		{
			[id]: {
				original: MODEL_TEXTURE_CONSUMER_MARKER.repeat(2),
				code: MODEL_TEXTURE_CONSUMER_MARKER,
			},
		},
	];
	for (const files of consumerCases) {
		expect(modelTextureContext({ ...s, files })).toBeUndefined();
		expect(
			editModelTexture({
				state: { ...s, files },
				canCompile: true,
				texts: texts(),
			}).inputProps,
		).toBeUndefined();
		expect(modelTextureConsumerIssue({ ...s, files })).toBeDefined();
	}
	const malformed = { ...binding, mesh: 42 };
	const old = {
		...s,
		inputProps: JSON.stringify({
			...JSON.parse(s.inputProps),
			textureBindings: [malformed],
		}),
	};
	const local = modelTextureTexts(malformed)!;
	expect(local.mesh).toBe("");
	expect(
		editModelTexture({
			state: old,
			canCompile: true,
			index: 0,
			texts: { ...local, slot: "normalMap" },
		}).inputProps,
	).toBeUndefined();
	expect(
		JSON.parse(
			editModelTexture({
				state: old,
				canCompile: true,
				index: 0,
				texts: { ...local, slot: "normalMap", mesh: "Explicit Mesh" },
			}).inputProps!,
		).textureBindings[0].mesh,
	).toBe("Explicit Mesh");
	const keys = (node: ReactNode): string[] =>
		Array.isArray(node)
			? node.flatMap(keys)
			: isValidElement<{ children?: ReactNode }>(node)
				? [
						...(typeof node.key === "string" && node.key.startsWith("new:")
							? [node.key]
							: []),
						...keys(node.props.children),
					]
				: [];
	const initialKey = keys(
		ProgrammaticModelTextureFields({
			id: "texture",
			state: s,
			canCompile: true,
			onEdit: () => {},
		}),
	);
	const changedKey = keys(
		ProgrammaticModelTextureFields({
			id: "texture",
			state: {
				...s,
				inputProps: JSON.stringify({
					...JSON.parse(s.inputProps),
					position: [1, 2, 3],
				}),
			},
			canCompile: true,
			onEdit: () => {},
		}),
	);
	expect(initialKey).toHaveLength(1);
	expect(changedKey).toEqual(initialKey);
});
