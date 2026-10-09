import type { ProgrammaticSource } from "@opencut/editor-contracts";
import {
	Command,
	type EditorCommandContext,
} from "../../commands/base-command";
import { UpdateElementsCommand } from "../../commands/timeline/element/update-elements";
import { findTrackInSceneTracks } from "../../timeline";
import {
	sourceFingerprint,
	sourceReadOnlyReason,
} from "./programmatic-source-draft";

/** The baseline guard runs inside the serialized transaction, not at click time. */
export class ProgrammaticSourceCommand extends Command {
	readonly routingClass = "transaction" as const;
	private readonly baseline: string;
	private readonly options: {
		projectId: string;
		sceneId: string;
		trackId: string;
		elementId: string;
		code: string;
		seed: string;
	};

	constructor(options: {
		projectId: string;
		sceneId: string;
		trackId: string;
		elementId: string;
		baseline: ProgrammaticSource;
		code: string;
		seed: string;
	}) {
		super();
		this.baseline = sourceFingerprint(options.baseline);
		this.options = options;
	}

	execute(context: EditorCommandContext): undefined {
		const { editor } = context;
		const { projectId, sceneId, trackId, elementId, code, seed } = this.options;
		const scene = editor.scenes.getActiveScene();
		if (
			editor.project.getActive().metadata.id !== projectId ||
			scene.id !== sceneId
		) {
			throw new Error(
				"The project or scene changed. Return to the original clip before applying.",
			);
		}
		const track = findTrackInSceneTracks({ tracks: scene.tracks, trackId });
		const element = track?.elements.find(
			(candidate) => candidate.id === elementId,
		);
		if (
			element?.type !== "graphic" ||
			element.definitionId !== "programmatic" ||
			!element.programmatic
		) {
			throw new Error("The programmatic clip is no longer available.");
		}
		const source = element.programmatic;
		if (sourceFingerprint(source) !== this.baseline) {
			throw new Error(
				"The source changed outside this draft. Discard the draft to load the current source.",
			);
		}
		const reason = sourceReadOnlyReason(source);
		if (reason) throw new Error(reason);
		if (seed.trim() === "" || !Number.isSafeInteger(Number(seed))) {
			throw new Error("Seed must be a whole number.");
		}
		new UpdateElementsCommand({
			updates: [
				{
					trackId,
					elementId,
					patch: { programmatic: { ...source, code, seed: Number(seed) } },
				},
			],
		}).execute(context);
		return undefined;
	}
}
