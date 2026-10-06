import { expect, test } from "bun:test";
import { commandHarness } from "../../core/managers/__tests__/command-test-harness";
import { RenameProjectCommand } from "../../commands/project/rename-project";
import { createEditorTaskRunner } from "../agent-tasks";

test("Agent history uses the real stack, durable undo/redo, revision guard and failure recovery", async () => {
	const h = await commandHarness();
	const runner = createEditorTaskRunner({ editor: h.editor });
	const signal = new AbortController().signal;
	await h.command.execute({
		command: new RenameProjectCommand({
			projectId: h.getProject().metadata.id,
			name: "Agent history",
		}),
	});
	const request = {
		kind: "history.undo" as const,
		expectedRevision: 1,
		idempotencyKey: "undo-1",
	};
	h.fixture.control.failNext({
		operation: "save-project",
		code: "unavailable",
	});
	await expect(runner.run({ request, signal })).rejects.toThrow();
	expect(h.command.canUndo()).toBe(true);
	expect(h.command.canRedo()).toBe(false);
	expect(h.getProject().metadata.name).toBe("Agent history");
	await runner.run({ request, signal });
	expect(h.getProject().metadata.name).toBe("OpenCut routing");
	expect(await h.transactions.revision()).toBe(2);
	await expect(runner.run({ request, signal })).rejects.toThrow(
		"revision-conflict",
	);
	await runner.run({
		request: { ...request, kind: "history.redo", expectedRevision: 2 },
		signal,
	});
	expect(h.getProject().metadata.name).toBe("Agent history");
	expect(await h.transactions.revision()).toBe(3);
});

test("caption import only plans; explicit apply persists text and stale plans conflict", async () => {
	const h = await commandHarness();
	const runner = createEditorTaskRunner({ editor: h.editor });
	const originalDocument = Object.getOwnPropertyDescriptor(
		globalThis,
		"document",
	);
	Object.defineProperty(globalThis, "document", {
		configurable: true,
		value: {
			createElement: () => ({ getContext: () => null }),
		},
	});
	try {
		const request = {
			kind: "captions.import" as const,
			expectedRevision: 0,
			idempotencyKey: "import-1",
			sceneId: "scene-main",
			trackId: "captions",
			fileName: "lyrics.srt",
			input: "1\n00:00:00,125 --> 00:00:01,625\n测试字幕\n",
		};
		const result = await runner.run({
			request,
			signal: new AbortController().signal,
		});
		if (!("batch" in result)) throw new Error("Expected caption plan");
		expect(result.captions).toHaveLength(1);
		expect(result.batch.expectedRevision).toBe(0);
		expect(h.fixture.getSaveCount()).toBe(0);
		expect(await h.transactions.clips()).toHaveLength(0);
		await h.transactions.apply(result.batch);
		const clips = await h.transactions.clips();
		expect(clips[0].editing?.params.content).toBe("测试字幕");
		expect(Number(clips[0].startTime) % 4000).toBe(0);
		expect(h.getScenes()[0].tracks.overlay[0].elements[0].params.content).toBe(
			"测试字幕",
		);
		await expect(
			h.transactions.apply({ ...result.batch, idempotencyKey: "not-a-replay" }),
		).rejects.toThrow();
	} finally {
		if (originalDocument)
			Object.defineProperty(globalThis, "document", originalDocument);
		else Reflect.deleteProperty(globalThis, "document");
	}
});

test("caption tasks refuse wrong scene and pre-cancelled requests without touching the editor", async () => {
	const h = await commandHarness();
	const runner = createEditorTaskRunner({ editor: h.editor });
	const request = {
		kind: "captions.import" as const,
		expectedRevision: 0,
		idempotencyKey: "x",
		sceneId: "missing",
		trackId: "captions",
		fileName: "x.srt",
		input: "",
	};
	await expect(
		runner.run({ request, signal: new AbortController().signal }),
	).rejects.toThrow("scene-conflict");
	const controller = new AbortController();
	controller.abort();
	await expect(
		runner.run({ request, signal: controller.signal }),
	).rejects.toThrow();
	expect(h.fixture.getSaveCount()).toBe(0);
});

test("ASR task uses timeline audio, consent/model/language, and returns an unapplied caption plan", async () => {
	const h = await commandHarness();
	const samples = new Float32Array([0, 0.5, 0]);
	const calls: unknown[] = [];
	const controller = new AbortController();
	Object.assign(h.editor, {
		transcription: {
			transcribe: async (args: unknown) => {
				calls.push(args);
				return {
					text: "Hello world",
					language: "en",
					segments: [{ text: "Hello world", start: 0.125, end: 1.625 }],
				};
			},
		},
	});
	const runner = createEditorTaskRunner({
		editor: h.editor,
		audio: {
			extract: async (args) => {
				expect(args.tracks).toEqual(h.getScenes()[0].tracks);
				return new Blob();
			},
			decode: async ({ sampleRate }) => {
				expect(sampleRate).toBe(16000);
				return { samples, sampleRate: 16000 };
			},
		},
	});
	const descriptor = Object.getOwnPropertyDescriptor(globalThis, "document");
	Object.defineProperty(globalThis, "document", {
		configurable: true,
		value: { createElement: () => ({ getContext: () => null }) },
	});
	try {
		const request = {
			kind: "captions.transcribe" as const,
			expectedRevision: 0,
			idempotencyKey: "asr",
			sceneId: "scene-main",
			trackId: "captions",
			language: "en",
			modelId: "whisper-tiny",
			allowModelDownload: true as const,
		};
		const result = await runner.run({ request, signal: controller.signal });
		if (!("batch" in result)) throw new Error("Expected ASR caption plan");
		expect(calls).toHaveLength(1);
		expect(calls[0]).toMatchObject({
			audioData: samples,
			language: "en",
			modelId: "whisper-tiny",
			signal: controller.signal,
		});
		expect(result.captions[0].text).toBe("Hello world");
		expect(result.batch.expectedRevision).toBe(0);
		expect(h.fixture.getSaveCount()).toBe(0);
		await expect(
			runner.run({
				request: { ...request, modelId: "not-a-model" },
				signal: controller.signal,
			}),
		).rejects.toThrow("unknown-transcription-model");
		expect(calls).toHaveLength(1);
	} finally {
		if (descriptor) Object.defineProperty(globalThis, "document", descriptor);
		else Reflect.deleteProperty(globalThis, "document");
	}
});

test("revision change during audio extraction refuses ASR before model work starts", async () => {
	const h = await commandHarness();
	const runner = createEditorTaskRunner({
		editor: h.editor,
		audio: {
			extract: async () => {
				await h.command.execute({
					command: new RenameProjectCommand({
						projectId: h.getProject().metadata.id,
						name: "Changed while extracting",
					}),
				});
				return new Blob();
			},
			decode: async () => {
				throw new Error("must not decode stale audio");
			},
		},
	});
	await expect(
		runner.run({
			request: {
				kind: "captions.transcribe",
				expectedRevision: 0,
				idempotencyKey: "stale-asr",
				sceneId: "scene-main",
				trackId: "captions",
				allowModelDownload: true,
			},
			signal: new AbortController().signal,
		}),
	).rejects.toThrow("revision-conflict");
	expect(h.fixture.getSaveCount()).toBe(1);
});
