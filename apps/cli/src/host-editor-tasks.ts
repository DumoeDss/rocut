import { randomUUID } from "node:crypto";
import {
	createExportOutputWriter,
	type ManagedOutputJob,
} from "./host-export-output";
import {
	isEditorTaskRequest,
	type EditorTaskRequest,
} from "@opencut/editor-contracts";

type Status =
	| "running"
	| "complete"
	| "failed"
	| "cancelled"
	| "outcome-unknown";
interface Job {
	id: string;
	surfaceId: string;
	request: EditorTaskRequest;
	status: Status;
	progress?: unknown;
	result?: unknown;
	error?: string;
}
interface OwnedJob {
	job: Job;
	token: string;
	timer: ReturnType<typeof setTimeout>;
	output?: ManagedOutputJob;
}
type Surface = { send: (frame: unknown) => void; snapshotPng?: boolean };
const mutating = (request: EditorTaskRequest) =>
	request.kind === "history.undo" || request.kind === "history.redo";
// Requests have a validated, flat schema. JSON property order is not semantic.
const requestIdentity = (request: EditorTaskRequest) =>
	JSON.stringify(request, Object.keys(request).sort());

/** One explicitly selected session owns a task. Never broadcast history/ASR. */
export function createEditorTaskRegistry({
	timeoutMs = 15 * 60_000,
	projectDir,
	currentRevision,
}: {
	timeoutMs?: number;
	projectDir?: string;
	currentRevision?: () => Promise<number>;
} = {}) {
	const surfaces = new Map<string, Surface>();
	const jobs = new Map<string, OwnedJob>();
	const keys = new Map<string, string>();
	const snapshot = (job: Job) => structuredClone(job);
	const writeOutput = projectDir
		? createExportOutputWriter<ManagedOutputJob>({
				projectDir,
				now: Date.now,
				noteActivity: () => {},
				validatePublication: async (output) => {
					const owned = jobs.get(output.id);
					if (
						owned &&
						currentRevision &&
						(await currentRevision()) !== owned.job.request.expectedRevision
					)
						finish(owned, "failed", "revision-conflict");
				},
			})
		: undefined;
	const finish = (owned: OwnedJob, status: Status, error?: string) => {
		if (owned.job.status !== "running") return;
		clearTimeout(owned.timer);
		owned.job.status = status;
		if (owned.output && status !== "complete") {
			owned.output.status = status === "cancelled" ? "cancelled" : "failed";
			owned.output.cancelRequested = status === "cancelled";
		}
		if (error) owned.job.error = error;
	};
	const sendCancel = (owned: OwnedJob) => {
		try {
			surfaces
				.get(owned.job.surfaceId)
				?.send({ command: "editor-task.cancel", jobId: owned.job.id });
		} catch {
			/* detached */
		}
	};
	return {
		attach(surfaceId: string, surface: Surface) {
			if (!/^[a-zA-Z0-9_-]{8,100}$/.test(surfaceId))
				throw new Error("invalid-task-surface-id");
			if (surfaces.has(surfaceId)) throw new Error("duplicate-task-surface");
			surfaces.set(surfaceId, surface);
			return () => {
				if (surfaces.get(surfaceId) !== surface) return;
				surfaces.delete(surfaceId);
				for (const owned of jobs.values())
					if (owned.job.surfaceId === surfaceId) {
						finish(
							owned,
							mutating(owned.job.request) ? "outcome-unknown" : "failed",
							"surface-disconnected",
						);
					}
			};
		},
		list() {
			return {
				surfaces: [...surfaces.keys()],
				snapshotSurfaces: [...surfaces]
					.filter(([, s]) => s.snapshotPng)
					.map(([id]) => id),
				jobs: [...jobs.values()].map(({ job }) => snapshot(job)),
			};
		},
		get(id: string) {
			const owned = jobs.get(id);
			return owned ? snapshot(owned.job) : null;
		},
		start(input: unknown, revision: number) {
			if (
				!input ||
				typeof input !== "object" ||
				!("request" in input) ||
				!isEditorTaskRequest(input.request)
			)
				throw new Error("invalid-editor-task");
			const request = input.request;
			const requestedSurface =
				"surfaceId" in input ? input.surfaceId : undefined;
			if (
				requestedSurface !== undefined &&
				typeof requestedSurface !== "string"
			)
				throw new Error("invalid-task-surface-id");
			const previousId = keys.get(request.idempotencyKey);
			if (previousId) {
				const previous = jobs.get(previousId)!;
				if (
					requestIdentity(previous.job.request) !== requestIdentity(request) ||
					(requestedSurface !== undefined &&
						requestedSurface !== previous.job.surfaceId)
				)
					throw new Error("task-idempotency-conflict");
				return snapshot(previous.job);
			}
			if (request.expectedRevision !== revision)
				throw new Error("revision-conflict");
			if (jobs.size >= 128) throw new Error("task-session-capacity-reached");
			const eligible =
				request.kind === "snapshot.png"
					? [...surfaces].filter(([, s]) => s.snapshotPng).map(([id]) => id)
					: [...surfaces.keys()];
			if (request.kind === "snapshot.png" && eligible.length === 0)
				throw new Error(
					surfaces.size ? "no-snapshot-surface" : "no-task-surface",
				);
			const surfaceId =
				requestedSurface ?? (eligible.length === 1 ? eligible[0] : undefined);
			if (!surfaceId)
				throw new Error(
					surfaces.size ? "task-surface-ambiguous" : "no-task-surface",
				);
			const surface = surfaces.get(surfaceId);
			if (!surface) throw new Error("no-task-surface");
			if (
				request.kind === "snapshot.png" &&
				(!surface.snapshotPng || !writeOutput)
			)
				throw new Error("no-snapshot-surface");
			if (
				[...jobs.values()].some(
					({ job }) => job.surfaceId === surfaceId && job.status === "running",
				)
			)
				throw new Error("task-surface-busy");
			const id = randomUUID(),
				token = randomUUID();
			const job: Job = {
				id,
				surfaceId,
				request: structuredClone(request),
				status: "running",
			};
			const owned: OwnedJob = {
				job,
				token,
				timer: setTimeout(() => {
					finish(
						owned,
						mutating(request) ? "outcome-unknown" : "failed",
						"task-timeout",
					);
					if (!mutating(request)) sendCancel(owned);
				}, timeoutMs),
			};
			if (request.kind === "snapshot.png")
				owned.output = {
					id,
					options: { format: "png" },
					startedAt: Date.now(),
					updatedAt: Date.now(),
					status: "pending",
					progress: 0,
					cancelRequested: false,
				};
			owned.timer.unref?.();
			jobs.set(id, owned);
			keys.set(request.idempotencyKey, id);
			try {
				surface.send({
					command: "editor-task.start",
					jobId: id,
					token,
					request: job.request,
				});
			} catch {
				// A transport can throw after part of the frame has been delivered.
				finish(
					owned,
					mutating(request) ? "outcome-unknown" : "failed",
					"task-dispatch-failed",
				);
			}
			return snapshot(job);
		},
		report(id: string, payload: unknown) {
			const owned = jobs.get(id);
			if (!owned) throw new Error("unknown-editor-task");
			if (
				!payload ||
				typeof payload !== "object" ||
				!("token" in payload) ||
				payload.token !== owned.token
			)
				throw new Error("task-owner-mismatch");
			if (owned.job.status !== "running") return snapshot(owned.job);
			if ("error" in payload && typeof payload.error === "string")
				finish(owned, "failed", payload.error);
			else if ("result" in payload) {
				if (owned.output) throw new Error("snapshot-requires-png-upload");
				owned.job.result = structuredClone(payload.result);
				finish(owned, "complete");
			} else if ("progress" in payload)
				owned.job.progress = structuredClone(payload.progress);
			else throw new Error("invalid-task-report");
			return snapshot(owned.job);
		},
		async completeOutput(id: string, token: unknown, bytes: Uint8Array) {
			const owned = jobs.get(id);
			if (!owned) throw new Error("unknown-editor-task");
			if (token !== owned.token) throw new Error("task-owner-mismatch");
			if (
				!owned.output ||
				!writeOutput ||
				owned.job.request.kind !== "snapshot.png"
			)
				throw new Error("task-has-no-png-output");
			if (owned.job.status !== "running") return snapshot(owned.job);
			if (
				bytes.length < 33 ||
				![137, 80, 78, 71, 13, 10, 26, 10].every((v, i) => bytes[i] === v) ||
				String.fromCharCode(...bytes.subarray(12, 16)) !== "IHDR"
			)
				throw new Error("invalid-snapshot-png");
			const header = new DataView(
				bytes.buffer,
				bytes.byteOffset,
				bytes.byteLength,
			);
			if (
				header.getUint32(8) !== 13 ||
				header.getUint32(16) === 0 ||
				header.getUint32(20) === 0
			)
				throw new Error("invalid-snapshot-png");
			try {
				const output = await writeOutput(owned.output, bytes);
				if (owned.job.status === "running" && output.status === "completed") {
					owned.job.result = {
						outputPath: output.outputPath,
						format: "png",
						tick: owned.job.request.tick,
						sourceRevision: owned.job.request.expectedRevision,
						sceneId: owned.job.request.sceneId,
					};
					finish(owned, "complete");
				}
			} catch (error) {
				finish(
					owned,
					"failed",
					error instanceof Error ? error.message : String(error),
				);
			}
			return snapshot(owned.job);
		},
		cancel(id: string) {
			const owned = jobs.get(id);
			if (!owned) throw new Error("unknown-editor-task");
			if (owned.job.status === "running") {
				if (mutating(owned.job.request))
					throw new Error("history-commit-not-cancellable");
				finish(owned, "cancelled");
				sendCancel(owned);
			}
			return snapshot(owned.job);
		},
		dispose() {
			for (const owned of jobs.values()) {
				if (!mutating(owned.job.request)) sendCancel(owned);
				finish(
					owned,
					mutating(owned.job.request) ? "outcome-unknown" : "cancelled",
					"host-closed",
				);
			}
			surfaces.clear();
		},
	};
}
export type EditorTaskRegistry = ReturnType<typeof createEditorTaskRegistry>;
