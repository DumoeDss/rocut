import { createHash } from "node:crypto";
import * as wasm from "opencut-wasm";
import type {
	ImageSequenceManifest,
	ImageSequenceManifestValidation,
	ProgrammaticResource,
	ResolvedProgrammaticResource,
} from "@opencut/editor-contracts";
import type { ProjectAttachment } from "@opencut/editor-ports";
import {
	resourceDigest,
	validateResources,
	type ProgrammaticResourceStore,
} from "./resources";
import { validateImageSequenceFrame } from "./image-sequence-image";

export const IMAGE_SEQUENCE_MIME = "application/vnd.rocut.image-sequence+json";

export function parseImageSequenceManifest(
	body: ArrayBuffer,
): ImageSequenceManifestValidation {
	if (typeof wasm.validateImageSequenceManifestJson !== "function")
		throw Error(
			"Image sequence import requires the matching rebuilt Rocut WASM",
		);
	const input: unknown = JSON.parse(
		new TextDecoder("utf-8", { fatal: true }).decode(body),
	);
	const result = JSON.parse(
		wasm.validateImageSequenceManifestJson(JSON.stringify(input)),
	) as ImageSequenceManifestValidation | { error: string };
	if ("error" in result) throw Error(result.error);
	if (!result.manifest || !Array.isArray(result.dependencies) || !result.limits)
		throw Error("Invalid image sequence manifest validator response");
	return result;
}

function assertSequenceAttachment({
	attachment,
	resource,
}: {
	attachment: ProjectAttachment;
	resource: ProgrammaticResource;
}): void {
	const metadata = attachment.metadata as Record<string, unknown> | null;
	if (
		metadata?.kind !== "programmatic-resource" ||
		metadata.version !== 1 ||
		metadata.mimeType !== resource.mimeType ||
		metadata.byteLength !== resource.byteLength ||
		metadata.sha256 !== resource.sha256 ||
		attachment.body.byteLength !== resource.byteLength ||
		resourceDigest(attachment.body) !== resource.sha256
	)
		throw Error(`Image sequence resource integrity mismatch: ${resource.id}`);
}

export async function loadImageSequenceResource({
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
		signal,
	});
	signal?.throwIfAborted();
	if (!attachment)
		throw Error(`Missing image sequence resource: ${resource.id}`);
	assertSequenceAttachment({ attachment, resource });
	return { resource, body: attachment.body };
}

/** Save one verified dependency at a time; never overwrite or delete shared bytes. */
export async function saveImageSequenceResource({
	store,
	projectId,
	resource,
	body,
	signal,
}: ProgrammaticResourceStore &
	ResolvedProgrammaticResource & {
		signal?: AbortSignal;
	}): Promise<{ resource: ProgrammaticResource; reused: boolean }> {
	validateResources([resource]);
	if (
		body.byteLength !== resource.byteLength ||
		resourceDigest(body) !== resource.sha256
	)
		throw Error(
			`Image sequence prepared bytes do not match descriptor: ${resource.id}`,
		);
	signal?.throwIfAborted();
	const existing = await store.loadAttachment({
		projectId,
		key: resource.attachmentKey,
		signal,
	});
	signal?.throwIfAborted();
	if (existing) assertSequenceAttachment({ attachment: existing, resource });
	else
		await store.saveAttachment({
			projectId,
			key: resource.attachmentKey,
			signal,
			body,
			metadata: {
				kind: "programmatic-resource",
				version: 1,
				mimeType: resource.mimeType,
				byteLength: resource.byteLength,
				sha256: resource.sha256,
			},
		});
	await loadImageSequenceResource({ store, projectId, resource, signal });
	return { resource, reused: existing !== null };
}

/** Hash archived files in declared part order without joining their buffers. */
export async function verifyImageSequenceSourceFiles({
	manifest,
	read,
	signal,
}: {
	manifest: ImageSequenceManifest;
	read: (
		resource: ProgrammaticResource,
	) => Promise<ResolvedProgrammaticResource>;
	signal?: AbortSignal;
}): Promise<void> {
	for (const file of manifest.provenance.sourceFiles) {
		const hash = createHash("sha256");
		let byteLength = 0;
		for (const part of file.parts) {
			signal?.throwIfAborted();
			const loaded = await read(part);
			signal?.throwIfAborted();
			hash.update(new Uint8Array(loaded.body));
			byteLength += loaded.body.byteLength;
		}
		if (byteLength !== file.byteLength || hash.digest("hex") !== file.sha256)
			throw Error(
				`Image sequence source archive integrity mismatch: ${file.path}`,
			);
	}
}

/** Full integrity admission on reopen/restore; result retains descriptors, not frame bodies. */
export async function loadImageSequenceClosure({
	resource,
	signal,
	...context
}: ProgrammaticResourceStore & {
	resource: ProgrammaticResource;
	signal?: AbortSignal;
}): Promise<
	ImageSequenceManifestValidation & { resource: ProgrammaticResource }
> {
	if (
		resource.kind !== "imageSequence" ||
		resource.mimeType !== IMAGE_SEQUENCE_MIME
	)
		throw Error("Expected an image sequence manifest resource");
	const loaded = await loadImageSequenceResource({
		...context,
		resource,
		signal,
	});
	const validation = parseImageSequenceManifest(loaded.body);
	const read = (dependency: ProgrammaticResource) =>
		loadImageSequenceResource({ ...context, resource: dependency, signal });
	for (const dependency of validation.dependencies) {
		signal?.throwIfAborted();
		const loaded = await read(dependency);
		if (dependency.kind === "image")
			validateImageSequenceFrame({ loaded, manifest: validation.manifest });
	}
	await verifyImageSequenceSourceFiles({
		manifest: validation.manifest,
		read,
		signal,
	});
	return { ...validation, resource };
}
