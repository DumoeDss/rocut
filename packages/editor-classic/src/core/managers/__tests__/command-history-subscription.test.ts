import { expect, test } from "bun:test";
import { commandHarness } from "./command-test-harness";
import { ToggleTrackMuteCommand } from "../../../commands/timeline/track/toggle-track-mute";
import { UpdateProjectSettingsCommand } from "../../../commands/project/update-project-settings";

test("history publishes after durable scene publication, including undo and redo", async () => {
	const published: boolean[] = [];
	const h = await commandHarness(undefined, [], {
		onPublish: () => published.push(h.command.canUndo()),
	});
	const snapshots: unknown[] = [];
	const initial = h.command.getHistorySnapshot();
	expect(h.command.getHistorySnapshot()).toBe(initial);
	const unsubscribe = h.command.subscribe(() => {
		snapshots.push(h.command.getHistorySnapshot());
	});
	await h.command.execute({
		command: new ToggleTrackMuteCommand("main-track"),
	});
	expect(published).toEqual([false]);
	expect(snapshots).toEqual([{ canUndo: true, canRedo: false }]);
	await h.command.undo();
	await h.command.redo();
	expect(snapshots).toEqual([
		{ canUndo: true, canRedo: false },
		{ canUndo: false, canRedo: true },
		{ canUndo: true, canRedo: false },
	]);
	h.command.clear();
	expect(h.command.getHistorySnapshot()).toEqual(initial);
	unsubscribe();
	h.command.clear();
	expect(snapshots).toHaveLength(4);
});

test("failed durable execute/undo/redo publish no history snapshot", async () => {
	const h = await commandHarness();
	let notifications = 0;
	h.command.subscribe(() => notifications++);
	const failSave = () =>
		h.fixture.control.failNext({
			operation: "save-project",
			code: "unavailable",
		});
	const execute = () =>
		h.command.execute({
			command: new ToggleTrackMuteCommand("main-track"),
		});
	failSave();
	await expect(execute()).rejects.toBeDefined();
	expect(notifications).toBe(0);
	await execute();
	const afterExecute = h.command.getHistorySnapshot();
	failSave();
	await expect(h.command.undo()).rejects.toBeDefined();
	expect(h.command.getHistorySnapshot()).toBe(afterExecute);
	expect(notifications).toBe(1);
	await h.command.undo();
	const afterUndo = h.command.getHistorySnapshot();
	failSave();
	await expect(h.command.redo()).rejects.toBeDefined();
	expect(h.command.getHistorySnapshot()).toBe(afterUndo);
	expect(notifications).toBe(2);
});

test("provider-private execute/undo/redo and push/clear notify subscribers", async () => {
	const h = await commandHarness();
	let notifications = 0;
	h.command.subscribe(() => notifications++);
	const command = new UpdateProjectSettingsCommand({});
	await h.command.execute({ command });
	await h.command.undo();
	await h.command.redo();
	h.command.push({ command });
	h.command.clear();
	expect(notifications).toBe(5);
	expect(h.command.getHistorySnapshot()).toEqual({
		canUndo: false,
		canRedo: false,
	});
});
