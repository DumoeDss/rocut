import { randomUUID } from "node:crypto";
import { deliverOutput, prepareOutputDestination } from "./output-delivery";
import { resolve } from "node:path";
import type { ResolvedTarget } from "./target-registry";
import { request } from "./host-request";

/** Transport only. The selected attached editor renders; the daemon owns exports. */
export async function runSnapshotCli({
	resolved,
	tick,
	out,
	surfaceId,
	expectedRevision,
}: {
	resolved: ResolvedTarget;
	tick: number;
	out?: string;
	surfaceId?: string;
	expectedRevision?: number;
}) {
	if (!Number.isSafeInteger(tick) || tick < 0)
		throw new Error("--tick requires non-negative integer media ticks");
	const destination = await prepareOutputDestination(out);
	if (
		expectedRevision !== undefined &&
		(!Number.isSafeInteger(expectedRevision) || expectedRevision < 0)
	)
		throw new Error("--revision requires a non-negative integer");
	const context = (await request(resolved.secret, "GET", "context")) as {
		revision: number;
		project?: { id: string; sceneState?: { currentSceneId: string } };
		editorTasks?: { kinds?: string[] };
	};
	if (!context.editorTasks?.kinds?.includes("snapshot.png"))
		throw new Error(
			"Host lacks snapshot.png support; update and reopen the editor",
		);
	const projectId = context.project?.id,
		sceneId = context.project?.sceneState?.currentSceneId;
	if (!projectId || !sceneId)
		throw new Error("snapshot requires a project with an active scene");
	const started = (await request(resolved.secret, "POST", "editor-tasks", {
		...(surfaceId ? { surfaceId } : {}),
		request: {
			kind: "snapshot.png",
			expectedRevision: expectedRevision ?? Number(context.revision),
			idempotencyKey: randomUUID(),
			projectId,
			sceneId,
			tick,
		},
	})) as { id: string };
	let job: {
		status: string;
		error?: string;
		result?: { outputPath?: string; sourceRevision?: number };
	};
	const cancel = () => {
		void request(
			resolved.secret,
			"POST",
			`editor-tasks/${started.id}/cancel`,
		).catch(() => {});
	};
	process.once("SIGINT", cancel);
	try {
		for (;;) {
			job = (await request(
				resolved.secret,
				"GET",
				`editor-tasks/${started.id}`,
			)) as typeof job;
			if (job.status !== "running") break;
			await new Promise((wake) => setTimeout(wake, 250));
		}
		if (job.status !== "complete" || !job.result?.outputPath)
			throw new Error(
				`snapshot ${started.id} ${job.status}: ${job.error ?? "no PNG output"}`,
			);
		await deliverOutput(job.result.outputPath, destination);
		return {
			target: resolved.entry.id,
			jobId: started.id,
			status: job.status,
			format: "png",
			tick,
			sourceRevision: job.result.sourceRevision,
			outputPath: out === undefined ? job.result.outputPath : resolve(out),
			managedOutputPath: job.result.outputPath,
		};
	} finally {
		process.removeListener("SIGINT", cancel);
	}
}
