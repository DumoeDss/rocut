import { createEditorTaskRunner } from "@opencut/editor-classic/agent-tasks";
import type { HostCommand } from "./host-served";

/** HTTP and cancellation only; editor business behavior stays in the provider. */
export function createHostEditorTasks(
	options: Parameters<typeof createEditorTaskRunner>[0],
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
			void runner
				.run({
					request,
					signal: controller.signal,
					onProgress: (progress) => {
						void report({ jobId, payload: { token, progress } }).catch(() =>
							controller.abort(),
						);
					},
				})
				.then(
					(result) => report({ jobId, payload: { token, result } }),
					(error) =>
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
