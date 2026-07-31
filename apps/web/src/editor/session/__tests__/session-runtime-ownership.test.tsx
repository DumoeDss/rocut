import { describe, expect, test } from "bun:test";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToString } from "react-dom/server";

if (process.env.OPENCUT_SESSION_TEST_ISOLATED !== "1") {
	test("session ownership suite runs in an isolated wasm-mock process", () => {
		const result = Bun.spawnSync({
			cmd: [process.execPath, "test", fileURLToPath(import.meta.url)],
			cwd: process.cwd(),
			env: {
				...process.env,
				OPENCUT_SESSION_TEST_ISOLATED: "1",
			},
			stderr: "pipe",
			stdout: "pipe",
		});
		if (result.exitCode !== 0) {
			throw new Error(
				`isolated session ownership suite failed:\n${result.stderr.toString()}`,
			);
		}
	});
} else {
	await import("./wasm-test-mock");
	const { effectsRegistry } = await import("@/effects");
	const { graphicsRegistry } = await import("@/graphics");
	const { masksRegistry } = await import("@/masks");
	const { elementParamRegistry } = await import("@/params/registry");
	const { stickersRegistry } = await import("@/stickers/registry");
	const { BatchCommand } = await import("@/commands/batch-command");
	const { createEditorSession } = await import("../create-session");
	const { editorForSession } =
		await import("@/editor/runtime/session-core-owner");
	const { EditorSessionProvider } = await import("../editor-session-provider");
	const { ensureEditorProcessBootstrap } =
		await import("@/editor/runtime/process-bootstrap");
	const { createInMemoryHost } = await import("@/editor/ports/in-memory/host");
	const { RecordingDiagnostics } = await import("@/editor/ports/in-memory");
	const { useEditor } = await import("@/editor/use-editor");

	const MANAGER_KEYS = [
		"timeline",
		"command",
		"playback",
		"scenes",
		"project",
		"media",
		"renderer",
		"save",
		"audio",
		"selection",
		"clipboard",
		"diagnostics",
	] as const;

	describe("session-owned editor runtime", () => {
		test("two sessions own distinct cores, managers and histories", async () => {
			const sessionA = await createEditorSession({
				host: createInMemoryHost({ projectId: "a" }),
			});
			const sessionB = await createEditorSession({
				host: createInMemoryHost({ projectId: "b" }),
			});
			const editorA = editorForSession(sessionA);
			const editorB = editorForSession(sessionB);

			expect(editorA).not.toBe(editorB);
			for (const key of MANAGER_KEYS) {
				expect(editorA[key]).not.toBe(editorB[key]);
			}

			editorA.command.execute({
				command: {
					execute: ({ editor }) => {
						expect(editor).toBe(editorA);
						return undefined;
					},
					undo: () => {},
					redo: () => undefined,
				},
			});
			expect(editorA.command.canUndo()).toBe(true);
			expect(editorB.command.canUndo()).toBe(false);

			await sessionA.dispose();
			await sessionB.dispose();
		});

		test("execute, undo, redo and batches keep the owning context", async () => {
			const session = await createEditorSession({
				host: createInMemoryHost(),
			});
			const editor = editorForSession(session);
			const seen: string[] = [];
			const child = (name: string) => ({
				execute: (context: { editor: typeof editor }) => {
					expect(context.editor).toBe(editor);
					seen.push(`${name}:execute`);
					return undefined;
				},
				undo: (context: { editor: typeof editor }) => {
					expect(context.editor).toBe(editor);
					seen.push(`${name}:undo`);
				},
				redo: (context: { editor: typeof editor }) => {
					expect(context.editor).toBe(editor);
					seen.push(`${name}:redo`);
					return undefined;
				},
			});
			const batch = new BatchCommand([child("one"), child("two")]);

			editor.command.execute({ command: batch });
			editor.command.undo();
			editor.command.redo();

			expect(seen).toEqual([
				"one:execute",
				"two:execute",
				"two:undo",
				"one:undo",
				"one:redo",
				"two:redo",
			]);
			await session.dispose();
		});

		test("lifecycle cleanup is session-local and lookup fails after disposal", async () => {
			const sessionA = await createEditorSession({
				host: createInMemoryHost({ projectId: "a" }),
			});
			const sessionB = await createEditorSession({
				host: createInMemoryHost({ projectId: "b" }),
			});
			const editorA = editorForSession(sessionA);
			const editorB = editorForSession(sessionB);
			const calls: string[] = [];

			editorA.save.pause = () => calls.push("a:pause");
			editorA.save.resume = () => calls.push("a:resume");
			editorA.save.stop = () => calls.push("a:stop");
			editorB.save.pause = () => calls.push("b:pause");
			editorB.save.resume = () => calls.push("b:resume");
			editorB.save.stop = () => calls.push("b:stop");

			await sessionA.suspend();
			await sessionA.resume();
			await sessionA.dispose();
			await sessionA.dispose();

			expect(calls).toEqual(["a:pause", "a:resume", "a:stop"]);
			expect(() => editorForSession(sessionA)).toThrow("unknown or disposed");
			expect(editorForSession(sessionB)).toBe(editorB);

			await sessionB.dispose();
			expect(calls).toEqual(["a:pause", "a:resume", "a:stop", "b:stop"]);
		});

		test("session diagnostics stay on their owning Host port", async () => {
			const diagnosticsA = new RecordingDiagnostics();
			const diagnosticsB = new RecordingDiagnostics();
			const hostA = {
				...createInMemoryHost({ projectId: "a" }),
				diagnostics: diagnosticsA,
			};
			const hostB = {
				...createInMemoryHost({ projectId: "b" }),
				diagnostics: diagnosticsB,
			};
			const sessionA = await createEditorSession({ host: hostA });
			const sessionB = await createEditorSession({ host: hostB });

			sessionA.diagnostics.event({
				event: { kind: "migration-started", from: null, to: 2 },
			});

			expect(diagnosticsA.events).toEqual([
				{
					sessionId: sessionA.id,
					event: { kind: "migration-started", from: null, to: 2 },
				},
			]);
			expect(diagnosticsB.events).toEqual([]);

			await sessionA.dispose();
			await sessionB.dispose();
		});
	});

	describe("React session ownership", () => {
		test("each provider resolves its own editor and missing provider fails loudly", async () => {
			const sessionA = await createEditorSession({
				host: createInMemoryHost({ projectId: "a" }),
			});
			const sessionB = await createEditorSession({
				host: createInMemoryHost({ projectId: "b" }),
			});
			const editorA = editorForSession(sessionA);
			const editorB = editorForSession(sessionB);

			function Probe({ expected }: { expected: typeof editorA }) {
				return createElement("span", null, String(useEditor() === expected));
			}

			expect(
				renderToString(
					createElement(
						EditorSessionProvider,
						{ session: sessionA },
						createElement(Probe, { expected: editorA }),
					),
				),
			).toContain("true");
			expect(
				renderToString(
					createElement(
						EditorSessionProvider,
						{ session: sessionB },
						createElement(Probe, { expected: editorB }),
					),
				),
			).toContain("true");
			expect(() =>
				renderToString(createElement(Probe, { expected: editorA })),
			).toThrow("outside an <EditorSessionProvider>");

			await sessionA.dispose();
			await sessionB.dispose();
		});
	});

	describe("process bootstrap", () => {
		test("repeated bootstrap does not re-register definitions", () => {
			ensureEditorProcessBootstrap();
			const before = [
				effectsRegistry.getAll().length,
				masksRegistry.getAll().length,
				graphicsRegistry.getAll().length,
				elementParamRegistry.getAll().length,
				stickersRegistry.getAll().length,
			];
			expect(before.every((count) => count > 0)).toBe(true);

			ensureEditorProcessBootstrap();
			expect([
				effectsRegistry.getAll().length,
				masksRegistry.getAll().length,
				graphicsRegistry.getAll().length,
				elementParamRegistry.getAll().length,
				stickersRegistry.getAll().length,
			]).toEqual(before);

			const effect = effectsRegistry.getAll()[0]!;
			effectsRegistry.register({
				key: effect.type,
				definition: { ...effect },
			});
			expect(() => ensureEditorProcessBootstrap()).toThrow(
				"A bootstrapped default effect definition was replaced",
			);
		});
	});
}
