import { useEffect, useId, useMemo, useSyncExternalStore } from "react";
import type { ProgrammaticSource } from "@opencut/editor-contracts";
import { useEditorInstance } from "../../editor/use-editor";
import { getMvRecipeCatalog } from "../../editor/transactions/opencut/mv-recipe-catalog";
import { sourceFingerprint } from "./programmatic-source-draft";
import {
	getRecipeDraft,
	parseRecipeDraft,
	recipeReadOnlyReason,
} from "./programmatic-recipe-draft";
import {
	ProgrammaticRecipeCommand,
	type RecipeEditScope,
} from "./programmatic-recipe-command";
import { ProgrammaticRecipeFields } from "./programmatic-recipe-fields";

export function ProgrammaticRecipeEditor({
	source,
	scope,
}: {
	source: ProgrammaticSource;
	scope: RecipeEditScope;
}) {
	const editor = useEditorInstance(),
		id = useId();
	const key = JSON.stringify([
		scope.projectId,
		scope.sceneId,
		scope.trackId,
		scope.elementId,
	]);
	const draft = useMemo(
		() => getRecipeDraft({ owner: editor, key, source }),
		[editor, key, source],
	);
	const state = useSyncExternalStore(
		draft.subscribe,
		draft.getSnapshot,
		draft.getSnapshot,
	);
	const catalog = useMemo(() => getMvRecipeCatalog().extensions, []);
	useEffect(() => draft.refresh(source), [draft, source]);
	if (!source.recipe && !state.dirty) return null;
	const conflict =
		state.conflict ||
		sourceFingerprint(source) !== sourceFingerprint(state.baseline);
	return (
		<ProgrammaticRecipeFields
			generators={catalog.generators}
			sceneParameters={catalog.sceneParameters}
			id={id}
			state={state}
			readOnly={recipeReadOnlyReason(source)}
			conflict={conflict}
			onEdit={(text) => draft.edit(text)}
			onDiscard={() => draft.discard()}
			onApply={() =>
				void draft.apply(async (submitted) => {
					await editor.command.execute({
						command: new ProgrammaticRecipeCommand({
							...scope,
							baseline: submitted.baseline,
							text: submitted.text,
						}),
					});
					return {
						...submitted.baseline,
						recipe: parseRecipeDraft(submitted.text),
					};
				})
			}
		/>
	);
}
