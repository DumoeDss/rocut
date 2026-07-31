import {
	Command,
	type CommandResult,
	type EditorCommandContext,
} from "./base-command";

export class BatchCommand extends Command {
	constructor(private commands: Command[]) {
		super();
	}

	execute(context: EditorCommandContext): CommandResult | undefined {
		let latestSelectionResult: CommandResult | undefined;

		for (const command of this.commands) {
			const result = command.execute(context);
			if (result?.selection !== undefined) {
				latestSelectionResult = result;
			}
		}

		return latestSelectionResult;
	}

	undo(context: EditorCommandContext): void {
		for (const command of [...this.commands].reverse()) {
			command.undo(context);
		}
	}

	redo(context: EditorCommandContext): CommandResult | undefined {
		let latestSelectionResult: CommandResult | undefined;

		for (const command of this.commands) {
			const result = command.redo(context);
			if (result?.selection !== undefined) {
				latestSelectionResult = result;
			}
		}

		return latestSelectionResult;
	}
}
