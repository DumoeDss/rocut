import { useEffect, useId, useMemo, useSyncExternalStore } from "react";
import type { ProgrammaticSource } from "@opencut/editor-contracts";
import { useEditorInstance } from "../../editor/use-editor";
import { getBuildDraft } from "./programmatic-build-draft";
import { ProgrammaticBuildCommand } from "./programmatic-build-command";
import { ProgrammaticBuildFields } from "./programmatic-build-fields";

export function ProgrammaticBuildEditor({
	source,
	scope,
}: {
	source: ProgrammaticSource;
	scope: {
		projectId: string;
		sceneId: string;
		trackId: string;
		elementId: string;
	};
}) {
	const editor = useEditorInstance();
	const id = useId();
	const key = JSON.stringify([
		scope.projectId,
		scope.sceneId,
		scope.trackId,
		scope.elementId,
	]);
	const draft = useMemo(
		() => getBuildDraft({ owner: editor, key, source }),
		[editor, key, source],
	);
	const state = useSyncExternalStore(
		draft.subscribe,
		draft.getSnapshot,
		draft.getSnapshot,
	);
	const provider = editor.renderer.programmaticFrames;
	useEffect(() => draft.refresh(source), [draft, source]);
	useEffect(() => {
		if (provider?.loadResource) void draft.load(provider);
		return () => draft.cancel();
	}, [draft, provider, state.selectedId, state.baseline, state.files]);
	const apply = () =>
		draft.apply({
			provider,
			commit: async (baseline, replacement) => {
				await editor.command.execute({
					command: new ProgrammaticBuildCommand({
						...scope,
						baseline,
						replacement,
					}),
				});
			},
		});
	return (
		<ProgrammaticBuildFields
			id={id}
			state={state}
			canLoad={!!provider?.loadResource}
			canCompile={!!provider?.reviseBuild}
			onSelect={(file) => draft.select(file)}
			onEdit={(patch) => draft.edit(patch)}
			onRetry={() => void draft.load(provider)}
			onApply={() => void apply()}
			onDiscard={() => draft.discard()}
			onCancel={() => draft.cancel()}
			onFiles={(operation) => draft.changeFiles(operation)}
		/>
	);
}
