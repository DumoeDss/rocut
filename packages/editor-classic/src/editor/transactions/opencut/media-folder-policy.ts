import type {
	MediaFolderMutation,
	TransactionOperation,
} from "@opencut/editor-contracts";
import type {
	TransactionEngineDocument,
	TransactionEngineIssue,
} from "@opencut/editor-contracts/engine";
import * as native from "opencut-wasm";
import { parseEditingIssues } from "./scene-policy";

function nativeFunction(name: string): ((input: string) => string) | undefined {
	const candidate: unknown = Reflect.get(native, name);
	if (typeof candidate !== "function") return undefined;
	return (input: string) => {
		const result: unknown = candidate(input);
		if (typeof result !== "string")
			throw new Error("Invalid native media folder response");
		return result;
	};
}

export function isMediaFolderEditingAvailable(): boolean {
	return (
		!!nativeFunction("planMediaFolderMutationJson") &&
		!!nativeFunction("validateMediaFoldersJson")
	);
}

export function planMediaFolderMutation({
	document,
	operation,
}: {
	document: Pick<TransactionEngineDocument, "project" | "assets">;
	operation: MediaFolderMutation;
}): readonly TransactionOperation[] {
	const planner = nativeFunction("planMediaFolderMutationJson");
	if (!planner || !document.project)
		throw new Error("Native media folder editing is unavailable");
	const result: unknown = JSON.parse(
		planner(
			JSON.stringify({
				projectId: document.project.id,
				mediaFolders: document.project.mediaFolders,
				assetIds: document.assets.map((asset) => asset.id),
				operation,
			}),
		),
	);
	if (!result || typeof result !== "object")
		throw new Error("Invalid native media folder plan");
	if ("error" in result) throw new Error(String(result.error));
	if (!("operations" in result) || !Array.isArray(result.operations))
		throw new Error("Missing native media folder plan");
	// eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- Rust emits the operation union; the transaction engine independently validates it before publication.
	return result.operations as TransactionOperation[];
}

export function validateMediaFolders({
	document,
}: {
	document: TransactionEngineDocument;
}): TransactionEngineIssue[] {
	if (!document.project?.mediaFolders) return [];
	const validate = nativeFunction("validateMediaFoldersJson");
	if (!validate)
		return [
			{
				code: "provider:media-folders",
				message: "Native media folder validation is unavailable",
			},
		];
	return parseEditingIssues(
		validate(
			JSON.stringify({
				projectId: document.project.id,
				mediaFolders: document.project.mediaFolders,
				assetIds: document.assets.map((asset) => asset.id),
			}),
		),
	).map((issue) => ({
		code: "provider:media-folders",
		message: `${issue.path}: ${issue.message}`,
		entityIds: [document.project!.id],
	}));
}
