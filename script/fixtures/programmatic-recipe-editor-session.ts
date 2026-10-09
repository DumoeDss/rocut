import type { ProgrammaticSource } from "@opencut/editor-contracts";
import { createInMemoryHost } from "@opencut/editor-ports/in-memory/host";
import { createEditorSession } from "../../packages/editor-classic/src/editor/session/create-session";
import { editorForSession } from "../../packages/editor-classic/src/editor/runtime/session-core-owner";
import { InsertElementCommand } from "../../packages/editor-classic/src/commands/timeline/element/insert-element";
import { UpdateElementsCommand } from "../../packages/editor-classic/src/commands/timeline/element/update-elements";
import { mediaTime } from "../../packages/editor-classic/src/wasm/media-time";

export const host = createInMemoryHost({
	projectId: "recipe-editor-probe",
	graphics: { mode: "force", rasterizer: "none" },
});
export const session = await createEditorSession({ host });
export const editor = editorForSession(session);
await editor.project.createNewProject({ name: "Recipe editor acceptance" });
export function solidSource(
	color: readonly [number, number, number, number],
): ProgrammaticSource {
	return {
		version: 1,
		runtime: "canvas-worker",
		code: "",
		width: 64,
		height: 32,
		frameRate: { numerator: 30, denominator: 1 },
		durationFrames: 90,
		seed: 7,
		recipe: {
			version: 1,
			root: "root",
			songStartSeconds: 0,
			outputRoles: ["background"],
			nodes: [
				{ id: "root", scene: { kind: "solid", role: "background", color } },
			],
		},
	};
}
export const refs: Array<{ trackId: string; elementId: string }> = [];
for (const [index, source] of [
	solidSource([1, 0, 0, 1]),
	solidSource([0, 0, 1, 1]),
].entries()) {
	const insert = new InsertElementCommand({
		element: {
			type: "graphic",
			definitionId: "programmatic",
			name: `Clip ${index ? "B" : "A"}`,
			params: {},
			programmatic: source,
			startTime: mediaTime({ ticks: 0 }),
			duration: mediaTime({ ticks: 240000 }),
			trimStart: mediaTime({ ticks: 0 }),
			trimEnd: mediaTime({ ticks: 0 }),
		},
		placement: { mode: "auto", trackType: "graphic" },
	});
	await editor.command.execute({ command: insert });
	const trackId = insert.getTrackId();
	if (!trackId) throw Error("Missing recipe track");
	refs.push({ trackId, elementId: insert.getElementId() });
}
editor.selection.setSelectedElements({ elements: [refs[0]] });
export function selectedSource() {
	const ref = editor.selection.getSelectedElements()[0];
	const element = editor.scenes
		.getActiveScene()
		.tracks.overlay.find((track) => track.id === ref?.trackId)
		?.elements.find((item) => item.id === ref?.elementId);
	if (element?.type !== "graphic" || !element.programmatic)
		throw Error("Missing selected recipe source");
	return element.programmatic;
}
export async function externalUpdate(source: ProgrammaticSource) {
	const ref = editor.selection.getSelectedElements()[0];
	await editor.command.execute({
		command: new UpdateElementsCommand({
			updates: [{ ...ref, patch: { programmatic: source } }],
		}),
	});
}
export function compiledSource(): ProgrammaticSource {
	// Descriptor-only external compiled-source fixture: this gate tests refusal
	// to edit it, not a compiler, attachment download, or compiled HTML preview.
	const sha256 = "b".repeat(64),
		input = {
			id: "index.tsx",
			kind: "source" as const,
			mimeType: "application/octet-stream",
			byteLength: 1,
			sha256,
			attachmentKey: `programmatic-source-sha256-${sha256}`,
		};
	return {
		...solidSource([1, 1, 0, 1]),
		recipe: undefined,
		runtime: "html-document",
		code: "",
		documentId: "compiled.html",
		resources: [
			{
				id: "compiled.html",
				kind: "document",
				mimeType: "text/html",
				byteLength: 1,
				sha256,
				attachmentKey: `programmatic-sha256-${sha256}`,
			},
		],
		build: {
			version: 1,
			engine: "remotion",
			engineVersion: "4.0.440",
			compositionId: "Fixture",
			entryFile: "index.tsx",
			inputs: [input],
			toolchainLock: { ...input, id: "_rocut/toolchain-lock.json" },
		},
	};
}
export async function persistedRecord() {
	return host.store.load({ id: editor.project.getActive().metadata.id });
}
