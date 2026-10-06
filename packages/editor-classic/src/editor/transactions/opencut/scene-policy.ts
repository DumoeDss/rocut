import type { Project, TransactionOperation } from "@opencut/editor-contracts";
import type {
	TransactionEngineDocument,
	TransactionEngineIssue,
} from "@opencut/editor-contracts/engine";
import { planSceneMutationJson, validateSceneStateJson } from "opencut-wasm";

export function parseEditingIssues(
	json: string,
): Array<{ path: string; message: string }> {
	const parsed: unknown = JSON.parse(json);
	if (
		!Array.isArray(parsed) ||
		!parsed.every(
			(issue): issue is { path: string; message: string } =>
				typeof issue === "object" &&
				issue !== null &&
				"path" in issue &&
				typeof issue.path === "string" &&
				"message" in issue &&
				typeof issue.message === "string",
		)
	)
		throw new Error("Invalid Rust editing validation response");
	return parsed;
}

export function validateSceneState({
	document,
	previousProject,
}: {
	document: TransactionEngineDocument;
	previousProject?: Project | null;
}): TransactionEngineIssue[] {
	const sceneState = document.project?.sceneState;
	if (!sceneState)
		return previousProject?.sceneState
			? [
					{
						code: "provider:scene-state",
						message: "Scene topology cannot be cleared",
					},
				]
			: [];
	return parseEditingIssues(
		validateSceneStateJson(
			JSON.stringify({
				sceneState,
				background: document.project?.background,
				previousSceneState: previousProject?.sceneState,
				tracks: document.tracks,
				markers: document.markers,
			}),
		),
	).map((issue) => ({
		code: "provider:scene-state",
		message: `${issue.path}: ${issue.message}`,
		entityIds: document.project ? [document.project.id] : [],
	}));
}

export function planSceneMutation({
	document,
	operation,
}: {
	document: Pick<TransactionEngineDocument, "project" | "tracks" | "markers">;
	operation: unknown;
}): readonly TransactionOperation[] {
	if (!document.project?.sceneState)
		throw new Error("Scene topology is unavailable");
	const result: unknown = JSON.parse(
		planSceneMutationJson(
			JSON.stringify({
				projectId: document.project.id,
				sceneState: document.project.sceneState,
				tracks: document.tracks,
				markers: document.markers,
				operation,
			}),
		),
	);
	if (typeof result !== "object" || result === null)
		throw new Error("Invalid scene planner response");
	if ("error" in result) throw new Error(String(result.error));
	if (!("operations" in result) || !Array.isArray(result.operations))
		throw new Error("Missing scene plan");
	// eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- Rust emits the typed operation union; the transaction evaluator independently validates it before persistence.
	return result.operations as TransactionOperation[];
}
