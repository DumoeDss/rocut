import { expect, test } from "bun:test";
import { projectId, revisionOf } from "@opencut/editor-contracts";
import { commandHarness } from "./command-test-harness";
import { UpdateProjectSettingsCommand } from "../../../commands/project/update-project-settings";

test("master settings use shared revision/history and undo preserves unrelated Agent changes", async () => {
	const h = await commandHarness();
	const effects = [
		{
			id: "grade",
			type: "color-adjustment",
			enabled: true,
			params: {
				exposure: 0.5,
				contrast: 0,
				saturation: 0,
				temperature: 0,
				tint: 0,
			},
		},
	];
	await h.command.execute({
		command: new UpdateProjectSettingsCommand({ masterEffects: effects }),
	});
	expect(await h.transactions.revision()).toBe(revisionOf(1));
	expect((await h.transactions.project())?.masterEffects).toEqual(effects);
	await h.transactions.apply({
		operations: [
			{
				kind: "update-project",
				projectId: projectId(h.getProject().metadata.id),
				patch: { name: "Agent rename" },
			},
		],
	});
	await h.command.travelHistory({ direction: "undo", expectedRevision: 2 });
	expect(h.getProject().settings.masterEffects ?? []).toEqual([]);
	expect(h.getProject().metadata.name).toBe("Agent rename");
	await h.command.travelHistory({ direction: "redo", expectedRevision: 3 });
	expect(h.getProject().settings.masterEffects).toEqual(effects);
	expect(h.getProject().metadata.name).toBe("Agent rename");
});
