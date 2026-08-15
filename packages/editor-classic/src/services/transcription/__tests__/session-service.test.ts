import { describe, expect, test } from "bun:test";
import type {
	WorkerErrorEvent,
	WorkerHandle,
	WorkerMessageEvent,
	WorkerRequest,
} from "@opencut/editor-ports";
import { createTranscriptionService } from "../service";

class FakeHandle implements WorkerHandle {
	readonly id = "transcription" as WorkerHandle["id"];
	readonly resourceId = "worker:test" as WorkerHandle["resourceId"];
	readonly sent: Array<{
		message: unknown;
		transfer?: readonly Transferable[];
	}> = [];
	readonly messages = new Set<(event: WorkerMessageEvent) => void>();
	readonly errors = new Set<(event: WorkerErrorEvent) => void>();
	terminations = 0;
	postMessage(args: {
		message: unknown;
		transfer?: readonly Transferable[];
	}): void {
		this.sent.push(args);
	}
	onMessage(listener: (event: WorkerMessageEvent) => void): () => void {
		this.messages.add(listener);
		return () => this.messages.delete(listener);
	}
	onError(listener: (event: WorkerErrorEvent) => void): () => void {
		this.errors.add(listener);
		return () => this.errors.delete(listener);
	}
	terminate(): void {
		this.terminations += 1;
	}
	emit(data: unknown): void {
		for (const listener of [...this.messages]) listener({ data });
	}
	fail(message: string): void {
		for (const listener of [...this.errors]) listener({ message });
	}
}

function fixture() {
	const handle = new FakeHandle();
	const requests: WorkerRequest[] = [];
	const resources = {
		createWorker: ({ request }: { request: WorkerRequest }) => {
			requests.push(request);
			return handle;
		},
	};
	return { handle, requests, resources };
}

async function afterTurn(): Promise<void> {
	await Promise.resolve();
	await Promise.resolve();
}

describe("session-owned transcription service", () => {
	test("requests a named module Worker through SessionResources and preserves the message flow", async () => {
		const { handle, requests, resources } = fixture();
		const service = createTranscriptionService({
			resources,
			workerUrl: new URL("https://editor.invalid/transcription.js"),
		});
		const progress: number[] = [];
		const audio = new Float32Array([0.1, 0.2]);
		const result = service.transcribe({
			audioData: audio,
			onProgress: (entry) => progress.push(entry.progress),
		});
		await afterTurn();
		expect(requests).toHaveLength(1);
		expect(requests[0]).toMatchObject({
			id: "transcription",
			type: "module",
			name: "OpenCut transcription",
		});
		expect(requests[0]?.url.toString()).toBe(
			"https://editor.invalid/transcription.js",
		);
		handle.emit({ type: "init-progress", progress: 25 });
		handle.emit({ type: "init-complete" });
		await afterTurn();
		expect(handle.sent[1]?.message).toMatchObject({
			type: "transcribe",
			audio,
		});
		expect(handle.sent[1]?.transfer).toEqual([audio.buffer]);
		handle.emit({ type: "transcribe-progress", progress: 80 });
		handle.emit({ type: "transcribe-complete", text: "hello", segments: [] });
		expect(await result).toEqual({
			text: "hello",
			segments: [],
			language: "auto",
		});
		expect(progress).toEqual([25, 80]);
		expect(handle.messages.size).toBe(0);
		expect(handle.errors.size).toBe(0);
	});

	test("keeps two sessions isolated and terminates each registry handle exactly once", async () => {
		const one = fixture();
		const two = fixture();
		const first = createTranscriptionService({
			resources: one.resources,
			workerUrl: new URL("https://one.invalid/w.js"),
		});
		const second = createTranscriptionService({
			resources: two.resources,
			workerUrl: new URL("https://two.invalid/w.js"),
		});
		void first.transcribe({ audioData: new Float32Array(1) }).catch(() => {});
		void second.transcribe({ audioData: new Float32Array(1) }).catch(() => {});
		await afterTurn();
		expect(one.requests[0]?.url.origin).toBe("https://one.invalid");
		expect(two.requests[0]?.url.origin).toBe("https://two.invalid");
		first.terminate();
		first.terminate();
		second.terminate();
		expect(one.handle.terminations).toBe(1);
		expect(two.handle.terminations).toBe(1);
	});

	test("rejects initialization errors and removes listeners", async () => {
		const { handle, resources } = fixture();
		const service = createTranscriptionService({ resources });
		const pending = service.transcribe({ audioData: new Float32Array(1) });
		await afterTurn();
		handle.emit({ type: "init-error", error: "model failed" });
		await expect(pending).rejects.toThrow("model failed");
		expect(handle.terminations).toBe(1);
		expect(handle.messages.size).toBe(0);
		expect(handle.errors.size).toBe(0);
	});

	test("terminates pending generations, ignores stale events, and reacquires only after admission resumes", async () => {
		const handles: FakeHandle[] = [];
		let activityAdmitted = true;
		const resources = {
			createWorker: () => {
				const handle = new FakeHandle();
				handles.push(handle);
				return handle;
			},
		};
		const service = createTranscriptionService({
			resources,
			activityAdmission: () => activityAdmitted,
		});

		const pendingInitialization = service.transcribe({
			audioData: new Float32Array([0.1]),
		});
		await afterTurn();
		const initializationWorker = handles[0];
		expect(initializationWorker.messages.size).toBe(1);
		expect(initializationWorker.errors.size).toBe(1);
		service.terminate();
		await expect(pendingInitialization).rejects.toThrow(/terminated/i);
		expect(initializationWorker.terminations).toBe(1);
		expect(initializationWorker.messages.size).toBe(0);
		expect(initializationWorker.errors.size).toBe(0);

		const pendingTranscription = service.transcribe({
			audioData: new Float32Array([0.2]),
		});
		await afterTurn();
		const transcriptionWorker = handles[1];
		transcriptionWorker.emit({ type: "init-complete" });
		await afterTurn();
		expect(transcriptionWorker.messages.size).toBe(1);
		expect(transcriptionWorker.errors.size).toBe(1);
		service.terminate();
		service.terminate();
		await expect(pendingTranscription).rejects.toThrow(/terminated/i);
		expect(transcriptionWorker.terminations).toBe(1);
		expect(transcriptionWorker.messages.size).toBe(0);
		expect(transcriptionWorker.errors.size).toBe(0);

		activityAdmitted = false;
		await expect(
			service.transcribe({ audioData: new Float32Array([0.3]) }),
		).rejects.toThrow(/admission is closed/i);
		expect(handles).toHaveLength(2);

		activityAdmitted = true;
		const fresh = service.transcribe({
			audioData: new Float32Array([0.4]),
		});
		await afterTurn();
		const freshWorker = handles[2];
		initializationWorker.emit({ type: "init-complete" });
		transcriptionWorker.emit({
			type: "transcribe-complete",
			text: "stale",
			segments: [],
		});
		freshWorker.emit({ type: "init-complete" });
		await afterTurn();
		freshWorker.emit({
			type: "transcribe-complete",
			text: "fresh",
			segments: [],
		});
		expect(await fresh).toMatchObject({ text: "fresh" });
		expect(freshWorker.messages.size).toBe(0);
		expect(freshWorker.errors.size).toBe(0);
		service.terminate();
		expect(freshWorker.terminations).toBe(1);
	});
});
