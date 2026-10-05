import { expect, test } from "bun:test";
import { trackId } from "@opencut/editor-contracts";
import { commandHarness } from "./command-test-harness";
import {
	projectFixture,
	TEST_PROJECT_ID,
} from "../../../editor/transactions/opencut/__tests__/fixture";
const { ProjectManager } = await import("../project-manager");
const { RenameProjectCommand, UpdateProjectSettingsCommand } =
	await import("../../../commands/project");

test("active rename survives subsequent transactions, history and durable reopen", async () => {
	const harness = await commandHarness();
	const manager = new ProjectManager(harness.editor);
	manager.setActiveProject({ project: harness.getProject() });
	try {
		await harness.command.execute({
			command: new UpdateProjectSettingsCommand({
				canvasSize: { width: 640, height: 360 },
			}),
		});
		await manager.renameProject({
			id: TEST_PROJECT_ID,
			name: "Renamed project",
		});
		const renamedAt = harness.getProject().metadata.updatedAt;
		expect(renamedAt.getTime()).toBeGreaterThan(
			projectFixture().metadata.updatedAt.getTime(),
		);
		expect(
			(await harness.editor.persistence.loadProject({ id: TEST_PROJECT_ID }))
				?.metadata.updatedAt,
		).toEqual(renamedAt);
		expect(harness.command.getHistoryCount()).toBe(1);
		await harness.transactions.apply({
			operations: [
				{
					kind: "update-track",
					trackId: trackId("main-track"),
					patch: { name: "Later edit" },
				},
			],
		});
		expect(harness.getProject().metadata.name).toBe("Renamed project");
		expect(Number(await harness.transactions.revision())).toBe(3);
		await harness.command.undo();
		expect(harness.getProject().metadata.name).toBe("Renamed project");
		expect(harness.getProject().settings.canvasSize.width).toBe(1920);
		await harness.command.redo();
		expect(harness.getProject().metadata.name).toBe("Renamed project");
		expect(harness.getProject().settings.canvasSize.width).toBe(640);
		await harness.transactions.open({ projectId: TEST_PROJECT_ID, assets: [] });
		expect((await harness.transactions.project())?.name).toBe(
			"Renamed project",
		);
		expect((await harness.transactions.tracks())[0].name).toBe("Later edit");
		const revision = await harness.transactions.revision();
		harness.fixture.control.failNext({
			operation: "save-project",
			code: "unavailable",
		});
		await expect(
			manager.renameProject({ id: TEST_PROJECT_ID, name: "Failed rename" }),
		).rejects.toMatchObject({ code: "unavailable" });
		expect(await harness.transactions.revision()).toBe(revision);
		expect((await harness.transactions.project())?.name).toBe(
			"Renamed project",
		);
		expect(harness.command.getHistoryCount()).toBe(1);
	} finally {
		await harness.transactions.dispose();
	}
});

test("a queued rename cannot target a different active project", async () => {
	const harness = await commandHarness();
	try {
		await expect(
			harness.command.executeSystem({
				command: new RenameProjectCommand({
					projectId: "different-project",
					name: "Wrong target",
				}),
			}),
		).rejects.toThrow("no longer active");
		expect(harness.getProject().metadata.name).toBe("OpenCut routing");
		expect(Number(await harness.transactions.revision())).toBe(0);
		expect(harness.command.getHistoryCount()).toBe(0);
	} finally {
		await harness.transactions.dispose();
	}
});

test("renaming an inactive project leaves the active transaction state untouched", async () => {
	const harness = await commandHarness();
	const manager = new ProjectManager(harness.editor);
	manager.setActiveProject({ project: harness.getProject() });
	const other = projectFixture();
	other.metadata.id = "inactive-project";
	try {
		await harness.editor.persistence.saveProject({ project: other });
		await manager.renameProject({
			id: other.metadata.id,
			name: "Inactive renamed",
		});
		expect(
			(await harness.editor.persistence.loadProject({ id: other.metadata.id }))
				?.metadata.name,
		).toBe("Inactive renamed");
		expect(harness.getProject().metadata.name).toBe("OpenCut routing");
		expect(Number(await harness.transactions.revision())).toBe(0);
		expect(harness.command.getHistoryCount()).toBe(0);
	} finally {
		await harness.transactions.dispose();
	}
});
