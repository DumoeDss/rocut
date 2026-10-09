import type { ProgrammaticSource } from "@opencut/editor-contracts";
import {
	Command,
	type EditorCommandContext,
} from "../../commands/base-command";
import { UpdateElementsCommand } from "../../commands/timeline/element/update-elements";
import { findTrackInSceneTracks } from "../../timeline";
import { sourceFingerprint } from "./programmatic-source-draft";

/** Compilation happens outside the queue; replacement is guarded inside it. */
export class ProgrammaticBuildCommand extends Command {
	readonly routingClass = "transaction" as const;
	private readonly baseline: string;
	constructor(
		private readonly options: {
			projectId: string;
			sceneId: string;
			trackId: string;
			elementId: string;
			baseline: ProgrammaticSource;
			replacement: ProgrammaticSource;
		},
	) {
		super();
		this.baseline = sourceFingerprint(options.baseline);
	}
	execute(context: EditorCommandContext): undefined {
		const { editor } = context;
		const { projectId, sceneId, trackId, elementId, replacement } =
			this.options;
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
			!element.programmatic?.build
		)
			throw Error("The compiled clip is no longer available.");
		if (sourceFingerprint(element.programmatic) !== this.baseline)
			throw Error(
				"The source changed outside this draft. Discard to load the current source.",
			);
		if (
			!replacement.build ||
			replacement.build.engine !== element.programmatic.build.engine
		)
			throw Error("The rebuilt source must retain its authoring engine.");
		new UpdateElementsCommand({
			updates: [{ trackId, elementId, patch: { programmatic: replacement } }],
		}).execute(context);
		return undefined;
	}
}
