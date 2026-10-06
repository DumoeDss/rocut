import type {
	TransactionEngineDocument,
	TransactionEngineIssue,
	TransactionPlacementPolicy,
} from "@opencut/editor-contracts/engine";
import { validateClipEditingJson } from "opencut-wasm";
import { editingCatalog } from "./editing-catalog";
import { parseEditingIssues, validateSceneState } from "./scene-policy";
import type { Project } from "@opencut/editor-contracts";

/** Rust owns semantics; this is the contract/provider serialization boundary. */
export function validateDocumentEditing({
	document,
	ids,
	previousProject,
}: {
	document: TransactionEngineDocument;
	ids?: ReadonlySet<string>;
	previousProject?: Project | null;
}): TransactionEngineIssue[] {
	const sceneIssues = validateSceneState({ document, previousProject });
	const tracks = new Map(document.tracks.map((track) => [track.id, track]));
	const assets = new Map(document.assets.map((asset) => [asset.id, asset]));
	const candidates = document.clips.filter(
		(clip) =>
			clip.editing && (!ids || ids.has(clip.id) || ids.has(clip.trackId)),
	);
	if (!candidates.length) return sceneIssues;
	const catalog = editingCatalog();
	return [
		...sceneIssues,
		...candidates.flatMap((clip) => {
			const issues = parseEditingIssues(
				validateClipEditingJson(
					JSON.stringify({
						editing: clip.editing,
						duration: clip.duration,
						trackKind: tracks.get(clip.trackId)?.kind ?? "missing",
						assetKind: clip.assetId
							? assets.get(clip.assetId)?.kind
							: undefined,
						hasMotionText: clip.content?.kind === "motion-text",
						hasAdjustment: clip.adjustment !== undefined,
						catalog,
					}),
				),
			);
			return issues.map((issue) => ({
				code: "provider:clip-editing" as const,
				message: `${issue.path}: ${issue.message}`,
				entityIds: [clip.id],
			}));
		}),
	];
}

export const openCutEditingPolicy: TransactionPlacementPolicy = {
	evaluate(context) {
		const ids = new Set(context.operationIndexByEntityId.keys());
		return validateDocumentEditing({
			document: context.document,
			ids,
			previousProject: context.previousProject,
		}).map((issue) => ({
			...issue,
			operationIndex: context.operationIndexByEntityId.get(
				issue.entityIds?.[0] ?? "",
			),
		}));
	},
};
