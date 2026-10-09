import { createHash } from "node:crypto";
import type { ProjectId, ProjectStore } from "@opencut/editor-ports";
import type {
	ProgrammaticResource,
	ResolvedProgrammaticResource,
} from "@opencut/editor-contracts";
import * as wasm from "opencut-wasm";

export interface ProgrammaticResourceStore {
	store: ProjectStore;
	projectId: ProjectId;
}

export function validateResources(
	value: unknown,
): asserts value is readonly ProgrammaticResource[] {
	const issues: { message: string }[] = JSON.parse(
		wasm.validateProgrammaticResourcesJson(JSON.stringify(value)),
	);
	if (issues.length) throw new Error(issues[0].message);
}

export const resourceDigest = (body: ArrayBuffer) =>
	createHash("sha256").update(new Uint8Array(body)).digest("hex");

export async function loadProgrammaticResource({
	store,
	projectId,
	resource,
	signal,
}: ProgrammaticResourceStore & {
	resource: ProgrammaticResource;
	signal?: AbortSignal;
}): Promise<ResolvedProgrammaticResource> {
	validateResources([resource]);
	signal?.throwIfAborted();
	const attachment = await store.loadAttachment({
		projectId,
		key: resource.attachmentKey,
	});
	signal?.throwIfAborted();
	if (!attachment)
		throw new Error(`Missing programmatic resource: ${resource.id}`);
	const metadata = attachment.metadata as Record<string, unknown> | null;
	if (
		metadata?.kind !== "programmatic-resource" ||
		metadata.version !== 1 ||
		metadata.sha256 !== resource.sha256 ||
		metadata.byteLength !== resource.byteLength ||
		metadata.mimeType !== resource.mimeType ||
		attachment.body.byteLength !== resource.byteLength ||
		resourceDigest(attachment.body) !== resource.sha256
	)
		throw new Error(`Programmatic resource integrity mismatch: ${resource.id}`);
	return { resource, body: attachment.body };
}

export async function loadProgrammaticResources(
	context: ProgrammaticResourceStore,
	resources: readonly ProgrammaticResource[],
	signal: AbortSignal,
): Promise<ResolvedProgrammaticResource[]> {
	validateResources(resources);
	const result: ResolvedProgrammaticResource[] = [];
	for (const resource of resources)
		result.push(
			await loadProgrammaticResource({ ...context, resource, signal }),
		);
	return result;
}
