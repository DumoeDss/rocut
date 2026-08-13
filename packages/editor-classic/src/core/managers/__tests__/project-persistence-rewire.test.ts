/* eslint-disable @typescript-eslint/no-unsafe-type-assertion -- The isolated focused test builds branded media time and a deliberately partial EditorCore harness. */
import { expect, test } from "bun:test";
import { fileURLToPath } from "node:url";
import type { EditorCore as EditorCoreType } from "../..";
import type { TProject } from "../../../project/types";
import type { MediaTime } from "../../../wasm";

if (process.env.OPENCUT_PROJECT_PERSISTENCE_TEST_ISOLATED !== "1") {
	test("project persistence rewiring runs with the wasm test double", () => {
		const result = Bun.spawnSync({
			cmd: [process.execPath, "test", fileURLToPath(import.meta.url)],
			cwd: process.cwd(),
			env: {
				...process.env,
				OPENCUT_PROJECT_PERSISTENCE_TEST_ISOLATED: "1",
			},
			stderr: "pipe",
			stdout: "pipe",
		});
		if (result.exitCode !== 0) {
			throw new Error(
				`isolated project persistence suite failed:\n${result.stdout.toString()}\n${result.stderr.toString()}`,
			);
		}
	});
} else {
	const { wasmTestControl } =
		await import("../../../editor/session/__tests__/wasm-test-mock");
	const { EditorCore } = await import("../..");
	const { ProjectManager } = await import("../project-manager");
	const { SessionPersistenceCoordinator } =
		await import("../../../editor/persistence");
	const { ProjectStoreError } = await import("@opencut/editor-ports");
	const {
		InMemoryProjectStore,
		InMemoryProjectStoreControl,
		InMemoryRuntimeResourceHost,
	} = await import("@opencut/editor-ports/in-memory");
	const { createInMemoryHost } = await import("@opencut/editor-ports/in-memory/host");
	const { createEditorSession } =
		await import("../../../editor/session/create-session");
	const { editorForSession } =
		await import("../../../editor/runtime/session-core-owner");
	const { acquireEffectPreviewService, releaseEffectPreviewService } =
		await import("../../../services/renderer/effect-preview");

	const mediaTime = (value: number) => value as MediaTime;
	function project(id: string): TProject {
		const now = new Date("2026-08-02T00:00:00.000Z");
		return {
			metadata: {
				id,
				name: `Project ${id}`,
				duration: mediaTime(42),
				createdAt: now,
				updatedAt: now,
			},
			scenes: [],
			currentSceneId: "",
			settings: {
				fps: { numerator: 30, denominator: 1 },
				canvasSize: { width: 1920, height: 1080 },
				background: { type: "color", color: "#000000" },
			},
			version: 31,
		};
	}

	test("duplicates raw attachments and project removal cascades only its scope", async () => {
		const store = new InMemoryProjectStore();
		const persistence = new SessionPersistenceCoordinator(store);
		await persistence.saveProject({ project: project("source") });
		await persistence.saveProject({ project: project("other") });
		await store.saveAttachment({
			projectId: "source",
			key: "shared",
			metadata: { providerPrivate: { keep: true } },
			body: new Uint8Array([1, 2, 3]).buffer,
		});
		await store.saveAttachment({
			projectId: "other",
			key: "shared",
			metadata: { owner: "other" },
			body: new Uint8Array([9]).buffer,
		});
		await store.saveLibraryRecord({
			namespace: "saved-sounds",
			key: "library",
			schemaVersion: 1,
			data: { keep: true },
		});
		const editor = {
			persistence,
			reportPersistenceFailure: () => {},
			media: { clearAllAssets: () => {} },
			scenes: { clearScenes: () => {} },
		} as unknown as EditorCoreType;
		const manager = new ProjectManager(editor);
		await manager.loadAllProjects();

		const [duplicateId] = await manager.duplicateProjects({ ids: ["source"] });
		const duplicateAttachment = await store.loadAttachment({
			projectId: duplicateId,
			key: "shared",
		});
		expect(duplicateAttachment).toMatchObject({
			metadata: { providerPrivate: { keep: true } },
		});
		expect([...new Uint8Array(duplicateAttachment!.body)]).toEqual([1, 2, 3]);

		await manager.deleteProjects({ ids: ["source"] });
		expect(await store.load({ id: "source" })).toBeNull();
		expect(
			await store.loadAttachment({ projectId: "source", key: "shared" }),
		).toBeNull();
		expect(await store.load({ id: duplicateId })).not.toBeNull();
		expect(
			await store.loadAttachment({ projectId: "other", key: "shared" }),
		).toMatchObject({ metadata: { owner: "other" } });
		expect(
			await store.loadLibraryRecord({
				namespace: "saved-sounds",
				key: "library",
			}),
		).toMatchObject({ data: { keep: true } });
	});

	test("create failure is reported and does not publish transient project state", async () => {
		const control = new InMemoryProjectStoreControl();
		const store = new InMemoryProjectStore({ control });
		const persistence = new SessionPersistenceCoordinator(store);
		const reportedFailures: string[] = [];
		let mediaClearCalls = 0;
		let sceneInitializationCalls = 0;
		const editor = {
			persistence,
			reportPersistenceFailure: ({ operation }: { operation: string }) => {
				reportedFailures.push(operation);
			},
			media: {
				clearAllAssets: () => {
					mediaClearCalls += 1;
				},
			},
			scenes: {
				initializeScenes: () => {
					sceneInitializationCalls += 1;
				},
			},
		} as unknown as EditorCoreType;
		const manager = new ProjectManager(editor);
		control.failNext({ operation: "save-project", code: "unavailable" });

		await expect(manager.createNewProject({ name: "Unsaved" })).rejects.toThrow(
			"unavailable",
		);

		expect(manager.getActiveOrNull()).toBeNull();
		expect(manager.getSavedProjects()).toEqual([]);
		expect(mediaClearCalls).toBe(0);
		expect(sceneInitializationCalls).toBe(0);
		expect(reportedFailures).toEqual(["create-project"]);
	});

	test("duplicate failure waits for late saves and removes every fulfilled duplicate", async () => {
		const control = new InMemoryProjectStoreControl();
		const store = new InMemoryProjectStore({ control });
		const persistence = new SessionPersistenceCoordinator(store);
		await persistence.saveProject({ project: project("source-a") });
		await persistence.saveProject({ project: project("source-b") });
		const reportedFailures: string[] = [];
		const editor = {
			persistence,
			reportPersistenceFailure: ({ operation }: { operation: string }) => {
				reportedFailures.push(operation);
			},
			media: { clearAllAssets: () => {} },
			scenes: { clearScenes: () => {} },
		} as unknown as EditorCoreType;
		const manager = new ProjectManager(editor);
		await manager.loadAllProjects();

		control.failNext({ operation: "save-project", code: "unavailable" });
		const lateSave = control.pauseNext({ operation: "save-project" });
		const duplication = manager.duplicateProjects({
			ids: ["source-a", "source-b"],
		});
		let settled = false;
		void duplication.then(
			() => {
				settled = true;
			},
			() => {
				settled = true;
			},
		);

		await lateSave.entered;
		await Promise.resolve();
		expect(settled).toBeFalse();
		lateSave.release();
		await expect(duplication).rejects.toThrow("unavailable");

		expect((await store.list()).map((summary) => summary.id).sort()).toEqual([
			"source-a",
			"source-b",
		]);
		expect(reportedFailures).toEqual(["duplicate-projects"]);
	});

	test("loadProject drains the old live generation before publishing replacement state", async () => {
		const oldProject = {
			...project("old"),
			metadata: { ...project("old").metadata, thumbnail: "old-thumbnail" },
		};
		const nextProject = {
			...project("next"),
			metadata: { ...project("next").metadata, thumbnail: "next-thumbnail" },
		};
		const events: string[] = [];
		const oldUrl = { revoked: false };
		const oldLiveState = {
			videoGeneration: "old" as string | null,
			waveformGeneration: "old" as string | null,
			previewGeneration: "old" as string | null,
			transcriptionGeneration: "old" as string | null,
		};
		let releasePendingDrain = () => {};
		let drainEntered = false;
		let durableDeleteCalls = 0;
		const editorHarness = {
			persistence: {
				loadProject: async ({ id }: { id: string }) =>
					id === "next" ? nextProject : oldProject,
				removeProject: async () => {
					durableDeleteCalls += 1;
				},
			},
			reportPersistenceFailure: () => {},
			save: {
				pause: () => events.push("save:pause"),
				resume: () => events.push("save:resume"),
			},
			drainProjectLiveState: async () => {},
			playback: {
				pause: () => events.push("playback:pause"),
			},
			audio: {
				suspend: () => events.push("audio:suspend"),
			},
			media: {
				clearAllAssets: async () => {
					drainEntered = true;
					events.push("drain:invalidate");
					oldLiveState.videoGeneration = null;
					oldLiveState.waveformGeneration = null;
					await new Promise<void>((resolve) => {
						releasePendingDrain = resolve;
					});
					oldUrl.revoked = true;
					events.push("cache:joined");
				},
				loadProjectMedia: async ({ projectId }: { projectId: string }) => {
					events.push(`media:load:${projectId}`);
				},
			},
			renderer: {
				drainProjectLiveState: () => {
					oldLiveState.previewGeneration = null;
					events.push("preview:invalidated");
				},
			},
			transcription: {
				terminate: () => {
					oldLiveState.transcriptionGeneration = null;
					events.push("transcription:invalidated");
				},
			},
			scenes: {
				clearScenes: () => events.push("scenes:clear"),
				initializeScenes: () => events.push("scenes:initialize"),
			},
		};
		const editor = editorHarness as unknown as EditorCoreType;
		editorHarness.drainProjectLiveState = async () => {
			await EditorCore.prototype.drainProjectLiveState.call(editor);
			events.push("drain:joined");
		};
		const manager = new ProjectManager(editor);
		manager.setActiveProject({ project: oldProject });

		const loading = manager.loadProject({ id: "next" });
		for (let index = 0; index < 12 && !drainEntered; index += 1) {
			await Promise.resolve();
		}
		const observedDrain = drainEntered;
		const loadedBeforeDrainSettled = events.includes("media:load:next");
		const allGenerationsInvalidatedBeforeJoin = Object.values(
			oldLiveState,
		).every((generation) => generation === null);
		releasePendingDrain();
		await loading;

		expect(observedDrain).toBe(true);
		expect(loadedBeforeDrainSettled).toBe(false);
		expect(allGenerationsInvalidatedBeforeJoin).toBe(true);
		expect(events.indexOf("drain:invalidate")).toBeLessThan(
			events.indexOf("drain:joined"),
		);
		expect(events.indexOf("drain:joined")).toBeLessThan(
			events.indexOf("media:load:next"),
		);
		expect(oldLiveState).toEqual({
			videoGeneration: null,
			waveformGeneration: null,
			previewGeneration: null,
			transcriptionGeneration: null,
		});
		expect(oldUrl.revoked).toBe(true);
		expect(manager.getActive().metadata.id).toBe("next");
		expect(durableDeleteCalls).toBe(0);
	});

	test("loadProject joins every real live owner before publishing durable replacement state", async () => {
		class ControlledRuntimeResources extends InMemoryRuntimeResourceHost {
			readonly trackedObjectUrls: Array<{
				url: string;
				revokeCalls: number;
			}> = [];
			readonly trackedAudioContexts: Array<{ closeCalls: number }> = [];
			private markDecodeEntered!: () => void;
			readonly decodeEntered = new Promise<void>((resolve) => {
				this.markDecodeEntered = resolve;
			});
			private resolveDecode!: (buffer: AudioBuffer) => void;
			private readonly decodeResult = new Promise<AudioBuffer>((resolve) => {
				this.resolveDecode = resolve;
			});

			releaseDecode(): void {
				const samples = Float32Array.from([0.1, -0.2, 0.3, -0.4]);
				this.resolveDecode({
					numberOfChannels: 1,
					length: samples.length,
					sampleRate: 48_000,
					getChannelData: () => samples,
				} as unknown as AudioBuffer);
			}

			override createAudioContext({
				request,
			}: {
				request: { sampleRate?: number };
			}) {
				const entry = { closeCalls: 0 };
				this.trackedAudioContexts.push(entry);
				const context = {
					decodeAudioData: async () => {
						this.markDecodeEntered();
						return this.decodeResult;
					},
				} as unknown as AudioContext;
				return {
					resourceId: `controlled-audio:${this.trackedAudioContexts.length}`,
					sampleRate: request.sampleRate ?? 48_000,
					get state() {
						return entry.closeCalls === 0
							? ("running" as const)
							: ("closed" as const);
					},
					context,
					close: async () => {
						entry.closeCalls += 1;
					},
				};
			}

			override createObjectUrl({ blob }: { blob: Blob }) {
				const entry = {
					url: `controlled:blob/${this.trackedObjectUrls.length + 1}/${blob.size}`,
					revokeCalls: 0,
				};
				this.trackedObjectUrls.push(entry);
				return {
					resourceId: `controlled-object-url:${this.trackedObjectUrls.length}`,
					url: entry.url,
					revoke: () => {
						entry.revokeCalls += 1;
					},
				};
			}
		}

		const windowDescriptor = Object.getOwnPropertyDescriptor(
			globalThis,
			"window",
		);
		const imageDescriptor = Object.getOwnPropertyDescriptor(
			globalThis,
			"Image",
		);
		const images: Array<{
			onload: (() => void) | null;
			onerror: (() => void) | null;
			src: string;
			complete: boolean;
			naturalWidth: number;
		}> = [];
		class ControlledImage {
			onload: (() => void) | null = null;
			onerror: (() => void) | null = null;
			src = "";
			complete = false;
			naturalWidth = 0;

			constructor() {
				images.push(this);
			}
		}
		Object.defineProperty(globalThis, "window", {
			configurable: true,
			value: globalThis,
		});
		Object.defineProperty(globalThis, "Image", {
			configurable: true,
			value: ControlledImage,
		});

		const store = new InMemoryProjectStore();
		const runtimeResources = new ControlledRuntimeResources();
		const session = await createEditorSession({
			host: {
				...createInMemoryHost({ projectId: "old", store }),
				runtimeResources,
			},
		});
		const editor = editorForSession(session);
		const oldProject = {
			...project("old"),
			metadata: { ...project("old").metadata, thumbnail: "old-thumbnail" },
		};
		const nextProject = {
			...project("next"),
			metadata: { ...project("next").metadata, thumbnail: "next-thumbnail" },
		};
		const metadata = ({ id }: { id: string }) => ({
			id,
			name: `${id}.webm`,
			type: "video" as const,
			mimeType: "video/webm",
			lastModified: 1,
		});
		let releasePreviewOwner: (() => void) | null = null;

		try {
			await editor.persistence.saveProject({ project: oldProject });
			await editor.persistence.saveProject({ project: nextProject });
			await store.saveAttachment({
				projectId: "old",
				key: "old-media",
				metadata: metadata({ id: "old-media" }),
				body: new Uint8Array([1, 2, 3]).buffer,
			});
			await store.saveAttachment({
				projectId: "next",
				key: "next-media",
				metadata: metadata({ id: "next-media" }),
				body: new Uint8Array([4, 5, 6]).buffer,
			});

			editor.project.setActiveProject({ project: oldProject });
			await editor.media.loadProjectMedia({ projectId: "old" });
			expect(editor.media.getAssets().map((asset) => asset.id)).toEqual([
				"old-media",
			]);
			const oldUrl = runtimeResources.trackedObjectUrls[0];
			expect(oldUrl.revokeCalls).toBe(0);

			const heldTrack = wasmTestControl.holdNextPrimaryVideoTrack();
			const videoWork = editor.media.getVideoCache().getFrameAt({
				mediaId: "old-media",
				file: new File(["old-video"], "old.webm", { type: "video/webm" }),
				time: 0,
			});
			const waveformWork = editor.media
				.getWaveformCache()
				.getSourceSummary({
					sourceKey: "media:old-media",
					sourceFile: new File(["old-audio"], "old.wav", {
						type: "audio/wav",
					}),
				})
				.then(
					() => null,
					(error: unknown) => error,
				);
			const transcriptionWork = editor.transcription
				.transcribe({ audioData: new Float32Array([0.25]) })
				.then(
					() => null,
					(error: unknown) => error,
				);

			const previewService = acquireEffectPreviewService({
				resolver: editor.renderer.assetResolver,
			});
			releasePreviewOwner = () =>
				releaseEffectPreviewService({
					resolver: editor.renderer.assetResolver,
				});
			let readyCalls = 0;
			const unsubscribePreview = previewService.onPreviewImageReady({
				callback: () => {
					readyCalls += 1;
				},
			});
			const staleImageOnload = images[0]?.onload;
			expect(staleImageOnload).toBeFunction();

			await Promise.all([heldTrack.entered, runtimeResources.decodeEntered]);
			for (
				let attempt = 0;
				attempt < 20 && runtimeResources.workers.length === 0;
				attempt += 1
			) {
				await Promise.resolve();
			}
			const oldWorker = runtimeResources.workers[0];
			expect(oldWorker).toBeDefined();

			const loading = editor.project.loadProject({ id: "next" });
			for (
				let attempt = 0;
				attempt < 20 && (images.length < 2 || !oldWorker.isTerminated);
				attempt += 1
			) {
				await Promise.resolve();
			}

			// Replacement cannot publish while either old cache still owns work.
			expect(editor.project.getActive().metadata.id).toBe("old");
			expect(editor.media.getAssets().map((asset) => asset.id)).toEqual([
				"old-media",
			]);
			expect(oldUrl.revokeCalls).toBe(0);
			expect(oldWorker.isTerminated).toBe(true);
			expect(images).toHaveLength(2);
			staleImageOnload?.();
			expect(readyCalls).toBe(0);

			heldTrack.release();
			runtimeResources.releaseDecode();
			await loading;

			expect(await videoWork).toBeNull();
			expect(await waveformWork).toBeInstanceOf(Error);
			expect(((await waveformWork) as Error).message).toContain("invalidated");
			expect(await transcriptionWork).toBeInstanceOf(Error);
			expect(((await transcriptionWork) as Error).message).toContain(
				"terminated",
			);
			expect(editor.media.getVideoCache().getStats()).toEqual({
				totalSinks: 0,
				activeSinks: 0,
				cachedFrames: 0,
			});
			expect(wasmTestControl.mediaInputs().at(-1)?.disposeCalls).toBe(1);
			expect(runtimeResources.trackedAudioContexts).toEqual([
				{ closeCalls: 1 },
			]);
			expect(oldUrl.revokeCalls).toBe(1);
			expect(editor.project.getActive().metadata.id).toBe("next");
			expect(editor.media.getAssets().map((asset) => asset.id)).toEqual([
				"next-media",
			]);
			expect(
				await store.loadAttachment({ projectId: "old", key: "old-media" }),
			).not.toBeNull();
			expect(
				await store.loadAttachment({ projectId: "next", key: "next-media" }),
			).not.toBeNull();

			images[1].complete = true;
			images[1].naturalWidth = 160;
			images[1].onload?.();
			expect(readyCalls).toBe(1);
			unsubscribePreview();
		} finally {
			releasePreviewOwner?.();
			await session.dispose();
			if (windowDescriptor) {
				Object.defineProperty(globalThis, "window", windowDescriptor);
			} else {
				Reflect.deleteProperty(globalThis, "window");
			}
			if (imageDescriptor) {
				Object.defineProperty(globalThis, "Image", imageDescriptor);
			} else {
				Reflect.deleteProperty(globalThis, "Image");
			}
		}

		expect(runtimeResources.trackedObjectUrls[0].revokeCalls).toBe(1);
	});

	test("session diagnostics expose stable failure identity without raw payload", () => {
		const rawSentinel = "provider-private-payload-must-not-leak";
		const logs: unknown[] = [];
		const editor = {
			sessionDiagnostics: {
				log: ({ record }: { record: unknown }) => logs.push(record),
			},
		} as unknown as EditorCoreType;
		const error = new ProjectStoreError({
			code: "unavailable",
			operation: "save-project",
			scope: { kind: "project", projectId: rawSentinel },
			message: rawSentinel,
		});

		EditorCore.prototype.reportPersistenceFailure.call(editor, {
			operation: "save-project",
			error,
		});

		expect(logs).toEqual([
			{
				level: "error",
				message: "Durable editor operation failed",
				context: { operation: "save-project", code: "unavailable" },
			},
		]);
		expect(JSON.stringify(logs)).not.toContain(rawSentinel);
	});
}
