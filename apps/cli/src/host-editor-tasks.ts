import { randomUUID } from "node:crypto";
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
}
type Surface = { send: (frame: unknown) => void };
const mutating = (request: EditorTaskRequest) =>
	request.kind === "history.undo" || request.kind === "history.redo";
// Requests have a validated, flat schema. JSON property order is not semantic.
const requestIdentity = (request: EditorTaskRequest) =>
	JSON.stringify(request, Object.keys(request).sort());

/** One explicitly selected session owns a task. Never broadcast history/ASR. */
export function createEditorTaskRegistry({
	timeoutMs = 15 * 60_000,
}: { timeoutMs?: number } = {}) {
	const surfaces = new Map<string, Surface>();
	const jobs = new Map<string, OwnedJob>();
	const keys = new Map<string, string>();
	const snapshot = (job: Job) => structuredClone(job);
	const finish = (owned: OwnedJob, status: Status, error?: string) => {
		if (owned.job.status !== "running") return;
		clearTimeout(owned.timer);
		owned.job.status = status;
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
			const surfaceId =
				requestedSurface ??
				(surfaces.size === 1 ? [...surfaces.keys()][0] : undefined);
			if (!surfaceId)
				throw new Error(
					surfaces.size ? "task-surface-ambiguous" : "no-task-surface",
				);
			const surface = surfaces.get(surfaceId);
			if (!surface) throw new Error("no-task-surface");
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
				owned.job.result = structuredClone(payload.result);
				finish(owned, "complete");
			} else if ("progress" in payload)
				owned.job.progress = structuredClone(payload.progress);
			else throw new Error("invalid-task-report");
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
