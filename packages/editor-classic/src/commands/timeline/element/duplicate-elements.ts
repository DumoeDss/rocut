import {
	Command,
	createElementSelectionResult,
	type EditorCommandContext,
	type CommandResult,
} from "../../base-command";
import type { SceneTracks, TimelineElement } from "../../../timeline";
import { generateUUID } from "../../../utils/id";
import { applyPlacement, resolveTrackPlacement } from "../../../timeline/placement";
import { cloneAnimations } from "../../../animation";
import type { MediaTime } from "../../../wasm";
import {
	duplicateIndependentMotionTextSequence,
	type DuplicateMotionTextSequenceCore,
} from "../../../wasm/motion-text-identity";
import type { MotionTextSequence } from "@opencut/editor-contracts";

interface DuplicateElementsParams {
	elements: { trackId: string; elementId: string }[];
	motionTextCopyMode?: "shared" | "independent";
	motionTextIdentityCore?: DuplicateMotionTextSequenceCore;
}

export class DuplicateElementsCommand extends Command {
	readonly routingClass = "transaction" as const;

	private duplicatedElements: { trackId: string; elementId: string }[] = [];
	private savedState: SceneTracks | null = null;
	private savedMotionTextSequences: MotionTextSequence[] | null = null;
	private elements: DuplicateElementsParams["elements"];
	private readonly motionTextCopyMode: "shared" | "independent";
	private readonly motionTextIdentityCore?: DuplicateMotionTextSequenceCore;

	constructor({
		elements,
		motionTextCopyMode = "shared",
		motionTextIdentityCore,
	}: DuplicateElementsParams) {
		super();
		this.elements = elements;
		this.motionTextCopyMode = motionTextCopyMode;
		this.motionTextIdentityCore = motionTextIdentityCore;
	}

	execute({ editor }: EditorCommandContext): CommandResult | undefined {
		this.savedState = editor.scenes.getActiveScene().tracks;
		const activeProject = editor.project.getActive();
		this.savedMotionTextSequences = [...activeProject.motionTextSequences];
		this.duplicatedElements = [];
		const sourceSequences = new Map<string, MotionTextSequence>(
			activeProject.motionTextSequences.map((sequence) => [
				sequence.id,
				sequence,
			]),
		);
		const independentCopies = new Map<
			string,
			ReturnType<typeof duplicateIndependentMotionTextSequence>
		>();
		const usedIndependentSequenceIds = new Set<string>();

		let updatedTracks = this.savedState;

		for (const track of [
			...this.savedState.overlay,
			this.savedState.main,
			...this.savedState.audio,
		]) {
			const elementsToDuplicate = this.elements.filter(
				(elementEntry) => elementEntry.trackId === track.id,
			);

			if (elementsToDuplicate.length === 0) {
				continue;
			}

			const elementIdsToDuplicate = new Set(
				elementsToDuplicate.map((element) => element.elementId),
			);
			const newTrackElements: TimelineElement[] = [];

			for (const element of track.elements) {
				if (!elementIdsToDuplicate.has(element.id)) {
					continue;
				}

				const newId = generateUUID();
				let sequenceId: string | undefined;
				if (
					element.type === "motion-text" &&
					this.motionTextCopyMode === "independent"
				) {
					let copied = independentCopies.get(element.sequenceId);
					if (!copied) {
						const source = sourceSequences.get(element.sequenceId);
						if (!source) {
							throw new Error(
								`Motion-text sequence ${element.sequenceId} is unavailable for independent copy.`,
							);
						}
						copied = duplicateIndependentMotionTextSequence({
							sequence: source,
							newSequenceId: generateUUID(),
							core: this.motionTextIdentityCore,
						});
						independentCopies.set(element.sequenceId, copied);
					}
					sequenceId = copied.sequence.id;
				}
				newTrackElements.push(
					buildDuplicateElement({
						element,
						id: newId,
						startTime: element.startTime,
						sequenceId,
					}),
				);
			}

			const placementResult = resolveTrackPlacement({
				tracks: updatedTracks,
				trackType: track.type,
				timeSpans: [],
				strategy: { type: "alwaysNew", position: "highest" },
			});
			if (!placementResult || placementResult.kind !== "newTrack") {
				continue;
			}

			const applied = applyPlacement({
				tracks: updatedTracks,
				placementResult,
				elements: newTrackElements,
			});
			if (!applied) {
				continue;
			}

			updatedTracks = applied.updatedTracks;

			for (const element of newTrackElements) {
				if (
					element.type === "motion-text" &&
					this.motionTextCopyMode === "independent"
				) {
					usedIndependentSequenceIds.add(element.sequenceId);
				}
				this.duplicatedElements.push({
					trackId: applied.targetTrackId,
					elementId: element.id,
				});
			}
		}

		if (usedIndependentSequenceIds.size > 0) {
			const createdSequences = [...independentCopies.values()]
				.map((copy) => copy.sequence)
				.filter((sequence) => usedIndependentSequenceIds.has(sequence.id));
			editor.project.setActiveProject({
				project: {
					...editor.project.getActive(),
					motionTextSequences: [
						...editor.project.getActive().motionTextSequences,
						...createdSequences,
					],
				},
			});
		}

		editor.timeline.updateTracks(updatedTracks);

		if (this.duplicatedElements.length > 0) {
			return createElementSelectionResult(this.duplicatedElements);
		}
		return undefined;
	}

	undo({ editor }: EditorCommandContext): void {
		if (this.savedMotionTextSequences) {
			editor.project.setActiveProject({
				project: {
					...editor.project.getActive(),
					motionTextSequences: this.savedMotionTextSequences,
				},
			});
		}
		if (this.savedState) {
			editor.timeline.updateTracks(this.savedState);
		}
	}

	getDuplicatedElements(): { trackId: string; elementId: string }[] {
		return this.duplicatedElements;
	}
}

function buildDuplicateElement({
	element,
	id,
	startTime,
	sequenceId,
}: {
	element: TimelineElement;
	id: string;
	startTime: MediaTime;
	sequenceId?: string;
}): TimelineElement {
	return {
		...element,
		...(element.type === "motion-text" && sequenceId !== undefined
			? { sequenceId }
			: {}),
		id,
		name: `${element.name} (copy)`,
		startTime,
		animations: cloneAnimations({
			animations: element.animations,
			shouldRegenerateKeyframeIds: true,
		}),
	};
}
