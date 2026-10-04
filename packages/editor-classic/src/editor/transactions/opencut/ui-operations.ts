import type { TransactionOperation } from "@opencut/editor-contracts";
import type { TransactionEngineDocument } from "@opencut/editor-contracts/engine";
import { digestOpenCutProject } from "./adapter";
import { diffOpenCutProjection, OpenCutProjectionError } from "./projection";
import type { OpenCutProjectDraft } from "./types";

/** Only for staged UI drafts, never for public/API transaction batches. */
export function diffOpenCutUiDraft({
	before,
	after,
	beforeDraft,
	afterDraft,
}: {
	before: TransactionEngineDocument;
	after: TransactionEngineDocument;
	beforeDraft: OpenCutProjectDraft;
	afterDraft: OpenCutProjectDraft;
}): TransactionOperation[] {
	try {
		return diffOpenCutProjection({ before, after });
	} catch (error) {
		if (!(error instanceof OpenCutProjectionError) || error.code !== "empty") {
			throw error;
		}
		if (
			!after.project ||
			digestOpenCutProject(beforeDraft) === digestOpenCutProject(afterDraft)
		) {
			throw error;
		}
		// A staged donor change (params, masks, effects, track mute, etc.) is not
		// necessarily represented in the public timeline projection. The contract
		// explicitly accepts a same-value project patch as one revision. Use it to
		// bind the opaque candidate to the normal guarded save/publication receipt;
		// do not bypass the engine, synthesize a geometry edit, or accept empty API
		// batches. The adapter still verifies token, base digest and projection.
		return [
			{
				kind: "update-project",
				projectId: after.project.id,
				patch: { name: after.project.name },
			},
		];
	}
}
