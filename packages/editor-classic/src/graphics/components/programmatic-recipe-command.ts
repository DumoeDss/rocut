import type { ProgrammaticSource } from "@opencut/editor-contracts";
import {
	Command,
	type EditorCommandContext,
} from "../../commands/base-command";
import { UpdateElementsCommand } from "../../commands/timeline/element/update-elements";
import { findTrackInSceneTracks } from "../../timeline";
import { sourceFingerprint } from "./programmatic-source-draft";
import {
	parseRecipeDraft,
	recipeReadOnlyReason,
} from "./programmatic-recipe-draft";

export interface RecipeEditScope {
	projectId: string;
	sceneId: string;
	trackId: string;
	elementId: string;
}

/** Authority/baseline checks execute inside the serialized transaction. The
 * existing native UpdateElements path validates and records durable undo/redo. */
export class ProgrammaticRecipeCommand extends Command {
	readonly routingClass = "transaction" as const;
	private readonly baseline: string;
	constructor(
		private readonly options: RecipeEditScope & {
			baseline: ProgrammaticSource;
			text: string;
		},
	) {
		super();
		this.baseline = sourceFingerprint(options.baseline);
	}
	execute(context: EditorCommandContext): undefined {
		const { editor } = context;
		const { projectId, sceneId, trackId, elementId, text } = this.options;
		const scene = editor.scenes.getActiveScene();
		if (
			editor.project.getActive().metadata.id !== projectId ||
			scene.id !== sceneId
		)
			throw Error(
				"The project or scene changed. Return to the original clip before applying.",
			);
		const track = findTrackInSceneTracks({ tracks: scene.tracks, trackId });
		const element = track?.elements.find(
			(candidate) => candidate.id === elementId,
		);
		if (
			element?.type !== "graphic" ||
			element.definitionId !== "programmatic" ||
			!element.programmatic
		)
			throw Error("The programmatic clip is no longer available.");
		const source = element.programmatic;
		if (sourceFingerprint(source) !== this.baseline)
			throw Error(
				"The source changed outside this draft. Discard to load the current source.",
			);
		const reason = recipeReadOnlyReason(source);
		if (reason) throw Error(reason);
		new UpdateElementsCommand({
			updates: [
				{
					trackId,
					elementId,
					patch: {
						programmatic: { ...source, recipe: parseRecipeDraft(text) },
					},
				},
			],
		}).execute(context);
		return undefined;
	}
}
