import type { MvFlamePlan } from "@opencut/editor-contracts";

/** Scene paint is nested in fl-scene, not a root scratch/output operation. */
export function omitFlameFingers(data: MvFlamePlan) {
	let removed = 0;
	const commands = data.commands.map((command) => {
		if (command.kind !== "surface" || command.id !== "fl-scene") return command;
		return {
			...command,
			commands: command.commands.filter((child) => {
				if (child.kind !== "blit" || child.surface !== "fl-fingers")
					return true;
				removed++;
				return false;
			}),
		};
	});
	if (removed !== 1)
		throw Error(
			`Flame no-fingers mutation must remove exactly one scene draw, removed ${removed}`,
		);
	Reflect.set(data, "commands", commands);
}
