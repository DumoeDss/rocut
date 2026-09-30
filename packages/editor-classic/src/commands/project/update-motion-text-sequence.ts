import {
	isMotionTextSequence,
	type MotionTextSequence,
} from "@opencut/editor-contracts";
import {
	Command,
	type CommandResult,
	type EditorCommandContext,
} from "../base-command";

export class UpdateMotionTextSequenceCommand extends Command {
	readonly routingClass = "transaction" as const;
	private previous: MotionTextSequence | null = null;

	constructor(private readonly sequence: MotionTextSequence) {
		super();
	}

	execute({ editor }: EditorCommandContext): CommandResult | undefined {
		if (!isMotionTextSequence(this.sequence)) {
			throw new TypeError("The updated motion-text sequence is invalid.");
		}
		const activeProject = editor.project.getActive();
		const previous = activeProject.motionTextSequences.find(
			(candidate) => candidate.id === this.sequence.id,
		);
		if (!previous) {
			throw new Error(
				`Motion-text sequence ${this.sequence.id} does not exist.`,
			);
		}
		if (this.sequence.revision !== previous.revision + 1) {
			throw new Error(
				`Motion-text sequence ${this.sequence.id} must advance revision ${previous.revision} by one.`,
			);
		}
		this.previous = previous;
		editor.project.setActiveProject({
			project: {
				...activeProject,
				motionTextSequences: activeProject.motionTextSequences.map(
					(candidate) =>
						candidate.id === this.sequence.id ? this.sequence : candidate,
				),
			},
		});
		return undefined;
	}

	undo({ editor }: EditorCommandContext): void {
		if (!this.previous) return;
		const activeProject = editor.project.getActive();
		editor.project.setActiveProject({
			project: {
				...activeProject,
				motionTextSequences: activeProject.motionTextSequences.map(
					(candidate) =>
						candidate.id === this.previous?.id ? this.previous : candidate,
				),
			},
		});
	}
}
