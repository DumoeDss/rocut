import { createEditorTaskRunner } from "@opencut/editor-classic/agent-tasks";
import type { HostCommand } from "./host-served";

/** HTTP and cancellation only; editor business behavior stays in the provider. */
export function createHostEditorTasks(
	options: Parameters<typeof createEditorTaskRunner>[0],
	whenReady: (signal?: AbortSignal) => Promise<void> = async () => {},
) {
	const runner = createEditorTaskRunner(options);
	const active = new Map<string, AbortController>();
	const surfaceId = crypto.randomUUID();
	const report = async ({
		jobId,
		payload,
	}: {
		jobId: string;
		payload: unknown;
	}) => {
		const response = await fetch(
			new URL(
				`api/editor-tasks/${encodeURIComponent(jobId)}/report`,
				location.href,
			),
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify(payload),
			},
		);
		if (!response.ok) throw new Error("editor-task-report-failed");
	};
	const upload = async (
		jobId: string,
		token: string,
		blob: Blob,
		signal: AbortSignal,
	) => {
		signal.throwIfAborted();
		const response = await fetch(
			new URL(
				`api/editor-tasks/${encodeURIComponent(jobId)}/output`,
				location.href,
			),
			{
				method: "POST",
				headers: { "content-type": "image/png", "x-editor-task-token": token },
				body: blob,
				signal,
			},
		);
		if (!response.ok) throw new Error("snapshot-upload-failed");
		const job = (await response.json()) as { status?: string; error?: string };
		if (job.status !== "complete")
			throw new Error(job.error ?? `snapshot-${job.status}`);
	};
	return {
		surfaceId,
		handle(command: HostCommand) {
			if (command.command === "editor-task.cancel") {
				active.get(command.jobId)?.abort();
				return true;
			}
			if (command.command !== "editor-task.start") return false;
			if (active.has(command.jobId)) return true;
			const controller = new AbortController();
			active.set(command.jobId, controller);
			const { jobId, token, request } = command;
			void Promise.resolve()
				.then(() => {
					controller.signal.throwIfAborted();
					return whenReady(controller.signal);
				})
				.then(() => {
					controller.signal.throwIfAborted();
					return runner.run({
						request,
						signal: controller.signal,
						onProgress: (progress) => {
							void report({ jobId, payload: { token, progress } }).catch(() =>
								controller.abort(),
							);
						},
					});
				})
				.then(async (result) => {
					if (request.kind === "snapshot.png") {
						if (!("blob" in result) || !(result.blob instanceof Blob))
							throw new Error("snapshot-result-missing-png");
						await upload(jobId, token, result.blob, controller.signal);
					} else await report({ jobId, payload: { token, result } });
				})
				.catch((error) =>
					report({
						jobId,
						payload: {
							token,
							error: error instanceof Error ? error.message : String(error),
						},
					}),
				)
				.catch(() => undefined)
				.finally(() => active.delete(jobId));
			return true;
		},
		disconnect() {
			for (const controller of active.values()) controller.abort();
		},
	};
}
