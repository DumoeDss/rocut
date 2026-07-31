import { describe, expect, test } from "bun:test";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import type { EditorHost } from "@/editor/host/editor-host";
import type { EditorSession } from "../session-types";

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
	const { effectsRegistry, registerDefaultEffects } = await import("@/effects");
	const { graphicsRegistry, registerDefaultGraphics } =
		await import("@/graphics");
	const { masksRegistry, registerDefaultMasks } = await import("@/masks");
	const { assertCanonicalDefaultElementParams, elementParamRegistry } =
		await import("@/params/registry");
	const { stickersRegistry } = await import("@/stickers/registry");
	const { registerDefaultStickerProviders } =
		await import("@/stickers/providers");
	const { BatchCommand } = await import("@/commands/batch-command");
	const { createEditorSession } = await import("../create-session");
	const { editorForSession } =
		await import("@/editor/runtime/session-core-owner");
	const { EditorSessionProvider } = await import("../editor-session-provider");
	const { EditorSessionHost, createEditorSessionHostController } =
		await import("../editor-session-host");
	const { ensureEditorProcessBootstrap } =
		await import("@/editor/runtime/process-bootstrap");
	const { createInMemoryHost } = await import("@/editor/ports/in-memory/host");
	const { RecordingDiagnostics } = await import("@/editor/ports/in-memory");
	const { useEditor, useEditorInstance } = await import("@/editor/use-editor");
	const { storesForSession } = await import("../../runtime/session-stores");

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

	describe("first process bootstrap collision controls", () => {
		test("rejects conflicts in all five registry families", () => {
			registerDefaultEffects();
			const effect = effectsRegistry.get("blur");
			effectsRegistry.register({
				key: "blur",
				definition: { ...effect, name: `${effect.name} conflict` },
			});
			expect(() => registerDefaultEffects()).toThrow(
				"Conflicting default effect",
			);
			effectsRegistry.register({ key: "blur", definition: effect });

			registerDefaultMasks();
			const mask = masksRegistry.get("split");
			masksRegistry.register({
				key: "split",
				definition: { ...mask, name: `${mask.name} conflict` },
			});
			expect(() => registerDefaultMasks()).toThrow("Conflicting default mask");
			masksRegistry.register({ key: "split", definition: mask });

			registerDefaultGraphics();
			const graphic = graphicsRegistry.get("rectangle");
			graphicsRegistry.register({
				key: "rectangle",
				definition: { ...graphic, name: `${graphic.name} conflict` },
			});
			expect(() => registerDefaultGraphics()).toThrow(
				"Conflicting default graphic",
			);
			graphicsRegistry.register({ key: "rectangle", definition: graphic });

			const parameters = elementParamRegistry.get("video");
			elementParamRegistry.register({
				key: "video",
				definition: [...parameters],
			});
			expect(() => assertCanonicalDefaultElementParams()).toThrow(
				"Conflicting default parameter",
			);
			elementParamRegistry.register({ key: "video", definition: parameters });

			registerDefaultStickerProviders();
			const sticker = stickersRegistry.get("logos");
			stickersRegistry.register({
				key: "logos",
				definition: { ...sticker, resolveUrl: () => "conflict" },
			});
			expect(() => registerDefaultStickerProviders()).toThrow(
				"Conflicting default sticker",
			);
			stickersRegistry.register({ key: "logos", definition: sticker });
		});
	});

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

		test("concurrent disposal joins one session-local cleanup", async () => {
			let resourceRevocations = 0;
			const hostA = createInMemoryHost({ projectId: "a" });
			if (!hostA.runtimeResources) {
				throw new Error("The in-memory Host must provide runtime resources.");
			}
			const createObjectUrl = hostA.runtimeResources.createObjectUrl.bind(
				hostA.runtimeResources,
			);
			hostA.runtimeResources.createObjectUrl = (args) => {
				const handle = createObjectUrl(args);
				return {
					...handle,
					revoke: () => {
						resourceRevocations += 1;
						handle.revoke();
					},
				};
			};
			const sessionA = await createEditorSession({
				host: hostA,
			});
			const sessionB = await createEditorSession({
				host: createInMemoryHost({ projectId: "b" }),
			});
			const editorA = editorForSession(sessionA);
			const editorB = editorForSession(sessionB);
			const calls: string[] = [];
			let playbackDisposals = 0;
			const disposePlayback = editorA.playback.dispose.bind(editorA.playback);
			sessionA.resources.createObjectUrl({ blob: new Blob() });

			editorA.save.pause = () => calls.push("a:pause");
			editorA.save.resume = () => calls.push("a:resume");
			editorA.save.stop = () => calls.push("a:stop");
			editorB.save.pause = () => calls.push("b:pause");
			editorB.save.resume = () => calls.push("b:resume");
			editorB.save.stop = () => calls.push("b:stop");
			editorA.playback.dispose = () => {
				playbackDisposals += 1;
				disposePlayback();
			};
			await sessionA.suspend();
			await sessionA.resume();
			const firstDisposal = sessionA.dispose();
			const concurrentDisposal = sessionA.dispose();
			expect(concurrentDisposal).toBe(firstDisposal);
			await Promise.all([firstDisposal, concurrentDisposal]);

			expect(calls).toEqual(["a:pause", "a:resume", "a:stop"]);
			expect(playbackDisposals).toBe(1);
			expect(resourceRevocations).toBe(1);
			expect(() => editorForSession(sessionA)).toThrow("unknown or disposed");
			expect(editorForSession(sessionB)).toBe(editorB);

			await sessionB.dispose();
			expect(calls).toEqual(["a:pause", "a:resume", "a:stop", "b:stop"]);
		});

		test("adding a sound targets only the supplied live session", async () => {
			const sessionA = await createEditorSession({
				host: createInMemoryHost({ projectId: "sound-a" }),
			});
			const sessionB = await createEditorSession({
				host: createInMemoryHost({ projectId: "sound-b" }),
			});
			const editorA = editorForSession(sessionA);
			const editorB = editorForSession(sessionB);
			const insertedA: unknown[] = [];
			const insertedB: unknown[] = [];
			editorA.timeline.insertElement = (args) => insertedA.push(args);
			editorB.timeline.insertElement = (args) => insertedB.push(args);

			const originalFetch = globalThis.fetch;
			const audioContextDescriptor = Object.getOwnPropertyDescriptor(
				globalThis,
				"AudioContext",
			);
			globalThis.fetch = Object.assign(
				async () => new Response(new ArrayBuffer(8)),
				{ preconnect: () => {} },
			);
			Object.defineProperty(globalThis, "AudioContext", {
				configurable: true,
				writable: true,
				value: class {
					async decodeAudioData() {
						return { duration: 1 };
					}
				},
			});

			try {
				const added = await storesForSession(sessionA)
					.sounds.getState()
					.addSoundToTimeline({
						editor: editorA,
						sound: {
							id: 1,
							name: "session-owned sound",
							description: "",
							url: "https://example.test/sound",
							previewUrl: "https://example.test/sound.mp3",
							duration: 1,
							filesize: 8,
							type: "mp3",
							channels: 2,
							bitrate: 128,
							bitdepth: 16,
							samplerate: 44_100,
							username: "test",
							tags: [],
							license: "test",
							created: "2026-07-31",
							downloads: 0,
							rating: 0,
							ratingCount: 0,
						},
					});
				expect(added).toBe(true);
				expect(insertedA).toHaveLength(1);
				expect(insertedB).toHaveLength(0);
			} finally {
				globalThis.fetch = originalFetch;
				if (audioContextDescriptor) {
					Object.defineProperty(
						globalThis,
						"AudioContext",
						audioContextDescriptor,
					);
				} else {
					Reflect.deleteProperty(globalThis, "AudioContext");
				}
				await sessionA.dispose();
				await sessionB.dispose();
			}
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
				return createElement(
					"span",
					null,
					String(useEditorInstance() === expected),
				);
			}
			function SelectorProbe() {
				return createElement(
					"span",
					null,
					useEditor(
						(editor) => editor.project.getActiveOrNull()?.metadata.id ?? "none",
					),
				);
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
			expect(
				renderToString(
					createElement(
						EditorSessionProvider,
						{ session: sessionA },
						createElement(SelectorProbe),
					),
				),
			).toContain("none");
			expect(() =>
				renderToString(createElement(Probe, { expected: editorA })),
			).toThrow("outside an <EditorSessionProvider>");
			expect(() => renderToString(createElement(SelectorProbe))).toThrow(
				"outside an <EditorSessionProvider>",
			);

			await sessionA.dispose();
			await sessionB.dispose();
		});

		test("deferred Host churn never crosses session or error generations", async () => {
			const flushMicrotasks = async () => {
				for (let index = 0; index < 8; index += 1) {
					await Promise.resolve();
				}
			};
			expect(typeof EditorSessionHost).toBe("function");
			const hostA = createInMemoryHost({ projectId: "host-a" });
			const hostB = createInMemoryHost({ projectId: "host-b" });
			const requests: Array<{
				host: EditorHost;
				resolve: (session: EditorSession) => void;
				reject: (error: Error) => void;
			}> = [];
			const disposals = { lateA: 0, firstB: 0, secondB: 0 };
			const snapshots: Array<{
				host: EditorHost;
				generation: number;
				session: EditorSession | null;
				error: Error | null;
			}> = [];
			async function trackedSession(key: keyof typeof disposals) {
				const session = await createEditorSession({
					host: createInMemoryHost({ projectId: `tracked-${key}` }),
				});
				const dispose = session.dispose.bind(session);
				session.dispose = () => {
					disposals[key] += 1;
					return dispose();
				};
				return session;
			}
			const lateA = await trackedSession("lateA");
			const firstB = await trackedSession("firstB");
			const secondB = await trackedSession("secondB");
			const controller = createEditorSessionHostController({
				prepareRuntime: async () => ({
					runtimeGraphics: {
						selectedBackend: () => "webgpu",
						concurrentCompositorInstances: () => 2,
					},
					runtimeGpu: { liveHandles: () => [], release: () => {} },
					dispose: () => {},
				}),
				createSession: ({ host }) =>
					new Promise((resolve, reject) => {
						requests.push({ host, resolve, reject });
					}),
				onChange: (snapshot) => {
					if (snapshot) snapshots.push(snapshot);
				},
			});

			controller.begin(hostA);
			await flushMicrotasks();
			controller.begin(hostB);
			await flushMicrotasks();
			requests[0]!.resolve(lateA);
			await flushMicrotasks();
			expect(disposals.lateA).toBe(1);
			expect(controller.currentForHost(hostB)?.session).toBeNull();
			expect(controller.currentForHost(hostA)).toBeNull();

			requests[1]!.resolve(firstB);
			await flushMicrotasks();
			expect(controller.currentForHost(hostB)?.session).toBe(firstB);

			controller.begin(hostA);
			await flushMicrotasks();
			const cleanupSecondB = controller.begin(hostB);
			await flushMicrotasks();
			requests[2]!.reject(new Error("stale A failure"));
			await flushMicrotasks();
			expect(controller.currentForHost(hostB)?.error).toBeNull();
			requests[3]!.resolve(secondB);
			await flushMicrotasks();
			expect(controller.currentForHost(hostB)?.session).toBe(secondB);
			expect(controller.currentForHost(hostB)?.error).toBeNull();
			expect(disposals.firstB).toBe(1);
			expect(
				snapshots.some(
					(snapshot) => snapshot.host === hostB && snapshot.session === lateA,
				),
			).toBe(false);
			expect(
				snapshots.some(
					(snapshot) => snapshot.error?.message === "stale A failure",
				),
			).toBe(false);
			cleanupSecondB();
			expect(disposals.secondB).toBe(1);
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
