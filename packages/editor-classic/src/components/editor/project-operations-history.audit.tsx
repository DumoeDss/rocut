// Explicit DOM audit: COMMON_PROPERTIES_DOM_DEPENDENCIES may point to a host
// providing jsdom. This uses the real header, React store hook and durable router.
import { expect, mock, test } from "bun:test";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

if (process.env.PROJECT_HISTORY_DOM_ISOLATED !== "1") {
	test("header follows history finalization without unrelated UI notifications", () => {
		const result = Bun.spawnSync({
			cmd: [process.execPath, "test", fileURLToPath(import.meta.url)],
			env: { ...process.env, PROJECT_HISTORY_DOM_ISOLATED: "1" },
			stdout: "pipe",
			stderr: "pipe",
			timeout: 15000,
		});
		if (result.exitCode)
			throw new Error(result.stdout.toString() + result.stderr.toString());
	}, 20000);
} else {
	const require = createRequire(import.meta.url);
	const dependencyRoot = process.env.COMMON_PROPERTIES_DOM_DEPENDENCIES;
	const { JSDOM } = require(
		require.resolve("jsdom", {
			paths: dependencyRoot ? [dependencyRoot] : [process.cwd()],
		}),
	);
	const dom = new JSDOM("<!doctype html><html><body></body></html>", {
		url: "http://localhost/",
	});
	for (const key of [
		"window",
		"document",
		"navigator",
		"Node",
		"Element",
		"HTMLElement",
		"Event",
	])
		Reflect.set(globalThis, key, dom.window[key]);
	Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
	const React = await import("react");
	const { createRoot } = await import("react-dom/client");
	const { commandHarness } =
		await import("../../core/managers/__tests__/command-test-harness");
	const { ToggleTrackMuteCommand } =
		await import("../../commands/timeline/track/toggle-track-mute");
	const { getEditorMessages } =
		await import("../../editor/host/editor-messages");
	const publications: boolean[] = [];
	const h = await commandHarness(undefined, [], {
		onPublish: () => publications.push(h.command.canUndo()),
	});
	const saved = {
		isSaving: false,
		isDirty: false,
		isReadOnly: false,
		isPaused: false,
		error: null,
	};
	Object.assign(h.editor.save, {
		subscribe: () => () => {},
		getState: () => saved,
	});
	mock.module("../../editor/use-editor", () => ({
		useEditorInstance: () => h.editor,
		// Deliberately never subscribes: unrelated managers cannot refresh history.
		useEditor: (select: (editor: typeof h.editor) => unknown) =>
			select(h.editor),
	}));
	mock.module("../../editor/host/editor-host-context", () => ({
		useEditorMessages: () => getEditorMessages("en"),
	}));
	mock.module("./panels/assets/views/settings", () => ({
		SettingsView: () => null,
	}));
	const { ProjectOperations } = await import("./project-operations");

	test("durable execute and header Undo/Redo update without a tab or save notification", async () => {
		const container = document.createElement("div");
		document.body.appendChild(container);
		const root = createRoot(container);
		const button = (index: number) =>
			container.querySelectorAll("button")[index]!;
		try {
			await React.act(async () => root.render(<ProjectOperations />));
			expect(button(0).disabled).toBe(true);
			expect(button(1).disabled).toBe(true);
			await React.act(async () => {
				await h.command.execute({
					command: new ToggleTrackMuteCommand("main-track"),
				});
			});
			expect(publications).toEqual([false]);
			expect(button(0).disabled).toBe(false);
			expect(button(1).disabled).toBe(true);
			await React.act(async () => {
				button(0).click();
				await h.command.whenIdle();
			});
			expect(button(0).disabled).toBe(true);
			expect(button(1).disabled).toBe(false);
			await React.act(async () => {
				button(1).click();
				await h.command.whenIdle();
			});
			expect(button(0).disabled).toBe(false);
			expect(button(1).disabled).toBe(true);
		} finally {
			await React.act(async () => root.unmount());
			container.remove();
			dom.window.close();
		}
	});
}
