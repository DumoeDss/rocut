import { open } from "node:fs/promises";
import type { ProgrammaticResource, ResolvedProgrammaticResource } from "@opencut/editor-contracts";
import { decodeHtmlDocument } from "./document-resource";
import { loadProgrammaticResource, resourceDigest, validateResources, type ProgrammaticResourceStore } from "./resources";

export type ResourceDescription = Pick<ProgrammaticResource, "id" | "kind" | "mimeType" | "font">;
export function describeResource(description: ResourceDescription, byteLength: number, sha256 = "0".repeat(64)): ProgrammaticResource {
	const prefix = description.kind === "source" ? "programmatic-source-sha256-" : "programmatic-sha256-";
	return { ...description, byteLength, sha256, attachmentKey: `${prefix}${sha256}` };
}

/** The caller supplies an already scoped path. Rust checks size before allocation. */
export async function readResourceFile(
	filePath: string,
	description: ResourceDescription,
	signal?: AbortSignal,
	checkManifest?: (resource: ProgrammaticResource) => void,
): Promise<ResolvedProgrammaticResource> {
	signal?.throwIfAborted();
	const file = await open(filePath, "r");
	try {
		const before = await file.stat();
		if (!before.isFile()) throw Error("Resource must be a regular file");
		const provisional = describeResource(description, before.size);
		validateResources([provisional]);
		checkManifest?.(provisional);
		const bytes = Buffer.alloc(before.size);
		let offset = 0;
		while (offset < bytes.length) {
			signal?.throwIfAborted();
			const { bytesRead } = await file.read(bytes, offset, bytes.length - offset, offset);
			if (!bytesRead) throw Error("Resource changed while importing");
			offset += bytesRead;
		}
		const after = await file.stat();
		if (before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs)
			throw Error("Resource changed while importing");
		signal?.throwIfAborted();
		const body = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
		if (description.kind === "document") decodeHtmlDocument(body);
		return { resource: describeResource(description, body.byteLength, resourceDigest(body)), body };
	} finally { await file.close(); }
}

/** No successful reference until attachment metadata/body pass readback. */
export async function saveResourceBytes(
	context: ProgrammaticResourceStore,
	{ resource, body }: ResolvedProgrammaticResource,
	signal?: AbortSignal,
) {
	validateResources([resource]);
	if (body.byteLength !== resource.byteLength || resourceDigest(body) !== resource.sha256)
		throw Error("Prepared resource integrity mismatch");
	if (resource.kind === "document") decodeHtmlDocument(body);
	signal?.throwIfAborted();
	const existing = await context.store.loadAttachment({ projectId: context.projectId, key: resource.attachmentKey });
	if (!existing) await context.store.saveAttachment({
		projectId: context.projectId, key: resource.attachmentKey, body,
		metadata: { kind: "programmatic-resource", version: 1, mimeType: resource.mimeType, byteLength: resource.byteLength, sha256: resource.sha256 },
	});
	await loadProgrammaticResource({ ...context, resource, signal });
	return { resource, reused: existing !== null };
}
