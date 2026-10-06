import type { WorkerHandle, WorkerId } from "@opencut/editor-ports";
import type { SessionResources } from "../../editor/session/resources";
import type {
	TranscriptionLanguage,
	TranscriptionModelId,
	TranscriptionProgress,
	TranscriptionResult,
} from "../../transcription/types";
import {
	DEFAULT_TRANSCRIPTION_MODEL,
	TRANSCRIPTION_MODELS,
} from "../../transcription/models";
import type { WorkerMessage, WorkerResponse } from "./worker";

type ProgressCallback = (progress: TranscriptionProgress) => void;
const TRANSCRIPTION_WORKER_ID = "transcription" as WorkerId;
const WORKER_RESPONSE_TYPES: ReadonlySet<string> = new Set([
	"init-progress",
	"init-complete",
	"init-error",
	"transcribe-progress",
	"transcribe-complete",
	"transcribe-error",
	"cancelled",
]);

function isWorkerResponse(value: unknown): value is WorkerResponse {
	return (
		typeof value === "object" &&
		value !== null &&
		"type" in value &&
		typeof value.type === "string" &&
		WORKER_RESPONSE_TYPES.has(value.type)
	);
}

export interface TranscriptionService {
	transcribe(args: {
		audioData: Float32Array;
		language?: TranscriptionLanguage;
		modelId?: TranscriptionModelId;
		onProgress?: ProgressCallback;
		signal?: AbortSignal;
	}): Promise<TranscriptionResult>;
	cancel(): void;
	terminate(): void;
}

export function createTranscriptionService({
	resources,
	workerUrl = new URL("./worker.ts", import.meta.url),
	activityAdmission,
}: {
	resources: Pick<SessionResources, "createWorker">;
	workerUrl?: URL;
	activityAdmission?: () => boolean;
}): TranscriptionService {
	let worker: WorkerHandle | null = null;
	let currentModelId: TranscriptionModelId | null = null;
	let initialized = false;
	let initializing: Promise<void> | null = null;
	let terminateInitialization: ((reason: Error) => void) | null = null;
	let generation = 0;
	let busy = false;
	const pendingTerminals = new Set<(reason: Error) => void>();

	function assertActivityAdmitted(): void {
		if (activityAdmission && !activityAdmission()) {
			throw new Error(
				"Session activity admission is closed while suspended; resume the session " +
					"before starting transcription.",
			);
		}
	}

	function releaseWorker({ reason }: { reason: Error }): void {
		generation += 1;
		for (const settle of [...pendingTerminals]) settle(reason);
		pendingTerminals.clear();
		const settleInitialization = terminateInitialization;
		initialized = false;
		currentModelId = null;
		const ownedWorker = worker;
		worker = null;
		settleInitialization?.(reason);
		ownedWorker?.terminate();
	}

	function terminate(): void {
		releaseWorker({
			reason: new Error(
				"Transcription Worker was terminated by the session lifecycle.",
			),
		});
	}

	async function ensureWorker({
		modelId,
		onProgress,
	}: {
		modelId: TranscriptionModelId;
		onProgress?: ProgressCallback;
	}): Promise<void> {
		assertActivityAdmitted();
		if (worker && initialized && currentModelId === modelId) return;
		if (worker && initializing && currentModelId === modelId) {
			await initializing;
			return;
		}

		const model = TRANSCRIPTION_MODELS.find(
			(candidate) => candidate.id === modelId,
		);
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
		const workerGeneration = generation;

		initializing = new Promise<void>((resolve, reject) => {
			let settled = false;
			const cleanup = () => {
				offMessage();
				offError();
				if (terminateInitialization === finish) {
					terminateInitialization = null;
				}
			};
			const finish = (error?: Error) => {
				if (settled) return;
				settled = true;
				cleanup();
				initializing = null;
				if (error) reject(error);
				else resolve();
			};
			terminateInitialization = (reason) => finish(reason);
			const offMessage = ownedWorker.onMessage((event) => {
				if (generation !== workerGeneration || worker !== ownedWorker) return;
				if (!isWorkerResponse(event.data)) return;
				const response = event.data;
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
			const offError = ownedWorker.onError((event) => {
				if (generation !== workerGeneration || worker !== ownedWorker) return;
				finish(new Error(`Transcription Worker failed: ${event.message}`));
			});
			ownedWorker.postMessage({
				message: {
					type: "init",
					modelId: model.huggingFaceId,
				} satisfies WorkerMessage,
			});
		});

		try {
			await initializing;
			assertActivityAdmitted();
			if (generation !== workerGeneration || worker !== ownedWorker) {
				throw new Error("Transcription Worker generation became stale.");
			}
		} catch (error) {
			if (worker === ownedWorker) terminate();
			throw error;
		}
	}

	async function runTranscription({
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
		assertActivityAdmitted();
		await ensureWorker({ modelId, onProgress });
		const ownedWorker = worker;
		if (!ownedWorker) throw new Error("Worker not initialized");
		assertActivityAdmitted();

		return new Promise<TranscriptionResult>((resolve, reject) => {
			const requestGeneration = generation;
			let settled = false;
			const cleanup = () => {
				offMessage();
				offError();
				pendingTerminals.delete(terminateRequest);
			};
			const finish = (result: TranscriptionResult | Error) => {
				if (settled) return;
				settled = true;
				cleanup();
				if (result instanceof Error) reject(result);
				else resolve(result);
			};
			const terminateRequest = (reason: Error) => finish(reason);
			pendingTerminals.add(terminateRequest);
			const offMessage = ownedWorker.onMessage((event) => {
				if (generation !== requestGeneration || worker !== ownedWorker) return;
				if (!isWorkerResponse(event.data)) return;
				const response = event.data;
				switch (response.type) {
					case "transcribe-progress":
						onProgress?.({
							status: "transcribing",
							progress: response.progress,
							message: "Transcribing audio...",
						});
						break;
					case "transcribe-complete":
						finish({
							text: response.text,
							segments: response.segments,
							language,
						});
						break;
					case "transcribe-error":
						finish(new Error(response.error));
						break;
					case "cancelled":
						finish(new Error("Transcription cancelled"));
						break;
				}
			});
			const offError = ownedWorker.onError((event) => {
				if (generation !== requestGeneration || worker !== ownedWorker) return;
				finish(new Error(`Transcription Worker failed: ${event.message}`));
			});
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
		async transcribe(args) {
			if (busy) throw new Error("transcription-busy");
			args.signal?.throwIfAborted();
			busy = true;
			const abort = () =>
				releaseWorker({ reason: new Error("Transcription cancelled") });
			args.signal?.addEventListener("abort", abort, { once: true });
			try {
				return await runTranscription(args);
			} finally {
				args.signal?.removeEventListener("abort", abort);
				busy = false;
			}
		},
		cancel: () => {
			// A message cannot interrupt model loading or an in-flight native
			// inference. Release the owned worker and reject all pending work;
			// a later request must acquire a fresh generation.
			releaseWorker({ reason: new Error("Transcription cancelled") });
		},
		terminate,
	};
}
