import { describe, expect, test } from "bun:test";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import type { EditorHost } from "@opencut/editor-ports/host";
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
	const { wasmTestControl } = await import("./wasm-test-mock");
	const { effectsRegistry, registerDefaultEffects } = await import("../../../effects");
	const { graphicsRegistry, registerDefaultGraphics } =
		await import("../../../graphics");
	const { masksRegistry, registerDefaultMasks } = await import("../../../masks");
	const { assertCanonicalDefaultElementParams, elementParamRegistry } =
		await import("../../../params/registry");
	const { stickersRegistry } = await import("../../../stickers/registry");
	const { registerDefaultStickerProviders } =
		await import("../../../stickers/providers");
	const { createEditorSession } = await import("../create-session");
	const { editorForSession } =
		await import("../../runtime/session-core-owner");
	const { EditorSessionProvider } = await import("../editor-session-provider");
	const { EditorSessionHost, createEditorSessionHostController } =
		await import("../editor-session-host");
	const { prepareWasmRuntimeProviders } =
		await import("../../runtime/wasm-runtime-providers");
	const { ensureEditorProcessBootstrap } =
		await import("../../runtime/process-bootstrap");
	const { createInMemoryHost } = await import("@opencut/editor-ports/in-memory/host");
	const { C6TestAudioContext } = await import("./c6-test-audio-context");
	const { RecordingDiagnostics } = await import("@opencut/editor-ports/in-memory");
	const { useEditor, useEditorInstance } = await import("../../use-editor");
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
	const aggregateErrors = (error: unknown): unknown[] => {
		if (!(error instanceof AggregateError)) {
			throw new Error("Expected an AggregateError.");
		}
		return error.errors;
	};

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
			expect(editorA.media.getVideoCache()).not.toBe(
				editorB.media.getVideoCache(),
			);
			expect(editorA.media.getWaveformCache()).not.toBe(
				editorB.media.getWaveformCache(),
			);

			editorA.command.execute({
				command: {
					routingClass: "provider-private" as const,
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

		test("execute, undo, and redo keep the owning context", async () => {
			const session = await createEditorSession({
				host: createInMemoryHost(),
			});
			const editor = editorForSession(session);
			const seen: string[] = [];
			const child = (name: string) => ({
				routingClass: "provider-private" as const,
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
			await editor.command.execute({ command: child("one") });
			await editor.command.execute({ command: child("two") });
			await editor.command.undo();
			await editor.command.undo();
			await editor.command.redo();
			await editor.command.redo();

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
			const hostA = createInMemoryHost({ projectId: "sound-a" });
			const hostB = createInMemoryHost({ projectId: "sound-b" });
			// The protected in-memory port intentionally has no ambient Web Audio
			// implementation. Supply the test's decoder through the owning Host seam
			// instead of mutating globalThis.AudioContext.
			const createAudioContext = hostA.runtimeResources.createAudioContext.bind(
				hostA.runtimeResources,
			);
			hostA.runtimeResources.createAudioContext = (args) => {
				const handle = createAudioContext(args);
				return {
					...handle,
					context: new C6TestAudioContext(),
				};
			};
			const sessionA = await createEditorSession({
				host: hostA,
			});
			const sessionB = await createEditorSession({
				host: hostB,
			});
			const editorA = editorForSession(sessionA);
			const editorB = editorForSession(sessionB);
			const insertedA: unknown[] = [];
			const insertedB: unknown[] = [];
			editorA.timeline.insertElement = (args) => insertedA.push(args);
			editorB.timeline.insertElement = (args) => insertedB.push(args);

			const originalFetch = globalThis.fetch;
			globalThis.fetch = Object.assign(
				async () => new Response(new ArrayBuffer(8)),
				{ preconnect: () => {} },
			);

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

		test("cancelled Host creation settles before freeing its runtime wrappers", async () => {
			const flushMicrotasks = async () => {
				for (let index = 0; index < 8; index += 1) {
					await Promise.resolve();
				}
			};
			let releaseCreation!: () => void;
			const creationGate = new Promise<void>((resolve) => {
				releaseCreation = resolve;
			});
			let markSessionCreated!: () => void;
			const sessionCreated = new Promise<void>((resolve) => {
				markSessionCreated = resolve;
			});
			let markRuntimeDisposed!: () => void;
			const runtimeDisposed = new Promise<void>((resolve) => {
				markRuntimeDisposed = resolve;
			});
			let wrapperFreed = false;
			let runtimeDisposals = 0;
			let sessionDisposals = 0;
			let createdSession: EditorSession | null = null;
			const runtimeGraphics = {
				selectedBackend: () => {
					if (wrapperFreed) throw new Error("graphics wrapper freed");
					return "webgpu" as const;
				},
				concurrentCompositorInstances: () => {
					if (wrapperFreed) throw new Error("graphics wrapper freed");
					return 2;
				},
			};
			const runtimeGpu = {
				liveHandles: () => {
					if (wrapperFreed) throw new Error("gpu wrapper freed");
					return [];
				},
				release: () => {
					if (wrapperFreed) throw new Error("gpu wrapper freed");
				},
			};
			const prepareRuntime = async () => ({
				runtimeGraphics,
				runtimeGpu,
				dispose: () => {
					runtimeDisposals += 1;
					if (wrapperFreed) throw new Error("runtime disposed twice");
					wrapperFreed = true;
					markRuntimeDisposed();
				},
			});
			const controller = createEditorSessionHostController({
				prepareRuntime,
				createSession: async (args) => {
					const session = await createEditorSession(args);
					createdSession = session;
					const dispose = session.dispose.bind(session);
					session.dispose = () => {
						sessionDisposals += 1;
						return dispose();
					};
					markSessionCreated();
					await creationGate;
					return session;
				},
				onChange: () => {},
			});

			const cancel = controller.begin(
				createInMemoryHost({ projectId: "cancelled-create" }),
			);
			await sessionCreated;
			cancel();
			expect(runtimeDisposals).toBe(0);
			expect(runtimeGpu.liveHandles()).toEqual([]);
			releaseCreation();
			await runtimeDisposed;
			await flushMicrotasks();
			expect(sessionDisposals).toBe(1);
			expect(runtimeDisposals).toBe(1);
			expect(() => runtimeGpu.liveHandles()).toThrow("gpu wrapper freed");
			expect(() => editorForSession(createdSession!)).toThrow(
				"unknown or disposed",
			);

			let rejectCreation!: (error: Error) => void;
			const rejectedCreation = new Promise<EditorSession>((_, reject) => {
				rejectCreation = reject;
			});
			let rejectedWrapperFreed = false;
			let rejectedRuntimeDisposals = 0;
			const rejectedRuntimeGraphics = {
				selectedBackend: () => {
					if (rejectedWrapperFreed) throw new Error("graphics wrapper freed");
					return "webgpu" as const;
				},
				concurrentCompositorInstances: () => {
					if (rejectedWrapperFreed) throw new Error("graphics wrapper freed");
					return 2;
				},
			};
			const rejectedRuntimeGpu = {
				liveHandles: () => {
					if (rejectedWrapperFreed) throw new Error("gpu wrapper freed");
					return [];
				},
				release: () => {
					if (rejectedWrapperFreed) throw new Error("gpu wrapper freed");
				},
			};
			const rejectedController = createEditorSessionHostController({
				prepareRuntime: async () => ({
					runtimeGraphics: rejectedRuntimeGraphics,
					runtimeGpu: rejectedRuntimeGpu,
					dispose: () => {
						rejectedRuntimeDisposals += 1;
						if (rejectedWrapperFreed)
							throw new Error("rejected runtime disposed twice");
						rejectedWrapperFreed = true;
					},
				}),
				createSession: () => rejectedCreation,
				onChange: () => {},
			});
			const cancelRejected = rejectedController.begin(
				createInMemoryHost({ projectId: "cancelled-reject" }),
			);
			await flushMicrotasks();
			cancelRejected();
			expect(rejectedRuntimeDisposals).toBe(0);
			rejectCreation(new Error("creation rejected"));
			await flushMicrotasks();
			expect(rejectedRuntimeDisposals).toBe(1);
			expect(() => rejectedRuntimeGpu.liveHandles()).toThrow(
				"gpu wrapper freed",
			);
		});

		test("Host teardown detaches ownership, observes every failure and never retries", async () => {
			const flushTasks = async () => {
				for (let index = 0; index < 12; index += 1) {
					await Promise.resolve();
				}
				await new Promise((resolve) => setTimeout(resolve, 0));
			};
			const unhandled: unknown[] = [];
			const onUnhandled = (reason: unknown) => unhandled.push(reason);
			process.on("unhandledRejection", onUnhandled);
			try {
				const lateSessionError = new Error("late session dispose rejected");
				const lateRuntimeError = new Error("late runtime dispose rejected");
				let resolveLate!: (session: EditorSession) => void;
				const lateCreation = new Promise<EditorSession>((resolve) => {
					resolveLate = resolve;
				});
				let lateSessionDisposals = 0;
				let lateRuntimeDisposals = 0;
				let reportLateCleanup!: (error: Error) => void;
				const lateCleanupReported = new Promise<Error>((resolve) => {
					reportLateCleanup = resolve;
				});
				const lateController = createEditorSessionHostController({
					prepareRuntime: async () => ({
						runtimeGraphics: {
							selectedBackend: () => "webgpu",
							concurrentCompositorInstances: () => 2,
						},
						runtimeGpu: { liveHandles: () => [], release: () => {} },
						dispose: async () => {
							lateRuntimeDisposals += 1;
							throw lateRuntimeError;
						},
					}),
					createSession: () => lateCreation,
					onCleanupError: reportLateCleanup,
					onChange: () => {},
				});
				const lateHost = createInMemoryHost({ projectId: "late-cleanup" });
				const cancelLate = lateController.begin(lateHost);
				await flushTasks();
				cancelLate();
				const lateSession = await createEditorSession({
					host: createInMemoryHost({ projectId: "late-rejected-disposal" }),
				});
				const disposeLateSession = lateSession.dispose.bind(lateSession);
				lateSession.dispose = async () => {
					lateSessionDisposals += 1;
					await disposeLateSession();
					throw lateSessionError;
				};
				resolveLate(lateSession);
				const lateCleanupError = await lateCleanupReported;
				expect(lateCleanupError).toBeInstanceOf(AggregateError);
				expect(aggregateErrors(lateCleanupError)).toEqual([
					lateSessionError,
					lateRuntimeError,
				]);
				cancelLate();
				await flushTasks();
				expect({ lateSessionDisposals, lateRuntimeDisposals }).toEqual({
					lateSessionDisposals: 1,
					lateRuntimeDisposals: 1,
				});
				expect(lateController.currentForHost(lateHost)).toBeNull();

				const earlyRuntimeError = new Error("early runtime dispose threw");
				let resolvePrepared!: (
					runtime: Awaited<ReturnType<typeof prepareWasmRuntimeProviders>>,
				) => void;
				const prepared = new Promise<
					Awaited<ReturnType<typeof prepareWasmRuntimeProviders>>
				>((resolve) => {
					resolvePrepared = resolve;
				});
				let earlyRuntimeDisposals = 0;
				let earlyCreateCalls = 0;
				let reportEarlyCleanup!: (error: Error) => void;
				const earlyCleanupReported = new Promise<Error>((resolve) => {
					reportEarlyCleanup = resolve;
				});
				const earlyController = createEditorSessionHostController({
					prepareRuntime: () => prepared,
					createSession: async () => {
						earlyCreateCalls += 1;
						throw new Error("must not create after cancellation");
					},
					onCleanupError: reportEarlyCleanup,
					onChange: () => {},
				});
				const earlyHost = createInMemoryHost({ projectId: "early-cancel" });
				const cancelEarly = earlyController.begin(earlyHost);
				cancelEarly();
				resolvePrepared({
					runtimeGraphics: {
						selectedBackend: () => "webgpu",
						concurrentCompositorInstances: () => 2,
					},
					runtimeGpu: { liveHandles: () => [], release: () => {} },
					dispose: () => {
						earlyRuntimeDisposals += 1;
						throw earlyRuntimeError;
					},
				});
				expect(await earlyCleanupReported).toBe(earlyRuntimeError);
				cancelEarly();
				await flushTasks();
				expect({ earlyCreateCalls, earlyRuntimeDisposals }).toEqual({
					earlyCreateCalls: 0,
					earlyRuntimeDisposals: 1,
				});
				expect(earlyController.currentForHost(earlyHost)).toBeNull();

				const creationError = new Error("active creation rejected");
				const activeRuntimeError = new Error("active runtime dispose threw");
				let activeRuntimeDisposals = 0;
				const activeSnapshots: Array<{ error: Error | null }> = [];
				const activeController = createEditorSessionHostController({
					prepareRuntime: async () => ({
						runtimeGraphics: {
							selectedBackend: () => "webgpu",
							concurrentCompositorInstances: () => 2,
						},
						runtimeGpu: { liveHandles: () => [], release: () => {} },
						dispose: () => {
							activeRuntimeDisposals += 1;
							throw activeRuntimeError;
						},
					}),
					createSession: async () => {
						throw creationError;
					},
					onCleanupError: () => {
						throw new Error("active failure must publish through the snapshot");
					},
					onChange: (snapshot) => {
						if (snapshot) activeSnapshots.push(snapshot);
					},
				});
				const activeHost = createInMemoryHost({ projectId: "active-failure" });
				activeController.begin(activeHost);
				await flushTasks();
				const activeError = activeController.currentForHost(activeHost)?.error;
				expect(activeError).toBeInstanceOf(AggregateError);
				expect(aggregateErrors(activeError)).toEqual([
					creationError,
					activeRuntimeError,
				]);
				expect(activeSnapshots.at(-1)?.error).toBe(activeError);
				expect(activeRuntimeDisposals).toBe(1);

				await flushTasks();
				expect(unhandled).toEqual([]);
			} finally {
				process.off("unhandledRejection", onUnhandled);
			}
		});

		test("a failed GPU teardown keeps both query wrappers live for retry", async () => {
			const freeBefore = wasmTestControl.runtimeWrapperFreeCalls();
			const disposeGpuBefore = wasmTestControl.disposeGpuCalls();
			const teardownError = new Error("GPU teardown failed");
			wasmTestControl.queueDisposeGpuError(teardownError);
			const runtime = await prepareWasmRuntimeProviders();

			await expect(runtime.dispose()).rejects.toBe(teardownError);
			expect(wasmTestControl.runtimeWrapperFreeCalls()).toEqual(freeBefore);
			expect(runtime.runtimeGpu.liveHandles()).toEqual([]);
			await runtime.dispose();
			expect(wasmTestControl.disposeGpuCalls()).toBe(disposeGpuBefore + 2);
			expect(wasmTestControl.runtimeWrapperFreeCalls()).toEqual({
				graphics: freeBefore.graphics + 1,
				gpu: freeBefore.gpu + 1,
			});
		});

		test("a wrapper-free retry skips GPU teardown and already-freed wrappers", async () => {
			const freeBefore = wasmTestControl.runtimeWrapperFreeCalls();
			const disposeGpuBefore = wasmTestControl.disposeGpuCalls();
			const graphicsError = new Error("graphics free failed");
			wasmTestControl.queueRuntimeWrapperFreeErrors({
				graphics: graphicsError,
			});
			const runtime = await prepareWasmRuntimeProviders();

			await expect(runtime.dispose()).rejects.toBe(graphicsError);
			expect(wasmTestControl.runtimeWrapperFreeCalls()).toEqual({
				graphics: freeBefore.graphics + 1,
				gpu: freeBefore.gpu + 1,
			});
			await runtime.dispose();
			expect(wasmTestControl.disposeGpuCalls()).toBe(disposeGpuBefore + 1);
			expect(wasmTestControl.runtimeWrapperFreeCalls()).toEqual({
				graphics: freeBefore.graphics + 2,
				gpu: freeBefore.gpu + 1,
			});
		});

		test("a wrapper constructor failure rolls back without acquiring an owner", async () => {
			const freeBefore = wasmTestControl.runtimeWrapperFreeCalls();
			const constructorBefore =
				wasmTestControl.runtimeWrapperConstructorCalls();
			const disposeGpuBefore = wasmTestControl.disposeGpuCalls();
			const constructorError = new Error("GPU query constructor failed");
			wasmTestControl.queueRuntimeWrapperConstructorErrors({
				gpu: constructorError,
			});

			await expect(prepareWasmRuntimeProviders()).rejects.toBe(
				constructorError,
			);
			expect(wasmTestControl.runtimeWrapperConstructorCalls()).toEqual({
				graphics: constructorBefore.graphics + 1,
				gpu: constructorBefore.gpu + 1,
			});
			expect(wasmTestControl.runtimeWrapperFreeCalls()).toEqual({
				graphics: freeBefore.graphics + 1,
				gpu: freeBefore.gpu,
			});

			const runtime = await prepareWasmRuntimeProviders();
			await runtime.dispose();
			expect(wasmTestControl.disposeGpuCalls()).toBe(disposeGpuBefore + 1);
		});

		test("concurrent owners and repeated dispose calls release one process generation", async () => {
			const freeBefore = wasmTestControl.runtimeWrapperFreeCalls();
			const disposeGpuBefore = wasmTestControl.disposeGpuCalls();
			const ownerA = await prepareWasmRuntimeProviders();
			const ownerB = await prepareWasmRuntimeProviders();

			await ownerA.dispose();
			expect(wasmTestControl.disposeGpuCalls()).toBe(disposeGpuBefore);
			expect(wasmTestControl.runtimeWrapperFreeCalls()).toEqual({
				graphics: freeBefore.graphics + 1,
				gpu: freeBefore.gpu + 1,
			});
			await Promise.all([ownerB.dispose(), ownerB.dispose()]);
			expect(wasmTestControl.disposeGpuCalls()).toBe(disposeGpuBefore + 1);
			expect(wasmTestControl.runtimeWrapperFreeCalls()).toEqual({
				graphics: freeBefore.graphics + 2,
				gpu: freeBefore.gpu + 2,
			});
		});

		test("a successful teardown permits a fresh independently disposed generation", async () => {
			const disposeGpuBefore = wasmTestControl.disposeGpuCalls();
			const first = await prepareWasmRuntimeProviders();
			expect(first.runtimeGraphics.selectedBackend()).toBe("webgpu");
			await first.dispose();

			const second = await prepareWasmRuntimeProviders();
			expect(second.runtimeGraphics.selectedBackend()).toBe("webgpu");
			await second.dispose();
			expect(wasmTestControl.disposeGpuCalls()).toBe(disposeGpuBefore + 2);
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
