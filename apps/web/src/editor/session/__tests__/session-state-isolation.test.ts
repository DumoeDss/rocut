/* eslint-disable @typescript-eslint/no-unsafe-type-assertion -- isolation fixtures intentionally inspect private ownership seams and construct minimal Web Audio/runtime doubles. */
import { describe, expect, test } from "bun:test";
import { fileURLToPath } from "node:url";

if (process.env.OPENCUT_SESSION_STATE_TEST_ISOLATED !== "1") {
	test("session-state isolation suite runs in an isolated wasm-mock process", () => {
		const result = Bun.spawnSync({
			cmd: [process.execPath, "test", fileURLToPath(import.meta.url)],
			cwd: process.cwd(),
			env: {
				...process.env,
				OPENCUT_SESSION_STATE_TEST_ISOLATED: "1",
			},
			stderr: "pipe",
			stdout: "pipe",
		});
		if (result.exitCode !== 0) {
			throw new Error(
				`isolated session-state suite failed:\n${result.stdout.toString()}\n${result.stderr.toString()}`,
			);
		}
	}, 15_000);
} else {
	const persisted = new Map<string, string>([
		[
			"panel-sizes",
			JSON.stringify({
				state: {
					panels: {
						tools: 777,
						preview: 360,
						properties: 320,
						mainContent: 800,
						timeline: 280,
					},
				},
				version: 2,
			}),
		],
		[
			"preview-settings",
			JSON.stringify({
				state: {
					activeGuide: null,
					overlays: { persisted: true },
					gridConfig: { rows: 7, cols: 9 },
				},
				version: 6,
			}),
		],
		[
			"timeline-store",
			JSON.stringify({
				state: { snappingEnabled: true, rippleEditingEnabled: true },
				version: 0,
			}),
		],
		[
			"stickers-settings",
			JSON.stringify({
				state: { selectedCategory: "flags", recentStickers: [] },
				version: 1,
			}),
		],
		[
			"opencut-keybindings",
			JSON.stringify({
				state: { keybindings: {}, isCustomized: true },
				version: 7,
			}),
		],
		[
			"assets-panel",
			JSON.stringify({
				state: {
					mediaViewMode: "list",
					mediaSortBy: "size",
					mediaSortOrder: "desc",
				},
				version: 0,
			}),
		],
	]);
	Object.defineProperty(globalThis, "localStorage", {
		configurable: true,
		value: {
			getItem: (key: string) => persisted.get(key) ?? null,
			setItem: (key: string, value: string) => persisted.set(key, value),
			removeItem: (key: string) => persisted.delete(key),
		},
	});
	Object.defineProperty(globalThis, "window", {
		configurable: true,
		value: globalThis,
	});
	Object.defineProperty(globalThis, "OffscreenCanvas", {
		configurable: true,
		value: class {
			width: number;
			height: number;
			// eslint-disable-next-line opencut/prefer-object-params -- mirrors the platform OffscreenCanvas constructor.
			constructor(width: number, height: number) {
				this.width = width;
				this.height = height;
			}
			getContext() {
				return {
					clearRect() {},
					drawImage() {},
					fillRect() {},
					fillStyle: "",
				};
			}
		},
	});
	Object.defineProperty(globalThis, "document", {
		configurable: true,
		value: {
			getElementsByTagName: () => [{ appendChild() {} }],
			createTextNode: (text: string) => ({ text }),
			createElement: (tagName: string) => {
				if (tagName !== "canvas") {
					return { style: {}, appendChild() {}, setAttribute() {} };
				}
				return {
					width: 0,
					height: 0,
					getContext: () => ({
						clearRect() {},
						drawImage() {},
						fillRect() {},
						fillStyle: "",
					}),
					toBlob: (callback: (blob: Blob) => void) =>
						callback(new Blob(["c3"], { type: "image/png" })),
					toDataURL: () => "data:image/png;base64,YzM=",
				};
			},
		},
	});
	const { wasmTestControl } = await import("./wasm-test-mock");
	const { WasmRuntimeGpuResourceQuery, WasmRuntimeGraphicsQuery } =
		await import("opencut-wasm");
	const { createEditorSession } = await import("../create-session");
	const { createInMemoryHost } = await import("@opencut/editor-ports/in-memory/host");
	const { InMemoryRuntimeResourceHost } =
		await import("@opencut/editor-ports/in-memory");
	const { editorForSession } =
		await import("@/editor/runtime/session-core-owner");
	const {
		assertCompleteEditorSessionStores,
		EDITOR_SESSION_STORE_KEYS,
		storesForSession,
	} = await import("../../runtime/session-stores");
	const { cancelInteraction, registerCanceller } =
		await import("@/editor/cancel-interaction");
	type TestEditor = ReturnType<typeof editorForSession>;
	type TestProject = Parameters<
		TestEditor["project"]["setActiveProject"]
	>[0]["project"];
	type TestScene = Parameters<
		TestEditor["scenes"]["initializeScenes"]
	>[0]["scenes"][number];
	type TestMediaTime = ReturnType<TestEditor["timeline"]["getTotalDuration"]>;
	type TestMediaInput = ReturnType<typeof wasmTestControl.mediaInputs>[number];

	function runtime() {
		return {
			runtimeGraphics: new WasmRuntimeGraphicsQuery(),
			runtimeGpu: new WasmRuntimeGpuResourceQuery(),
		};
	}
	const mediaTime = (value: number) => value as TestMediaTime;

	function errorMessages(error: unknown): string[] {
		if (!(error instanceof Error)) return [];
		const messages = [error.message];
		if (error instanceof AggregateError) {
			for (const nested of error.errors) {
				messages.push(...errorMessages(nested));
			}
		}
		if (error.cause !== undefined) {
			messages.push(...errorMessages(error.cause));
		}
		return messages;
	}

	function seedEmptyProject({
		editor,
		id,
	}: {
		editor: ReturnType<typeof editorForSession>;
		id: string;
	}) {
		const now = new Date("2026-01-01T00:00:00.000Z");
		const scene: TestScene = {
			id: `${id}-scene`,
			name: `${id} scene`,
			isMain: true,
			tracks: {
				overlay: [],
				main: {
					id: `${id}-main`,
					name: "Main",
					type: "video" as const,
					elements: [],
					muted: false,
					hidden: false,
				},
				audio: [],
			},
			bookmarks: [],
			createdAt: now,
			updatedAt: now,
		};
		const project: TestProject = {
			metadata: {
				id,
				name: id,
				duration: mediaTime(4_000),
				createdAt: now,
				updatedAt: now,
			},
			scenes: [scene],
			currentSceneId: scene.id,
			settings: {
				fps: { numerator: 30, denominator: 1 },
				canvasSize: { width: 64, height: 64 },
				background: { type: "color" as const, color: "#123456" },
			},
			version: 31,
		};
		editor.project.setActiveProject({ project });
		(
			editor.project as unknown as {
				isLoading: boolean;
			}
		).isLoading = false;
		editor.scenes.initializeScenes({
			scenes: project.scenes,
			currentSceneId: scene.id,
		});
		editor.timeline.getTotalDuration = () => mediaTime(4_000);
		return { project, scene };
	}

	function createPlaybackAudioContext(): AudioContext {
		const audioParam = (value = 0) =>
			({
				value,
				cancelScheduledValues() {},
				linearRampToValueAtTime() {},
				setValueAtTime() {},
			}) as unknown as AudioParam;
		const destination = {} as AudioDestinationNode;
		const gain = () =>
			({
				gain: audioParam(),
				connect: () => destination,
				disconnect() {},
			}) as unknown as GainNode;
		const compressor = () =>
			({
				threshold: audioParam(),
				knee: audioParam(),
				ratio: audioParam(),
				attack: audioParam(),
				release: audioParam(),
				connect: () => destination,
				disconnect() {},
			}) as unknown as DynamicsCompressorNode;

		return {
			currentTime: 0,
			destination,
			sampleRate: 48_000,
			state: "running",
			createDynamicsCompressor: compressor,
			createGain: gain,
			resume: async () => {},
		} as unknown as AudioContext;
	}

	async function createAudioPlaybackFixture({ id }: { id: string }) {
		const host = createInMemoryHost({ projectId: id });
		const context = createPlaybackAudioContext();
		let contextClosed = false;
		host.runtimeResources.createAudioContext = () => ({
			resourceId: `${id}-audio-context`,
			sampleRate: context.sampleRate,
			get state() {
				return contextClosed ? ("closed" as const) : ("running" as const);
			},
			context,
			close: async () => {
				contextClosed = true;
			},
		});
		const session = await createEditorSession({ host, ...runtime() });
		const editor = editorForSession(session);
		const { scene } = seedEmptyProject({ editor, id });
		const mediaId = `${id}-media`;
		scene.tracks.audio.push({
			id: `${id}-audio-track`,
			name: "Audio",
			type: "audio",
			muted: false,
			elements: [
				{
					id: `${id}-audio-element`,
					name: "Audio",
					type: "audio",
					sourceType: "upload",
					mediaId,
					startTime: mediaTime(0),
					duration: mediaTime(120_000),
					trimStart: mediaTime(0),
					trimEnd: mediaTime(0),
					params: { volume: 1, muted: false },
				},
			],
		});
		editor.media.setAssets({
			assets: [
				{
					id: mediaId,
					name: "audio.wav",
					type: "audio",
					file: new File([Uint8Array.of(1)], "audio.wav", {
						type: "audio/wav",
					}),
					duration: 1,
				},
			],
		});
		return { editor, session };
	}

	async function waitForNextMediaInput({ inputCount }: { inputCount: number }) {
		for (
			let attempt = 0;
			attempt < 32 && wasmTestControl.mediaInputs().length === inputCount;
			attempt += 1
		) {
			await Bun.sleep(1);
		}
		const input = wasmTestControl.mediaInputs()[inputCount];
		if (!input)
			throw new Error("Audio playback did not acquire a media Input.");
		await Bun.sleep(1);
		return input;
	}

	function holdNextMediaInput({ label }: { label: string }) {
		const inputIndex = wasmTestControl.mediaInputs().length;
		const heldTrack = wasmTestControl.holdNextPrimaryAudioTrack();
		return {
			inputCreated: heldTrack.entered.then(() => {
				const input = wasmTestControl.mediaInputs()[inputIndex];
				if (!input) throw new Error(`${label} did not create a media Input.`);
				return input;
			}),
			async release(): Promise<void> {
				heldTrack.release();
				await Promise.resolve();
			},
		};
	}

	function freezePlaybackClock(): () => void {
		const descriptor = Object.getOwnPropertyDescriptor(performance, "now");
		if (!descriptor) {
			throw new Error(
				"The playback clock is not configurable in this fixture.",
			);
		}
		Object.defineProperty(performance, "now", {
			...descriptor,
			value: () => 0,
		});
		return () => Object.defineProperty(performance, "now", descriptor);
	}

	function audioLiveState(editor: TestEditor): {
		inputs: Map<string, TestMediaInput>;
		sinks: Map<string, unknown>;
	} {
		return editor.audio as unknown as {
			inputs: Map<string, TestMediaInput>;
			sinks: Map<string, unknown>;
		};
	}

	describe("AudioManager media Input ownership", () => {
		test("getPrimaryAudioTrack rejection disposes the untransferred Input exactly once", async () => {
			wasmTestControl.queuePrimaryAudioTrackError(
				new Error("primary audio track failed"),
			);
			const inputCount = wasmTestControl.mediaInputs().length;
			const { editor, session } = await createAudioPlaybackFixture({
				id: "audio-track-reject",
			});
			editor.playback.play();
			const input = await waitForNextMediaInput({ inputCount });
			const disposeCallsBeforeSessionDisposal = input.disposeCalls;
			await session.dispose();

			expect(disposeCallsBeforeSessionDisposal).toBe(1);
			expect(input.disposeCalls).toBe(1);
		});

		test("a null primary audio track disposes the untransferred Input exactly once", async () => {
			wasmTestControl.queuePrimaryAudioTrackNull();
			const inputCount = wasmTestControl.mediaInputs().length;
			const { editor, session } = await createAudioPlaybackFixture({
				id: "audio-track-null",
			});
			editor.playback.play();
			const input = await waitForNextMediaInput({ inputCount });
			const disposeCallsBeforeSessionDisposal = input.disposeCalls;
			await session.dispose();

			expect(disposeCallsBeforeSessionDisposal).toBe(1);
			expect(input.disposeCalls).toBe(1);
		});

		test("AudioBufferSink construction failure disposes the untransferred Input exactly once", async () => {
			wasmTestControl.queuePrimaryAudioTrackSuccess();
			wasmTestControl.queueAudioBufferSinkConstructorError(
				new Error("audio sink construction failed"),
			);
			const inputCount = wasmTestControl.mediaInputs().length;
			const { editor, session } = await createAudioPlaybackFixture({
				id: "audio-sink-reject",
			});
			editor.playback.play();
			const input = await waitForNextMediaInput({ inputCount });
			const disposeCallsBeforeSessionDisposal = input.disposeCalls;
			await session.dispose();

			expect(disposeCallsBeforeSessionDisposal).toBe(1);
			expect(input.disposeCalls).toBe(1);
		});

		test("successful sink ownership transfers once and project drain releases its Input once", async () => {
			wasmTestControl.queuePrimaryAudioTrackSuccess();
			const inputCount = wasmTestControl.mediaInputs().length;
			const { editor, session } = await createAudioPlaybackFixture({
				id: "audio-project-drain",
			});
			editor.playback.play();
			const input = await waitForNextMediaInput({ inputCount });

			expect(input.disposeCalls).toBe(0);
			await editor.drainProjectLiveState();
			expect(input.disposeCalls).toBe(1);
			await session.dispose();
			expect(input.disposeCalls).toBe(1);
		});

		test("successful sink ownership transfers once and session disposal releases its Input once", async () => {
			wasmTestControl.queuePrimaryAudioTrackSuccess();
			const inputCount = wasmTestControl.mediaInputs().length;
			const { editor, session } = await createAudioPlaybackFixture({
				id: "audio-session-dispose",
			});
			editor.playback.play();
			const input = await waitForNextMediaInput({ inputCount });

			expect(input.disposeCalls).toBe(0);
			await session.dispose();
			expect(input.disposeCalls).toBe(1);
		});

		test("suspend rejects a held sink completion, resume schedules freshly, and another session stays isolated", async () => {
			const fixtureA = await createAudioPlaybackFixture({
				id: "audio-held-suspend-a",
			});
			const fixtureB = await createAudioPlaybackFixture({
				id: "audio-held-suspend-b",
			});
			const restorePlaybackClock = freezePlaybackClock();
			const staleTrack = holdNextMediaInput({ label: "session A stale track" });
			let isolatedTrack: ReturnType<typeof holdNextMediaInput> | undefined;
			let freshTrack: ReturnType<typeof holdNextMediaInput> | undefined;

			try {
				fixtureA.editor.playback.play();
				const staleInput = await staleTrack.inputCreated;

				isolatedTrack = holdNextMediaInput({
					label: "session B isolated track",
				});
				fixtureB.editor.playback.play();
				const isolatedInput = await isolatedTrack.inputCreated;
				await isolatedTrack.release();
				expect(isolatedInput.disposeCalls).toBe(0);
				expect(
					audioLiveState(fixtureB.editor).inputs.get(
						"audio-held-suspend-b-media",
					),
				).toBe(isolatedInput);
				expect(fixtureB.editor.playback.getIsPlaying()).toBe(true);

				expect(fixtureA.editor.playback.getIsPlaying()).toBe(true);
				await fixtureA.session.suspend();
				expect(fixtureA.editor.playback.getIsPlaying()).toBe(false);
				await staleTrack.release();
				expect(staleInput.disposeCalls).toBe(1);
				expect(audioLiveState(fixtureA.editor).inputs.size).toBe(0);
				expect(audioLiveState(fixtureA.editor).sinks.size).toBe(0);
				expect(isolatedInput.disposeCalls).toBe(0);
				expect(fixtureB.editor.playback.getIsPlaying()).toBe(true);

				freshTrack = holdNextMediaInput({ label: "session A resumed track" });
				await fixtureA.session.resume();
				const freshInput = await freshTrack.inputCreated;
				expect(fixtureA.editor.playback.getIsPlaying()).toBe(true);
				expect(freshInput).not.toBe(staleInput);
				expect(freshInput.disposeCalls).toBe(0);
				await freshTrack.release();
				expect(
					audioLiveState(fixtureA.editor).inputs.get(
						"audio-held-suspend-a-media",
					),
				).toBe(freshInput);
				expect(audioLiveState(fixtureA.editor).sinks.size).toBe(1);

				await fixtureA.session.dispose();
				expect(staleInput.disposeCalls).toBe(1);
				expect(freshInput.disposeCalls).toBe(1);
				expect(audioLiveState(fixtureA.editor).inputs.size).toBe(0);
				expect(audioLiveState(fixtureA.editor).sinks.size).toBe(0);
				expect(isolatedInput.disposeCalls).toBe(0);
				expect(
					audioLiveState(fixtureB.editor).inputs.get(
						"audio-held-suspend-b-media",
					),
				).toBe(isolatedInput);

				await fixtureB.session.dispose();
				expect(isolatedInput.disposeCalls).toBe(1);
				expect(audioLiveState(fixtureB.editor).inputs.size).toBe(0);
				expect(audioLiveState(fixtureB.editor).sinks.size).toBe(0);
			} finally {
				await staleTrack.release();
				await isolatedTrack?.release();
				await freshTrack?.release();
				restorePlaybackClock();
				await Promise.allSettled([
					fixtureA.session.dispose(),
					fixtureB.session.dispose(),
				]);
			}
		});

		test("project replacement rejects a held sink completion without repopulating live audio state", async () => {
			const inputCount = wasmTestControl.mediaInputs().length;
			const heldTrack = wasmTestControl.holdNextPrimaryAudioTrack();
			const { editor, session } = await createAudioPlaybackFixture({
				id: "audio-held-project-replacement",
			});
			editor.playback.play();
			await heldTrack.entered;
			const staleInput = wasmTestControl.mediaInputs()[inputCount];
			if (!staleInput)
				throw new Error("Expected the held project media Input.");

			await editor.drainProjectLiveState();
			heldTrack.release();
			for (
				let attempt = 0;
				attempt < 32 && staleInput.disposeCalls === 0;
				attempt += 1
			) {
				await Bun.sleep(1);
			}
			const liveState = editor.audio as unknown as {
				inputs: Map<string, unknown>;
				sinks: Map<string, unknown>;
			};
			expect(staleInput.disposeCalls).toBe(1);
			expect(liveState.inputs.size).toBe(0);
			expect(liveState.sinks.size).toBe(0);
			await session.dispose();
			expect(staleInput.disposeCalls).toBe(1);
		});

		test("session disposal rejects a held sink completion without orphaning its Input", async () => {
			const inputCount = wasmTestControl.mediaInputs().length;
			const heldTrack = wasmTestControl.holdNextPrimaryAudioTrack();
			const { editor, session } = await createAudioPlaybackFixture({
				id: "audio-held-disposal",
			});
			editor.playback.play();
			await heldTrack.entered;
			const staleInput = wasmTestControl.mediaInputs()[inputCount];
			if (!staleInput)
				throw new Error("Expected the held disposal media Input.");

			await session.dispose();
			heldTrack.release();
			for (
				let attempt = 0;
				attempt < 32 && staleInput.disposeCalls === 0;
				attempt += 1
			) {
				await Bun.sleep(1);
			}
			const liveState = editor.audio as unknown as {
				inputs: Map<string, unknown>;
				sinks: Map<string, unknown>;
			};
			expect(staleInput.disposeCalls).toBe(1);
			expect(liveState.inputs.size).toBe(0);
			expect(liveState.sinks.size).toBe(0);
		});
	});

	test("session disposal drains service owners in order before removing weak owner indexes", async () => {
		const session = await createEditorSession({
			host: createInMemoryHost({ projectId: "service-drain-order" }),
			...runtime(),
		});
		const editor = editorForSession(session);
		const events: string[] = [];
		let markMediaEntered!: () => void;
		const mediaEntered = new Promise<void>((resolve) => {
			markMediaEntered = resolve;
		});
		let releaseMedia!: () => void;
		const mediaGate = new Promise<void>((resolve) => {
			releaseMedia = resolve;
		});

		const saveStop = editor.save.stop.bind(editor.save);
		editor.save.stop = () => {
			events.push("save");
			return saveStop();
		};
		const playbackDispose = editor.playback.dispose.bind(editor.playback);
		editor.playback.dispose = () => {
			events.push("playback");
			return playbackDispose();
		};
		const rendererDispose = editor.renderer.dispose.bind(editor.renderer);
		editor.renderer.dispose = async () => {
			events.push("renderer");
			await rendererDispose();
		};
		const mediaDispose = editor.media.dispose.bind(editor.media);
		editor.media.dispose = async () => {
			events.push("media:start");
			markMediaEntered();
			await mediaGate;
			await mediaDispose();
			events.push("media:end");
		};
		const transcriptionTerminate = editor.transcription.terminate.bind(
			editor.transcription,
		);
		editor.transcription.terminate = () => {
			events.push("transcription");
			return transcriptionTerminate();
		};
		const audioDispose = editor.audio.dispose.bind(editor.audio);
		editor.audio.dispose = async () => {
			events.push("audio");
			await audioDispose();
		};
		const persistenceDestroy = editor.persistence.destroy.bind(
			editor.persistence,
		);
		editor.persistence.destroy = () => {
			events.push("persistence");
			return persistenceDestroy();
		};

		const disposal = session.dispose();
		await mediaEntered;
		expect(events).toEqual(["save", "playback", "renderer", "media:start"]);
		let disposalSettled = false;
		void disposal.finally(() => {
			disposalSettled = true;
		});
		await Promise.resolve();
		expect(disposalSettled).toBe(false);

		releaseMedia();
		await disposal;
		expect(events).toEqual([
			"save",
			"playback",
			"renderer",
			"media:start",
			"media:end",
			"transcription",
			"audio",
			"persistence",
		]);
		expect(() => editorForSession(session)).toThrow(/unknown or disposed/i);
		expect(() => storesForSession(session)).toThrow(/unknown or disposed/i);
	});

	describe("ten-store session ownership", () => {
		test("registries are exhaustive, distinct and symmetrically isolated", async () => {
			const sessionA = await createEditorSession({
				host: createInMemoryHost({ projectId: "state-a" }),
				...runtime(),
			});
			const sessionB = await createEditorSession({
				host: createInMemoryHost({ projectId: "state-b" }),
				...runtime(),
			});
			const a = storesForSession(sessionA);
			const b = storesForSession(sessionB);
			await Promise.all([
				a.panel.persist.rehydrate(),
				b.panel.persist.rehydrate(),
				a.preview.persist.rehydrate(),
				b.preview.persist.rehydrate(),
				a.timeline.persist.rehydrate(),
				b.timeline.persist.rehydrate(),
				a.stickers.persist.rehydrate(),
				b.stickers.persist.rehydrate(),
				a.keybindings.persist.rehydrate(),
				b.keybindings.persist.rehydrate(),
				a.assetsPanel.persist.rehydrate(),
				b.assetsPanel.persist.rehydrate(),
			]);
			expect(a.panel.getState().panels.tools).toBe(777);
			expect(b.panel.getState().panels.tools).toBe(777);
			expect(a.preview.getState().overlays).toEqual({ persisted: true });
			expect(a.preview.getState().gridConfig).toEqual({ rows: 7, cols: 9 });
			expect(a.timeline.getState().rippleEditingEnabled).toBe(true);
			expect(a.stickers.getState().selectedCategory).toBe("flags");
			expect(a.keybindings.getState().isCustomized).toBe(true);
			expect(a.keybindings.getState().keybindings).toBeInstanceOf(Map);
			expect(a.assetsPanel.getState()).toMatchObject({
				mediaViewMode: "list",
				mediaSortBy: "size",
				mediaSortOrder: "desc",
			});

			expect(
				Object.keys(a).filter((key) => !key.startsWith("Symbol")),
			).toHaveLength(10);
			expect(EDITOR_SESSION_STORE_KEYS).toHaveLength(10);
			for (const key of EDITOR_SESSION_STORE_KEYS) {
				expect(a[key]).not.toBe(b[key]);
				expect(a[key].getState()).not.toBe(b[key].getState());
			}
			expect(a.panel.getState().panels).not.toBe(b.panel.getState().panels);
			expect(a.preview.getState().overlays).not.toBe(
				b.preview.getState().overlays,
			);
			expect(a.preview.getState().gridConfig).not.toBe(
				b.preview.getState().gridConfig,
			);
			expect(a.editor.getState().canvasPresets).not.toBe(
				b.editor.getState().canvasPresets,
			);
			for (const [index, preset] of a.editor
				.getState()
				.canvasPresets.entries()) {
				expect(preset).not.toBe(b.editor.getState().canvasPresets[index]);
			}
			expect(a.timeline.getState().expandedElementIds).not.toBe(
				b.timeline.getState().expandedElementIds,
			);

			const aNotifications = {
				panel: 0,
				preview: 0,
				timeline: 0,
				stickers: 0,
				keybindings: 0,
				assetsPanel: 0,
			};
			const bNotifications = { ...aNotifications };
			const unsubs = [
				a.panel.subscribe(() => aNotifications.panel++),
				b.panel.subscribe(() => bNotifications.panel++),
				a.preview.subscribe(() => aNotifications.preview++),
				b.preview.subscribe(() => bNotifications.preview++),
				a.timeline.subscribe(() => aNotifications.timeline++),
				b.timeline.subscribe(() => bNotifications.timeline++),
				a.stickers.subscribe(() => aNotifications.stickers++),
				b.stickers.subscribe(() => bNotifications.stickers++),
				a.keybindings.subscribe(() => aNotifications.keybindings++),
				b.keybindings.subscribe(() => bNotifications.keybindings++),
				a.assetsPanel.subscribe(() => aNotifications.assetsPanel++),
				b.assetsPanel.subscribe(() => bNotifications.assetsPanel++),
			];

			a.panel.setState((state) => ({
				panels: { ...state.panels, tools: 111 },
			}));
			a.editor.setState({ isInitializing: false });
			a.preview.setState({
				overlays: { persisted: true, grid: true },
				gridConfig: { rows: 11, cols: 9 },
			});
			a.timeline.setState({ snappingEnabled: false });
			a.timeline.getState().toggleElementExpanded("a-only");
			a.editor.getState().canvasPresets[0].width = 17;
			a.sounds.setState({ searchQuery: "alpha" });
			a.stickers.setState({ searchQuery: "alpha", selectedCategory: "shapes" });
			a.keybindings.setState({ overlayDepth: 3, isCustomized: false });
			a.properties.setState({ isTransformScaleLocked: true });
			a.assetsPanel.setState({ activeTab: "sounds", mediaViewMode: "grid" });

			expect(b.panel.getState().panels.tools).not.toBe(111);
			expect(b.editor.getState().isInitializing).toBe(true);
			expect(b.preview.getState().overlays).toEqual({ persisted: true });
			expect(b.preview.getState().gridConfig).toEqual({ rows: 7, cols: 9 });
			expect(b.timeline.getState()).toMatchObject({
				snappingEnabled: true,
				rippleEditingEnabled: true,
			});
			expect(b.timeline.getState().expandedElementIds.has("a-only")).toBe(
				false,
			);
			expect(b.editor.getState().canvasPresets[0].width).toBe(1920);
			expect(b.sounds.getState().searchQuery).toBe("");
			expect(b.stickers.getState().searchQuery).toBe("");
			expect(b.stickers.getState().selectedCategory).toBe("flags");
			expect(b.keybindings.getState().overlayDepth).toBe(0);
			expect(b.keybindings.getState().isCustomized).toBe(true);
			expect(b.properties.getState().isTransformScaleLocked).toBe(false);
			expect(b.assetsPanel.getState().activeTab).toBe("media");
			expect(b.assetsPanel.getState().mediaViewMode).toBe("list");
			expect(aNotifications).toEqual({
				panel: 1,
				preview: 1,
				timeline: 2,
				stickers: 1,
				keybindings: 1,
				assetsPanel: 1,
			});
			expect(bNotifications).toEqual({
				panel: 0,
				preview: 0,
				timeline: 0,
				stickers: 0,
				keybindings: 0,
				assetsPanel: 0,
			});

			b.panel.setState((state) => ({
				panels: { ...state.panels, tools: 222 },
			}));
			b.editor.setState({ isPanelsReady: true });
			b.preview.setState({
				overlays: { persisted: true, safeArea: true },
				gridConfig: { rows: 3, cols: 4 },
			});
			b.timeline.setState({
				snappingEnabled: true,
				rippleEditingEnabled: false,
			});
			b.timeline.getState().toggleElementExpanded("b-only");
			b.sounds.setState({ searchQuery: "beta" });
			b.stickers.setState({ searchQuery: "beta", selectedCategory: "all" });
			b.keybindings.setState({ overlayDepth: 5, isCustomized: true });
			b.properties.setState({ activeTabPerType: { text: "animation" } });
			b.assetsPanel.setState({
				activeTab: "effects",
				mediaViewMode: "list",
				mediaSortBy: "name",
				mediaSortOrder: "asc",
			});

			expect(a.panel.getState().panels.tools).toBe(111);
			expect(a.editor.getState()).toMatchObject({
				isInitializing: false,
				isPanelsReady: false,
			});
			expect(a.preview.getState()).toMatchObject({
				overlays: { persisted: true, grid: true },
				gridConfig: { rows: 11, cols: 9 },
			});
			expect(a.timeline.getState()).toMatchObject({
				snappingEnabled: false,
				rippleEditingEnabled: true,
			});
			expect(a.timeline.getState().expandedElementIds).toEqual(
				new Set(["a-only"]),
			);
			expect(a.sounds.getState().searchQuery).toBe("alpha");
			expect(a.stickers.getState()).toMatchObject({
				searchQuery: "alpha",
				selectedCategory: "shapes",
			});
			expect(a.keybindings.getState()).toMatchObject({
				overlayDepth: 3,
				isCustomized: false,
			});
			expect(a.properties.getState()).toMatchObject({
				activeTabPerType: {},
				isTransformScaleLocked: true,
			});
			expect(a.assetsPanel.getState()).toMatchObject({
				activeTab: "sounds",
				mediaViewMode: "grid",
				mediaSortBy: "size",
				mediaSortOrder: "desc",
			});
			expect(aNotifications).toEqual({
				panel: 1,
				preview: 1,
				timeline: 2,
				stickers: 1,
				keybindings: 1,
				assetsPanel: 1,
			});
			expect(bNotifications).toEqual({
				panel: 1,
				preview: 1,
				timeline: 2,
				stickers: 1,
				keybindings: 1,
				assetsPanel: 1,
			});
			for (const unsubscribe of unsubs) unsubscribe();

			await sessionA.dispose();
			expect(() => storesForSession(sessionA)).toThrow(/unknown or disposed/i);
			expect(storesForSession(sessionB)).toBe(b);
			const sessionC = await createEditorSession({
				host: createInMemoryHost({ projectId: "state-c" }),
				...runtime(),
			});
			const c = storesForSession(sessionC);
			await Promise.all([
				c.panel.persist.rehydrate(),
				c.preview.persist.rehydrate(),
				c.timeline.persist.rehydrate(),
				c.stickers.persist.rehydrate(),
				c.keybindings.persist.rehydrate(),
				c.assetsPanel.persist.rehydrate(),
			]);
			expect(c.panel).not.toBe(a.panel);
			expect(c.panel).not.toBe(b.panel);
			expect(c.panel.getState().panels.tools).toBe(222);
			expect(c.preview.getState()).toMatchObject({
				overlays: { persisted: true, safeArea: true },
				gridConfig: { rows: 3, cols: 4 },
			});
			expect(c.timeline.getState()).toMatchObject({
				snappingEnabled: true,
				rippleEditingEnabled: false,
			});
			expect(c.stickers.getState().selectedCategory).toBe("all");
			expect(c.keybindings.getState().isCustomized).toBe(true);
			expect(c.assetsPanel.getState()).toMatchObject({
				mediaViewMode: "list",
				mediaSortBy: "name",
				mediaSortOrder: "asc",
			});
			await sessionC.dispose();
			await sessionB.dispose();
		});

		test("incomplete and duplicate registries fail loudly", () => {
			expect(() => assertCompleteEditorSessionStores({})).toThrow(
				/ten distinct stores/i,
			);
			const fake = { getState: () => ({}) };
			const duplicate = Object.fromEntries(
				EDITOR_SESSION_STORE_KEYS.map((key) => [key, fake]),
			);
			expect(() =>
				assertCompleteEditorSessionStores(
					duplicate as Parameters<typeof assertCompleteEditorSessionStores>[0],
				),
			).toThrow(/distinct: 1\/10/i);
		});
	});

	describe("session interaction and compositor ownership", () => {
		test("two editor cores edit, undo, save, suspend, and dispose independently", async () => {
			const { RootNode } = await import("@/services/renderer/nodes/root-node");
			const runtimeA = runtime();
			const runtimeB = runtime();
			const sessionA = await createEditorSession({
				host: createInMemoryHost({ projectId: "core-a" }),
				...runtimeA,
			});
			const sessionB = await createEditorSession({
				host: createInMemoryHost({ projectId: "core-b" }),
				...runtimeB,
			});
			const editorA = editorForSession(sessionA);
			const editorB = editorForSession(sessionB);
			expect(runtimeA.runtimeGraphics).not.toBe(runtimeB.runtimeGraphics);
			expect(runtimeA.runtimeGpu).not.toBe(runtimeB.runtimeGpu);
			expect(sessionA.resources).not.toBe(sessionB.resources);
			expect(editorA.diagnostics).not.toBe(editorB.diagnostics);
			expect(storesForSession(sessionA)).not.toBe(storesForSession(sessionB));
			for (const manager of [
				"project",
				"scenes",
				"timeline",
				"selection",
				"playback",
				"command",
				"save",
				"renderer",
			] as const) {
				expect(editorA[manager]).not.toBe(editorB[manager]);
			}

			editorA.save.stop();
			editorB.save.stop();
			seedEmptyProject({ editor: editorA, id: "core-a" });
			seedEmptyProject({ editor: editorB, id: "core-b" });
			expect(editorA.project.getActive()).not.toBe(editorB.project.getActive());
			editorA.save.start();
			editorB.save.start();
			editorA.selection.setSelectedElements({
				elements: [{ trackId: "a-track", elementId: "a-element" }],
			});
			editorA.playback.seek({ time: mediaTime(3_000) });
			expect(editorB.selection.getSelectedElements()).toEqual([]);
			expect(editorB.playback.getCurrentTime()).toBe(mediaTime(0));

			const names = { before: "core-a", after: "core-a edited" };
			const renameA = {
				routingClass: "provider-private" as const,
				execute: ({ editor }: { editor: typeof editorA }) => {
					const active = editor.project.getActive();
					editor.project.setActiveProject({
						project: {
							...active,
							metadata: { ...active.metadata, name: names.after },
						},
					});
					editor.save.markDirty();
				},
				undo: ({ editor }: { editor: typeof editorA }) => {
					const active = editor.project.getActive();
					editor.project.setActiveProject({
						project: {
							...active,
							metadata: { ...active.metadata, name: names.before },
						},
					});
				},
				redo(context: { editor: typeof editorA }) {
					this.execute(context);
				},
			};
			await editorA.command.execute({ command: renameA as never });
			expect(editorA.project.getActive().metadata.name).toBe(names.after);
			expect(editorB.project.getActive().metadata.name).toBe("core-b");
			expect(editorA.command.canUndo()).toBe(true);
			expect(editorB.command.canUndo()).toBe(false);
			await editorA.command.undo();
			expect(editorA.project.getActive().metadata.name).toBe(names.before);
			await editorA.command.redo();
			expect(editorA.project.getActive().metadata.name).toBe(names.after);

			let savesA = 0;
			let savesB = 0;
			editorA.project.saveCurrentProject = async () => {
				savesA += 1;
			};
			editorB.project.saveCurrentProject = async () => {
				savesB += 1;
			};
			await editorA.save.flush();
			expect({ savesA, savesB }).toEqual({ savesA: 1, savesB: 0 });
			expect(editorA.save.getIsDirty()).toBe(false);
			expect(editorB.save.getIsDirty()).toBe(false);

			await sessionA.suspend();
			expect(sessionA.state).toBe("suspended");
			editorB.selection.setSelectedElements({
				elements: [{ trackId: "b-track", elementId: "b-element" }],
			});
			editorB.playback.seek({ time: mediaTime(2_000) });
			editorB.project.setActiveProject({
				project: {
					...editorB.project.getActive(),
					metadata: {
						...editorB.project.getActive().metadata,
						name: "core-b edited",
					},
				},
			});
			const rendererB = editorB.renderer.createCanvasRenderer({
				width: 64,
				height: 64,
				fps: { numerator: 30, denominator: 1 },
			});
			const treeB = new RootNode({ duration: 4_000 });
			await rendererB.render({ node: treeB, time: 2_000 });
			editorB.save.markDirty();
			await editorB.save.flush();
			expect({ savesA, savesB }).toEqual({ savesA: 1, savesB: 1 });
			expect(editorA.selection.getSelectedElements()).toEqual([
				{ trackId: "a-track", elementId: "a-element" },
			]);
			expect(editorA.playback.getCurrentTime()).toBe(mediaTime(3_000));
			await sessionA.resume();
			expect(sessionA.state).toBe("created");

			await sessionA.dispose();
			expect(editorB.project.getActive().metadata.name).toBe("core-b edited");
			expect(editorB.selection.getSelectedElements()).toEqual([
				{ trackId: "b-track", elementId: "b-element" },
			]);
			expect(editorB.playback.getCurrentTime()).toBe(mediaTime(2_000));
			const renameB = {
				routingClass: "provider-private" as const,
				execute: ({ editor }: { editor: typeof editorB }) => {
					const active = editor.project.getActive();
					editor.project.setActiveProject({
						project: {
							...active,
							metadata: { ...active.metadata, name: "core-b commanded" },
						},
					});
				},
				undo: ({ editor }: { editor: typeof editorB }) => {
					const active = editor.project.getActive();
					editor.project.setActiveProject({
						project: {
							...active,
							metadata: { ...active.metadata, name: "core-b edited" },
						},
					});
				},
				redo(context: { editor: typeof editorB }) {
					this.execute(context);
				},
			};
			await editorB.command.execute({ command: renameB as never });
			expect(editorB.project.getActive().metadata.name).toBe(
				"core-b commanded",
			);
			expect(editorA.project.getActive().metadata.name).toBe(names.after);
			await editorB.command.undo();
			expect(editorB.project.getActive().metadata.name).toBe("core-b edited");
			await rendererB.render({ node: treeB, time: 3_000 });
			await editorB.save.flush();
			expect({ savesA, savesB }).toEqual({ savesA: 1, savesB: 2 });
			await sessionB.dispose();
		});

		test("all renderer paths reuse one serialized compositor and stay local across disposal", async () => {
			const { RootNode } = await import("@/services/renderer/nodes/root-node");
			const runtimeA = runtime();
			const runtimeB = runtime();
			const sessionA = await createEditorSession({
				host: createInMemoryHost({ projectId: "render-a" }),
				...runtimeA,
			});
			const sessionB = await createEditorSession({
				host: createInMemoryHost({ projectId: "render-b" }),
				...runtimeB,
			});
			const editorA = editorForSession(sessionA);
			const editorB = editorForSession(sessionB);
			seedEmptyProject({ editor: editorA, id: "render-a" });
			seedEmptyProject({ editor: editorB, id: "render-b" });
			const cancelled: string[] = [];
			registerCanceller({ session: sessionA, fn: () => cancelled.push("a") });
			registerCanceller({ session: sessionB, fn: () => cancelled.push("b") });
			expect(cancelInteraction({ session: sessionA })).toBe(true);
			expect(cancelled).toEqual(["a"]);
			registerCanceller({
				session: sessionA,
				fn: () => cancelled.push("disposed-a"),
			});

			const rendererA = editorA.renderer.createCanvasRenderer({
				width: 64,
				height: 64,
				fps: { numerator: 30, denominator: 1 },
			});
			const rendererB = editorB.renderer.createCanvasRenderer({
				width: 64,
				height: 64,
				fps: { numerator: 30, denominator: 1 },
			});
			const secondRendererA = editorA.renderer.createCanvasRenderer({
				width: 32,
				height: 32,
				fps: { numerator: 30, denominator: 1 },
			});
			const treeA = new RootNode({ duration: 4_000 });
			const treeB = new RootNode({ duration: 4_000 });
			editorA.renderer.setRenderTree({ renderTree: treeA });
			editorB.renderer.setRenderTree({ renderTree: treeB });

			const compositorA = (
				rendererA as unknown as {
					compositor: {
						runExclusive<T>(task: () => Promise<T>): Promise<T>;
					};
				}
			).compositor;
			const originalRunExclusive = compositorA.runExclusive.bind(compositorA);
			const serializationEvents: string[] = [];
			const operationStart = wasmTestControl.operations().length;
			let releaseFirst!: () => void;
			const firstGate = new Promise<void>((resolve) => {
				releaseFirst = resolve;
			});
			let call = 0;
			compositorA.runExclusive = <T>(task: () => Promise<T>) => {
				const current = ++call;
				return originalRunExclusive(async () => {
					serializationEvents.push(`${current}:start`);
					if (current === 1) await firstGate;
					const result = await task();
					serializationEvents.push(`${current}:end`);
					return result;
				});
			};
			const firstRender = rendererA.renderToCanvas({
				node: treeA,
				time: 0,
				targetCanvas: {
					width: 64,
					height: 64,
					getContext: () => ({
						drawImage: () => serializationEvents.push("1:target-draw"),
					}),
				} as never,
			});
			await Promise.resolve();
			const outputCanvas = secondRendererA.getOutputCanvas();
			const secondRender = secondRendererA.render({ node: treeA, time: 0 });
			await Promise.resolve();
			expect(serializationEvents).toEqual(["1:start"]);
			expect(wasmTestControl.operations().slice(operationStart)).toEqual([]);
			releaseFirst();
			const [, resizedCanvas] = await Promise.all([
				firstRender,
				outputCanvas,
				secondRender,
			]);
			expect(serializationEvents).toEqual([
				"1:start",
				"1:target-draw",
				"1:end",
				"2:start",
				"2:end",
				"3:start",
				"3:end",
			]);
			expect({
				width: resizedCanvas.width,
				height: resizedCanvas.height,
			}).toEqual({ width: 32, height: 32 });
			const serializedOperations = wasmTestControl
				.operations()
				.slice(operationStart);
			expect(serializedOperations.map(({ kind }) => kind)).toEqual([
				"create",
				"render",
				"resize",
				"render",
			]);
			expect(
				serializedOperations.map(({ width, height }) => ({ width, height })),
			).toEqual([
				{ width: 64, height: 64 },
				{ width: 64, height: 64 },
				{ width: 32, height: 32 },
				{ width: 32, height: 32 },
			]);
			await rendererB.render({ node: treeB, time: 0 });
			const handleA = editorA.renderer.getCompositorHandle();
			const handleB = editorB.renderer.getCompositorHandle();
			if (handleA === null || handleB === null) {
				throw new Error(
					"Both sessions must allocate an explicit compositor handle.",
				);
			}
			expect(handleA).toBeGreaterThan(0);
			expect(handleB).toBeGreaterThan(0);
			expect(handleA).not.toBe(handleB);
			expect(editorA.renderer.getCompositorHandle()).toBe(handleA);
			expect(runtimeA.runtimeGpu.liveHandles()).toEqual([handleA, handleB]);

			const snapshot = await (
				editorA.renderer as unknown as {
					createSnapshot(): Promise<{ success: boolean }>;
				}
			).createSnapshot();
			expect(snapshot.success).toBe(true);
			const thumbnailUpdated = await (
				editorA.project as unknown as {
					updateThumbnailFromTimeline(): Promise<boolean>;
				}
			).updateThumbnailFromTimeline();
			expect(thumbnailUpdated).toBe(true);
			expect(editorA.project.getActive().metadata.thumbnail).toBe(
				"data:image/png;base64,YzM=",
			);
			const exportCapture = wasmTestControl.holdNextCanvasCapture();
			const exportOperationStart = wasmTestControl.operations().length;
			const exportPromise = editorA.renderer.exportProject({
				options: {
					format: "mp4",
					quality: "low",
					fps: { numerator: 30, denominator: 1 },
					includeAudio: false,
				},
			});
			await exportCapture.entered;
			const queuedRendererA = editorA.renderer.createCanvasRenderer({
				width: 20,
				height: 12,
				fps: { numerator: 30, denominator: 1 },
			});
			const queuedCanvas = queuedRendererA.getOutputCanvas();
			const queuedPreview = queuedRendererA.render({
				node: treeA,
				time: 1_000,
			});
			await Promise.resolve();
			try {
				const capture = wasmTestControl.canvasCaptures().at(-1);
				expect(capture).toMatchObject({
					handle: handleA,
					width: 64,
					height: 64,
					operationIndex: exportOperationStart + 1,
				});
				expect(capture?.content).toMatch(
					new RegExp(`^handle:${handleA}:frame:\\d+$`),
				);
				expect(
					wasmTestControl
						.operations()
						.slice(exportOperationStart)
						.map(({ kind }) => kind),
				).toEqual(["render", "capture"]);
			} finally {
				exportCapture.release();
			}
			const [exported, resizedAfterCapture] = await Promise.all([
				exportPromise,
				queuedCanvas,
				queuedPreview,
			]);
			expect(exported).toMatchObject({ success: true });
			expect({
				width: resizedAfterCapture.width,
				height: resizedAfterCapture.height,
			}).toEqual({ width: 20, height: 12 });
			expect(
				wasmTestControl
					.operations()
					.slice(exportOperationStart)
					.map(({ kind }) => kind),
			).toEqual(["render", "capture", "resize", "render"]);
			const captureFailure = new Error("capture rejected");
			const failedCapture = queuedRendererA.renderAndCapture({
				node: treeA,
				time: 2_000,
				capture: async (canvas) => {
					expect({ width: canvas.width, height: canvas.height }).toEqual({
						width: 20,
						height: 12,
					});
					throw captureFailure;
				},
			});
			const afterFailedCapture = rendererA.getOutputCanvas();
			await expect(failedCapture).rejects.toBe(captureFailure);
			const restoredCanvas = await afterFailedCapture;
			expect({
				width: restoredCanvas.width,
				height: restoredCanvas.height,
			}).toEqual({ width: 64, height: 64 });
			expect(editorA.renderer.getCompositorHandle()).toBe(handleA);
			expect(wasmTestControl.liveHandles()).toEqual([handleA, handleB]);
			expect(
				wasmTestControl
					.renderCalls()
					.filter((render) => render.handle === handleA).length,
			).toBeGreaterThanOrEqual(5);

			const reportA = await sessionA.dispose();
			expect(reportA.gpuResource).toEqual({ created: 1, released: 1 });
			expect(reportA.gpuReconciliation).toEqual({
				source: "runtime",
				untracked: [],
				leaked: [],
			});
			expect(runtimeB.runtimeGpu.liveHandles()).toEqual([handleB]);
			await expect(rendererA.getOutputCanvas()).rejects.toThrow(/disposed/i);
			await expect(rendererA.render({ node: treeA, time: 0 })).rejects.toThrow(
				/disposed/i,
			);
			await rendererB.render({ node: treeB, time: 0 });
			expect(editorB.renderer.getCompositorHandle()).toBe(handleB);
			expect(cancelInteraction({ session: sessionA })).toBe(false);
			expect(cancelled).toEqual(["a"]);
			expect(cancelInteraction({ session: sessionB })).toBe(true);
			expect(cancelled).toEqual(["a", "b"]);
			await sessionB.dispose();
		});

		test("zero allocation and pre-track failure roll back without consuming capacity", async () => {
			const { WasmCompositor } =
				await import("@/services/renderer/compositor/wasm-compositor");
			wasmTestControl.queueCompositorHandle(0);
			const zero = new WasmCompositor({
				trackGpuResource: () => {
					throw new Error("zero must never reach tracking");
				},
			} as never);
			expect(() => zero.ensureInitialized({ width: 10, height: 10 })).toThrow(
				/reserved handle 0/i,
			);
			expect(wasmTestControl.liveHandles()).not.toContain(0);

			wasmTestControl.queueCompositorHandle(99);
			const rollback = new WasmCompositor({
				trackGpuResource: () => {
					throw new Error("tracking failed");
				},
			} as never);
			expect(() =>
				rollback.ensureInitialized({ width: 10, height: 10 }),
			).toThrow(/tracking failed/i);
			expect(wasmTestControl.liveHandles()).not.toContain(99);
		});

		test("suspend rejects an in-flight real renderer generation and resume renders freshly", async () => {
			const { RootNode } = await import("@/services/renderer/nodes/root-node");
			const ownedRuntime = runtime();
			const session = await createEditorSession({
				host: createInMemoryHost({ projectId: "suspend-render" }),
				...ownedRuntime,
			});
			const editor = editorForSession(session);
			const renderer = editor.renderer.createCanvasRenderer({
				width: 16,
				height: 16,
				fps: { numerator: 30, denominator: 1 },
			});
			const tree = new RootNode({ duration: 4_000 });
			const compositor = (
				renderer as unknown as {
					compositor: {
						runExclusive<T>(task: () => Promise<T>): Promise<T>;
					};
				}
			).compositor;
			const originalRunExclusive = compositor.runExclusive.bind(compositor);
			let releaseFirst!: () => void;
			const firstGate = new Promise<void>((resolve) => {
				releaseFirst = resolve;
			});
			let entered = false;
			let first = true;
			compositor.runExclusive = <T>(task: () => Promise<T>) =>
				originalRunExclusive(async () => {
					if (first) {
						first = false;
						entered = true;
						await firstGate;
					}
					return task();
				});

			const operationStart = wasmTestControl.operations().length;
			const staleRender = renderer.render({ node: tree, time: 0 });
			for (let index = 0; index < 4 && !entered; index += 1) {
				await Promise.resolve();
			}
			expect(entered).toBe(true);
			await session.suspend();
			expect(session.state).toBe("suspended");
			releaseFirst();
			await expect(staleRender).rejects.toThrow(/stale.*suspended/i);
			expect(wasmTestControl.operations().slice(operationStart)).toEqual([]);

			await session.resume();
			expect(session.state).toBe("created");
			await renderer.render({ node: tree, time: 1 });
			expect(
				wasmTestControl
					.operations()
					.slice(operationStart)
					.map(({ kind }) => kind),
			).toEqual(["create", "render"]);
			await session.dispose();
		});

		test("suspend cancels the canonical exporter without stale progress or success", async () => {
			const ownedRuntime = runtime();
			const session = await createEditorSession({
				host: createInMemoryHost({ projectId: "suspend-export" }),
				...ownedRuntime,
			});
			const editor = editorForSession(session);
			seedEmptyProject({ editor, id: "suspend-export" });
			const progress: number[] = [];
			const heldCapture = wasmTestControl.holdNextCanvasCapture();
			const pending = editor.renderer.exportProject({
				options: {
					format: "mp4",
					quality: "low",
					fps: { numerator: 30, denominator: 1 },
					includeAudio: false,
				},
				onProgress: ({ progress: value }) => progress.push(value),
			});

			await heldCapture.entered;
			let suspensionSettled = false;
			const suspension = session.suspend();
			const observedSuspension = suspension.then(
				() => {
					suspensionSettled = true;
				},
				() => {
					suspensionSettled = true;
				},
			);
			for (let index = 0; index < 8; index += 1) {
				await Promise.resolve();
			}
			await Bun.sleep(10);
			expect(suspensionSettled).toBe(false);
			heldCapture.release();
			await observedSuspension;
			await suspension;
			const progressAtSuspend = [...progress];
			const staleResult = await pending;
			expect(staleResult.success).toBe(false);
			expect(progress).toEqual(progressAtSuspend);

			await session.resume();
			const freshResult = await editor.renderer.exportProject({
				options: {
					format: "mp4",
					quality: "low",
					fps: { numerator: 30, denominator: 1 },
					includeAudio: false,
				},
			});
			expect(freshResult.success).toBe(true);
			await session.dispose();
		});

		test("project live-state drain waits for the canonical exporter to settle", async () => {
			const ownedRuntime = runtime();
			const session = await createEditorSession({
				host: createInMemoryHost({ projectId: "project-drain-export" }),
				...ownedRuntime,
			});
			const editor = editorForSession(session);
			seedEmptyProject({ editor, id: "project-drain-export" });
			const heldCapture = wasmTestControl.holdNextCanvasCapture();
			const pendingExport = editor.renderer.exportProject({
				options: {
					format: "mp4",
					quality: "low",
					fps: { numerator: 30, denominator: 1 },
					includeAudio: false,
				},
			});

			await heldCapture.entered;
			let drainSettled = false;
			const drain = editor.drainProjectLiveState();
			const observedDrain = drain.then(
				() => {
					drainSettled = true;
				},
				() => {
					drainSettled = true;
				},
			);
			await Bun.sleep(10);
			expect(drainSettled).toBe(false);
			heldCapture.release();
			await observedDrain;
			await drain;
			expect((await pendingExport).success).toBe(false);
			await session.dispose();
		});

		test("dispose attributes exporter cancellation failure and still drains later owners", async () => {
			const runtimeResources = new InMemoryRuntimeResourceHost();
			const session = await createEditorSession({
				host: {
					...createInMemoryHost({ projectId: "dispose-export-failure" }),
					runtimeResources,
				},
				...runtime(),
			});
			const editor = editorForSession(session);
			seedEmptyProject({ editor, id: "dispose-export-failure" });
			session.resources.createObjectUrl({ blob: new Blob(["owned"]) });
			const heldCapture = wasmTestControl.holdNextCanvasCapture();
			const cancelCallsBefore = wasmTestControl.outputCancelCalls();
			const pendingExport = editor.renderer.exportProject({
				options: {
					format: "mp4",
					quality: "low",
					fps: { numerator: 30, denominator: 1 },
					includeAudio: false,
				},
			});

			await heldCapture.entered;
			const compositorHandle = editor.renderer.getCompositorHandle();
			expect(compositorHandle).not.toBeNull();
			wasmTestControl.queueOutputCancelError(
				new Error("controlled output cancellation failure"),
			);
			let disposalSettled = false;
			const disposal = session.dispose();
			const observedDisposal = disposal.then(
				() => {
					disposalSettled = true;
					return null;
				},
				(error: unknown) => {
					disposalSettled = true;
					return error;
				},
			);
			await Bun.sleep(10);
			expect(disposalSettled).toBe(false);
			heldCapture.release();
			const disposalError = await observedDisposal;
			expect(disposalError).toBeInstanceOf(Error);
			expect(errorMessages(disposalError)).toContain(
				"Renderer exporter 0 failed during terminal drain.",
			);
			expect((await pendingExport).success).toBe(false);
			expect(wasmTestControl.outputCancelCalls() - cancelCallsBefore).toBe(1);
			expect(runtimeResources.objectUrls[0]?.revoked).toBe(true);
			expect(wasmTestControl.liveHandles()).not.toContain(compositorHandle);
			expect(session.dispose()).toBe(disposal);
		});

		test("suspend during delayed snapshot encoding prevents the download publication", async () => {
			const { RootNode } = await import("@/services/renderer/nodes/root-node");
			const ownedRuntime = runtime();
			const session = await createEditorSession({
				host: createInMemoryHost({ projectId: "suspend-snapshot" }),
				...ownedRuntime,
			});
			const editor = editorForSession(session);
			seedEmptyProject({ editor, id: "suspend-snapshot" });
			editor.renderer.setRenderTree({
				renderTree: new RootNode({ duration: 4_000 }),
			});
			const originalCreateElement = document.createElement;
			let markBlobEntered!: () => void;
			const blobEntered = new Promise<void>((resolve) => {
				markBlobEntered = resolve;
			});
			let releaseBlob!: (blob: Blob | null) => void;
			let anchorCreations = 0;
			Object.defineProperty(document, "createElement", {
				configurable: true,
				value: (tagName: string) => {
					if (tagName === "canvas") {
						return {
							width: 0,
							height: 0,
							getContext: () => ({ drawImage() {} }),
							toBlob: (callback: (blob: Blob | null) => void) => {
								releaseBlob = callback;
								markBlobEntered();
							},
						};
					}
					if (tagName === "a") anchorCreations += 1;
					return originalCreateElement.call(document, tagName);
				},
			});

			try {
				const pending = editor.renderer.saveSnapshot();
				await blobEntered;
				await session.suspend();
				releaseBlob(new Blob(["late"], { type: "image/png" }));
				const result = await pending;
				expect(result.success).toBe(false);
				expect(result.error).toMatch(/stale|suspended/i);
				expect(anchorCreations).toBe(0);
				await session.resume();
			} finally {
				Object.defineProperty(document, "createElement", {
					configurable: true,
					value: originalCreateElement,
				});
				await session.dispose();
			}
		});

		test("disposal during the first queued render rejects stale work without touching B", async () => {
			const { RootNode } = await import("@/services/renderer/nodes/root-node");
			const runtimeA = runtime();
			const runtimeB = runtime();
			const sessionA = await createEditorSession({
				host: createInMemoryHost({ projectId: "stale-a" }),
				...runtimeA,
			});
			const sessionB = await createEditorSession({
				host: createInMemoryHost({ projectId: "stale-b" }),
				...runtimeB,
			});
			const rendererA = editorForSession(
				sessionA,
			).renderer.createCanvasRenderer({
				width: 16,
				height: 16,
				fps: { numerator: 30, denominator: 1 },
			});
			const editorB = editorForSession(sessionB);
			const rendererB = editorB.renderer.createCanvasRenderer({
				width: 16,
				height: 16,
				fps: { numerator: 30, denominator: 1 },
			});
			const tree = new RootNode({ duration: 4_000 });
			await rendererB.render({ node: tree, time: 0 });
			const handleB = editorB.renderer.getCompositorHandle();
			if (handleB === null)
				throw new Error("Session B did not allocate a handle.");

			const compositorA = (
				rendererA as unknown as {
					compositor: {
						runExclusive<T>(task: () => Promise<T>): Promise<T>;
					};
				}
			).compositor;
			const originalRunExclusive = compositorA.runExclusive.bind(compositorA);
			let releaseFirst!: () => void;
			const firstGate = new Promise<void>((resolve) => {
				releaseFirst = resolve;
			});
			let entered = false;
			compositorA.runExclusive = <T>(task: () => Promise<T>) =>
				originalRunExclusive(async () => {
					entered = true;
					await firstGate;
					return task();
				});
			const staleRender = rendererA.render({ node: tree, time: 0 });
			for (let index = 0; index < 4 && !entered; index += 1) {
				await Promise.resolve();
			}
			expect(entered).toBe(true);
			const reportA = await sessionA.dispose();
			expect(reportA.gpuResource).toEqual({ created: 0, released: 0 });
			expect(runtimeB.runtimeGpu.liveHandles()).toEqual([handleB]);
			releaseFirst();
			await expect(staleRender).rejects.toThrow(/disposed/i);
			await rendererB.render({ node: tree, time: 1 });
			expect(editorB.renderer.getCompositorHandle()).toBe(handleB);
			await sessionB.dispose();
		});
	});
}
