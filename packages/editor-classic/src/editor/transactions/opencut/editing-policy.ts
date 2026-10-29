import type {
	TransactionEngineDocument,
	TransactionEngineIssue,
	TransactionPlacementPolicy,
} from "@opencut/editor-contracts/engine";
import {
	validateClipEditingJson,
	validateMasterEffectsJson,
} from "opencut-wasm";
import { editingCatalog } from "./editing-catalog";
import { validateMediaFolders } from "./media-folder-policy";
import { validateMusicGridState } from "./music-grid";
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
	sceneIssues.push(...validateMediaFolders({ document }));
	sceneIssues.push(...validateMusicGridState({ document }));
	const project = document.project;
	const tracks = new Map(document.tracks.map((track) => [track.id, track]));
	const assets = new Map(document.assets.map((asset) => [asset.id, asset]));
	const candidates = document.clips.filter(
		(clip) =>
			clip.editing && (!ids || ids.has(clip.id) || ids.has(clip.trackId)),
	);
	const hasMaster =
		project?.masterEffects !== undefined &&
		(!Array.isArray(project.masterEffects) || project.masterEffects.length > 0);
	if (!candidates.length && !hasMaster) return sceneIssues;
	const catalog = editingCatalog();
	if (project && hasMaster) {
		sceneIssues.push(
			...parseEditingIssues(
				validateMasterEffectsJson(
					JSON.stringify({
						effects: project.masterEffects,
						catalog: catalog.effects,
					}),
				),
			).map((issue) => ({
				code: "provider:master-effects" as const,
				message: `${issue.path}: ${issue.message}`,
				entityIds: [project.id],
			})),
		);
	}
	if (!candidates.length) return sceneIssues;
	return [
		...sceneIssues,
		...candidates.flatMap((clip) => {
			const issues = parseEditingIssues(
				validateClipEditingJson(
					JSON.stringify({
						editing: clip.editing,
						duration: clip.duration,
						trimStart: clip.trimStart,
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
	validatesMusicGrids: true,
	validatesMediaFolders: true,
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
