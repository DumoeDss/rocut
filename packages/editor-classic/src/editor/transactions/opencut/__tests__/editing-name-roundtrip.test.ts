/* eslint-disable @typescript-eslint/no-unsafe-type-assertion -- Detached fixtures bridge the branded native timeline model. */
import { expect, test } from "bun:test";
import type { ClipEditing } from "@opencut/editor-contracts";
import { revisionOf } from "@opencut/editor-contracts";
import type { TimelineElement, VideoElement } from "../../../../timeline/types";
import {
	decodeProject,
	encodeProject,
} from "../../../persistence/project-codec";
import { applyEditingState, projectEditingState } from "../editing-state";
import { projectFixture } from "./fixture";
import { EDITING_NAME_SHAPE_KEY } from "../../../persistence/editing-name-shape";
import { projectOpenCutDraft } from "../projection";

function donor({ name = "Asset donor" }: { name?: string } = {}): VideoElement {
	return {
		id: "clip:one",
		type: "video",
		name,
		params: {},
		startTime: 0,
		duration: 1,
		trimStart: 0,
		trimEnd: 0,
		mediaId: "asset:one",
		isSourceAudioEnabled: true,
	} as unknown as VideoElement;
}

function reopen({ element }: { element: TimelineElement }): TimelineElement {
	const project = projectFixture();
	if (element.type !== "video") throw new Error("Expected video fixture");
	project.scenes[0].tracks.main.elements = [element];
	const persisted = encodeProject({ project, retained: {} });
	return decodeProject(JSON.parse(JSON.stringify(persisted))).scenes[0].tracks
		.main.elements[0];
}

test("optional editing names retain exact wire shape through apply and persistence", () => {
	for (const assetName of ["Asset donor", 'different|asset:[],"name"']) {
		for (const editing of [
			{ type: "video", params: {} },
			{ type: "video", params: {}, name: 'typed|name:[],"value"' },
			{ type: "video", params: {}, name: "" },
		] satisfies ClipEditing[]) {
			const input = structuredClone(editing);
			const original = donor({ name: assetName });
			const originalCopy = structuredClone(original);
			const applied = applyEditingState({ element: original, editing });
			expect(projectEditingState(applied)).toEqual(editing);
			expect(projectEditingState(reopen({ element: applied }))).toEqual(
				editing,
			);
			expect(editing).toEqual(input);
			expect(original).toEqual(originalCopy);
		}
	}
});

test("omitted effect name binds the final type when create-clip starts from a text donor", () => {
	const placeholder = { ...donor(), type: "text" } as unknown as TimelineElement;
	const editing: ClipEditing = { type: "effect", effectType: "bubble", params: {} };
	const applied = applyEditingState({ element: placeholder, editing });
	expect(projectEditingState(applied)).toEqual(editing);
	const project = projectFixture();
	project.scenes[0].tracks.main.elements = [applied as never];
	const loaded = decodeProject(JSON.parse(JSON.stringify(encodeProject({ project, retained: {} }))));
	expect(projectEditingState(loaded.scenes[0].tracks.main.elements[0])).toEqual(editing);
	expect(Reflect.get(applied, EDITING_NAME_SHAPE_KEY)).toMatchObject({ elementType: "effect" });
	expect(placeholder.type).toBe("text");
});

test("old names and invalid or stale markers never suppress real donor names", () => {
	const original = donor();
	Reflect.set(original, "unrelatedPrivate", { keepOpaque: true });
	expect(Reflect.has(reopen({ element: original }), "unrelatedPrivate")).toBe(
		false,
	);
	expect(projectEditingState(original)).toEqual({
		type: "video",
		name: "Asset donor",
		params: {},
		isSourceAudioEnabled: true,
	});
	const applied = applyEditingState({
		element: original,
		editing: { type: "video", params: {} },
	});
	const valid: unknown = Reflect.get(applied, EDITING_NAME_SHAPE_KEY);
	for (const marker of [
		null,
		[],
		"bad",
		{},
		{
			version: 2,
			elementId: original.id,
			elementType: original.type,
			donorName: original.name,
		},
		{
			version: 1,
			elementId: "foreign",
			elementType: original.type,
			donorName: original.name,
		},
		{
			version: 1,
			elementId: original.id,
			elementType: "text",
			donorName: original.name,
		},
		{
			version: 1,
			elementId: original.id,
			elementType: original.type,
			donorName: "stale",
		},
		{
			version: 1,
			elementId: original.id,
			elementType: original.type,
			donorName: original.name,
			extra: true,
		},
	]) {
		const invalid = structuredClone(applied);
		Reflect.set(invalid, EDITING_NAME_SHAPE_KEY, marker);
		const loaded = reopen({ element: invalid });
		expect(Reflect.get(loaded, EDITING_NAME_SHAPE_KEY)).toEqual(marker);
		expect(projectEditingState(loaded).name).toBe("Asset donor");
	}
	const renamed = { ...applied, name: "UI renamed" };
	expect(projectEditingState(reopen({ element: renamed })).name).toBe(
		"UI renamed",
	);
	const foreign = { ...applied, id: "clip:two" };
	expect(projectEditingState(foreign).name).toBe("Asset donor");
	expect(Reflect.get(applied, EDITING_NAME_SHAPE_KEY)).toEqual(valid);
});

test("consecutive replacements clear omission and persistence never resurrects it", () => {
	let element: TimelineElement = donor();
	Reflect.set(element, EDITING_NAME_SHAPE_KEY, {
		version: 99,
		unrelated: "must not merge into new marker",
	});
	for (const editing of [
		{ type: "video", params: {} },
		{ type: "video", params: {}, name: "" },
		{ type: "video", params: {} },
		{ type: "video", params: {}, name: "explicit" },
	] satisfies ClipEditing[]) {
		const retainedProject = projectFixture();
		if (element.type !== "video") throw new Error("Expected video fixture");
		retainedProject.scenes[0].tracks.main.elements = [element];
		const retained = encodeProject({ project: retainedProject, retained: {} });
		element = applyEditingState({ element, editing });
		if (element.type !== "video") throw new Error("Expected video fixture");
		const project = projectFixture();
		project.scenes[0].tracks.main.elements = [element];
		const saved = encodeProject({ project, retained });
		element = decodeProject(JSON.parse(JSON.stringify(saved))).scenes[0].tracks
			.main.elements[0];
		expect(projectEditingState(element)).toEqual(editing);
		if (Object.hasOwn(editing, "name"))
			expect(Reflect.has(element, EDITING_NAME_SHAPE_KEY)).toBe(false);
	}
});

test("complete projected DTO retains authored optional shape across codec roundtrip", () => {
	const project = projectFixture();
	project.scenes[0].tracks.main.elements = [donor()];
	const assetCatalog = [
		{
			id: "asset:one",
			name: "Asset name differs from donor",
			type: "video" as const,
		},
	];
	const metadata = { revision: revisionOf(0), idempotency: [] };
	const initial = projectOpenCutDraft({ project, assetCatalog }, metadata);
	const editing = {
		type: "video" as const,
		params: { delimiter: '|:[],"typed"' },
	};
	// Author the desired complete input before applying it, independently of any
	// post-apply/reopened snapshot. Every other DTO field remains compared.
	const expected = {
		...initial,
		clips: initial.clips.map((clip) => ({ ...clip, editing })),
	};
	const inputCopy = structuredClone(expected);
	const applied = applyEditingState({
		element: project.scenes[0].tracks.main.elements[0],
		editing,
	});
	if (applied.type !== "video") throw new Error("Expected video fixture");
	project.scenes[0].tracks.main.elements = [applied];
	expect(projectOpenCutDraft({ project, assetCatalog }, metadata)).toEqual(
		expected,
	);
	const loaded = decodeProject(
		JSON.parse(JSON.stringify(encodeProject({ project, retained: {} }))),
	);
	expect(
		projectOpenCutDraft({ project: loaded, assetCatalog }, metadata),
	).toEqual(expected);
	expect(expected).toEqual(inputCopy);
});
