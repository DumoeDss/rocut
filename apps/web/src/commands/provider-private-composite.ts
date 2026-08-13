import {
	Command,
	type CommandResult,
	type EditorCommandContext,
} from "./base-command";

export class ProviderPrivateCompositeCommand extends Command {
	readonly routingClass = "provider-private" as const;

	constructor(private readonly commands: readonly Command[]) {
		super();
		if (commands.length === 0) {
			throw new Error("Provider-private composite commands must not be empty");
		}
		this.assertProviderPrivateChildren(commands);
	}

	getCommands(): readonly Command[] {
		return this.commands;
	}

	execute(context: EditorCommandContext): CommandResult | undefined {
		const executed: Command[] = [];
		try {
			let latestSelection: CommandResult | undefined;
			for (const command of this.commands) {
				const result = command.execute(context);
				executed.push(command);
				if (result?.selection !== undefined) latestSelection = result;
			}
			return latestSelection;
		} catch (error) {
			for (const command of executed.reverse()) command.undo(context);
			throw error;
		}
	}

	undo(context: EditorCommandContext): void {
		for (const command of [...this.commands].reverse()) command.undo(context);
	}

	redo(context: EditorCommandContext): CommandResult | undefined {
		const redone: Command[] = [];
		try {
			let latestSelection: CommandResult | undefined;
			for (const command of this.commands) {
				const result = command.redo(context);
				redone.push(command);
				if (result?.selection !== undefined) latestSelection = result;
			}
			return latestSelection;
		} catch (error) {
			for (const command of redone.reverse()) command.undo(context);
			throw error;
		}
	}

	private assertProviderPrivateChildren(commands: readonly Command[]): void {
		for (const command of commands) {
			if (command instanceof ProviderPrivateCompositeCommand) {
				this.assertProviderPrivateChildren(command.getCommands());
				continue;
			}
			if (command.routingClass !== "provider-private") {
				throw new Error(
					"Provider-private composites accept only provider-private children",
				);
			}
		}
	}
}
