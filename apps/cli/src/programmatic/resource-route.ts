import type { ServerResponse } from "node:http";
import { importProgrammaticResource } from "./resource-import";
import { importMvAudio } from "./audio-import";
import { importImageSequence } from "./image-sequence-import";
import {
	restoreImageSequenceSource,
	ImageSequenceRestoreIncompleteError,
} from "./image-sequence-restore";
import {
	loadProgrammaticResource,
	validateResources,
	type ProgrammaticResourceStore,
} from "./resources";

export async function handleProgrammaticResourceRoute({
	action,
	input,
	response,
	resourceStore,
	enqueue,
}: {
	action: string;
	input: unknown;
	response: ServerResponse;
	resourceStore: ProgrammaticResourceStore;
	enqueue: <T>(task: () => Promise<T>) => Promise<T>;
}) {
	const json = (status: number, body: unknown) => {
		if (response.destroyed) return;
		response.writeHead(status, {
			"content-type": "application/json",
			"cache-control": "no-store",
		});
		response.end(JSON.stringify(body));
	};
	const cancellation = new AbortController();
	const sequenceOperation =
		action === "import-image-sequence" ||
		action === "restore-image-sequence-source";
	const onClose = () => {
		if (!response.writableEnded)
			cancellation.abort(Error(`Image sequence ${action} cancelled`));
	};
	if (sequenceOperation) response.once("close", onClose);
	try {
		if (sequenceOperation) {
			const operation =
				action === "import-image-sequence"
					? importImageSequence
					: restoreImageSequenceSource;
			json(
				200,
				await enqueue(async () =>
					operation({
						...resourceStore,
						input,
						signal: cancellation.signal,
					}),
				),
			);
		} else if (action === "import-audio") {
			json(
				200,
				await enqueue(() => importMvAudio({ ...resourceStore, input })),
			);
		} else if (action === "import") {
			json(
				200,
				await enqueue(() =>
					importProgrammaticResource({ ...resourceStore, input }),
				),
			);
		} else if (action === "load") {
			const resources = [input];
			validateResources(resources);
			const loaded = await loadProgrammaticResource({
				...resourceStore,
				resource: resources[0],
			});
			response.writeHead(200, {
				"content-type": loaded.resource.mimeType,
				"content-length": loaded.body.byteLength,
				"cache-control": "no-store",
			});
			response.end(Buffer.from(loaded.body));
		} else json(404, { error: "Unknown programmatic resource operation" });
	} catch (error) {
		json(422, {
			error:
				error instanceof Error ? error.message : "Programmatic resource failed",
			...(error instanceof ImageSequenceRestoreIncompleteError
				? { code: error.code, incomplete: true, directory: error.directory }
				: {}),
		});
	} finally {
		if (sequenceOperation) response.off("close", onClose);
	}
}
