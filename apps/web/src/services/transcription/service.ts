import type { WorkerHandle, WorkerId } from "@/editor/ports";
import type { SessionResources } from "@/editor/session/resources";
import type {
	TranscriptionLanguage,
	TranscriptionModelId,
	TranscriptionProgress,
	TranscriptionResult,
} from "@/transcription/types";
import {
	DEFAULT_TRANSCRIPTION_MODEL,
	TRANSCRIPTION_MODELS,
} from "@/transcription/models";
import type { WorkerMessage, WorkerResponse } from "./worker";

type ProgressCallback = (progress: TranscriptionProgress) => void;
const TRANSCRIPTION_WORKER_ID = "transcription" as WorkerId;

export interface TranscriptionService {
	transcribe(args: {
		audioData: Float32Array;
		language?: TranscriptionLanguage;
		modelId?: TranscriptionModelId;
		onProgress?: ProgressCallback;
	}): Promise<TranscriptionResult>;
	cancel(): void;
	terminate(): void;
}

export function createTranscriptionService({
	resources,
	workerUrl = new URL("./worker.ts", import.meta.url),
}: {
	resources: SessionResources;
	workerUrl?: URL;
}): TranscriptionService {
	let worker: WorkerHandle | null = null;
	let currentModelId: TranscriptionModelId | null = null;
	let initialized = false;
	let initializing: Promise<void> | null = null;
	let rejectInitialization: ((reason: Error) => void) | null = null;

	function terminate(): void {
		const pendingReject = rejectInitialization;
		rejectInitialization = null;
		initializing = null;
		initialized = false;
		currentModelId = null;
		const ownedWorker = worker;
		worker = null;
		ownedWorker?.terminate();
		pendingReject?.(new Error("Transcription Worker was terminated during initialization."));
	}

	async function ensureWorker({
		modelId,
		onProgress,
	}: {
		modelId: TranscriptionModelId;
		onProgress?: ProgressCallback;
	}): Promise<void> {
		if (worker && initialized && currentModelId === modelId) return;
		if (worker && initializing && currentModelId === modelId) {
			await initializing;
			return;
		}

		const model = TRANSCRIPTION_MODELS.find((candidate) => candidate.id === modelId);
		if (!model) throw new Error(`Unknown model: ${modelId}`);
		terminate();
		currentModelId = modelId;
		const ownedWorker = resources.createWorker({
			request: {
				id: TRANSCRIPTION_WORKER_ID,
				url: workerUrl,
				type: "module",
				name: "OpenCut transcription",
			},
		});
		worker = ownedWorker;

		initializing = new Promise<void>((resolve, reject) => {
			rejectInitialization = reject;
			let settled = false;
			const cleanup = () => {
				offMessage();
				offError();
				rejectInitialization = null;
			};
			const finish = (error?: Error) => {
				if (settled) return;
				settled = true;
				cleanup();
				initializing = null;
				if (error) reject(error);
				else resolve();
			};
			const offMessage = ownedWorker.onMessage((event) => {
				const response = event.data as WorkerResponse;
				switch (response.type) {
					case "init-progress":
						onProgress?.({
							status: "loading-model",
							progress: response.progress,
							message: `Loading ${model.name} model...`,
						});
						break;
					case "init-complete":
						initialized = true;
						finish();
						break;
					case "init-error":
						finish(new Error(response.error));
						break;
				}
			});
			const offError = ownedWorker.onError((event) =>
				finish(new Error(`Transcription Worker failed: ${event.message}`)),
			);
			ownedWorker.postMessage({
				message: { type: "init", modelId: model.huggingFaceId } satisfies WorkerMessage,
			});
		});

		try {
			await initializing;
		} catch (error) {
			if (worker === ownedWorker) terminate();
			throw error;
		}
	}

	async function transcribe({
		audioData,
		language = "auto",
		modelId = DEFAULT_TRANSCRIPTION_MODEL,
		onProgress,
	}: {
		audioData: Float32Array;
		language?: TranscriptionLanguage;
		modelId?: TranscriptionModelId;
		onProgress?: ProgressCallback;
	}): Promise<TranscriptionResult> {
		await ensureWorker({ modelId, onProgress });
		const ownedWorker = worker;
		if (!ownedWorker) throw new Error("Worker not initialized");

		return new Promise<TranscriptionResult>((resolve, reject) => {
			let settled = false;
			const cleanup = () => {
				offMessage();
				offError();
			};
			const finish = (result: TranscriptionResult | Error) => {
				if (settled) return;
				settled = true;
				cleanup();
				if (result instanceof Error) reject(result);
				else resolve(result);
			};
			const offMessage = ownedWorker.onMessage((event) => {
				const response = event.data as WorkerResponse;
				switch (response.type) {
					case "transcribe-progress":
						onProgress?.({
							status: "transcribing",
							progress: response.progress,
							message: "Transcribing audio...",
						});
						break;
					case "transcribe-complete":
						finish({ text: response.text, segments: response.segments, language });
						break;
					case "transcribe-error":
						finish(new Error(response.error));
						break;
					case "cancelled":
						finish(new Error("Transcription cancelled"));
						break;
				}
			});
			const offError = ownedWorker.onError((event) =>
				finish(new Error(`Transcription Worker failed: ${event.message}`)),
			);
			ownedWorker.postMessage({
				message: {
					type: "transcribe",
					audio: audioData,
					language,
				} satisfies WorkerMessage,
				transfer: [audioData.buffer],
			});
		});
	}

	return {
		transcribe,
		cancel: () => {
			worker?.postMessage({ message: { type: "cancel" } satisfies WorkerMessage });
		},
		terminate,
	};
}
