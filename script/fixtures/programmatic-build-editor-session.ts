import { isProgrammaticSource } from "@opencut/editor-contracts";
import { createInMemoryHost } from "@opencut/editor-ports/in-memory/host";
import { createHttpProgrammaticFrames } from "../../apps/vite-example/src/host/http-programmatic-frames";
import { createEditorSession } from "../../packages/editor-classic/src/editor/session/create-session";
import { editorForSession } from "../../packages/editor-classic/src/editor/runtime/session-core-owner";
import { InsertElementCommand } from "../../packages/editor-classic/src/commands/timeline/element/insert-element";
import { UpdateElementsCommand } from "../../packages/editor-classic/src/commands/timeline/element/update-elements";
import { mediaTime } from "../../packages/editor-classic/src/wasm/media-time";

// Keep the private Host token in the URL prefix, never in evidence/UI text.
const hostBase = new URL("../../", location.href);
const fixture = await fetch(new URL("author-fixture.json", hostBase)).then(
	(r) => r.json(),
);
export const frames = createHttpProgrammaticFrames({
	base: new URL("api/", hostBase).href,
});
const withoutCompiler = new URL(location.href).searchParams.has("noCompiler");
export const session = await createEditorSession({
	host: {
		...createInMemoryHost({
			projectId: "build-editor-probe",
			graphics: { mode: "force", rasterizer: "none" },
		}),
		programmaticFrames: withoutCompiler
			? { ...frames, reviseBuild: undefined }
			: frames,
	},
});
export const editor = editorForSession(session);
await editor.project.createNewProject({
	name: "Archived author editor acceptance",
});
export const refs: Array<{ trackId: string; elementId: string; name: string }> =
	[];
for (const item of fixture.sources) {
	if (!isProgrammaticSource(item.source))
		throw Error("Invalid compiled fixture source");
	const insert = new InsertElementCommand({
		element: {
			type: "graphic",
			definitionId: "programmatic",
			name: item.name,
			params: {},
			programmatic: item.source,
			startTime: mediaTime({ ticks: 0 }),
			duration: mediaTime({ ticks: 120000 }),
			trimStart: mediaTime({ ticks: 0 }),
			trimEnd: mediaTime({ ticks: 0 }),
		},
		placement: { mode: "auto", trackType: "graphic" },
	});
	await editor.command.execute({ command: insert });
	refs.push({
		trackId: insert.getTrackId()!,
		elementId: insert.getElementId(),
		name: item.name,
	});
}
editor.selection.setSelectedElements({ elements: [refs[0]] });

export async function externalSourceChange() {
	const ref = editor.selection.getSelectedElements()[0];
	const element = editor.scenes
		.getActiveScene()
		.tracks.overlay.find((track) => track.id === ref.trackId)
		?.elements.find((item) => item.id === ref.elementId);
	if (element?.type !== "graphic" || !element.programmatic)
		throw Error("Missing selected source");
	await editor.command.execute({
		command: new UpdateElementsCommand({
			updates: [
				{
					...ref,
					patch: {
						programmatic: {
							...element.programmatic,
							seed: element.programmatic.seed + 1,
						},
					},
				},
			],
		}),
	});
}
