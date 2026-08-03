import type {
	LogRecord,
	ProjectStore,
	ProjectStoreInspection,
} from "@/editor/ports";

export type StorageProviderOperation =
	| "initialize"
	| "inspect"
	| "clear-projects"
	| "clear-all";

export const STORAGE_FAILURE_MESSAGE =
	"Storage is unavailable. Retry the operation.";

export function buildStorageFailureRecord({
	operation,
	error,
}: {
	operation: StorageProviderOperation;
	error?: unknown;
}): LogRecord {
	return {
		level: "error",
		message: "Durable editor storage operation failed",
		context: {
			operation,
			scope: "store",
			code: readFailureCode(error),
		},
	};
}

export async function runStorageClear({
	store,
	scope,
	reloadProjects,
}: {
	store: Pick<ProjectStore, "clear" | "inspect">;
	scope: "projects" | "all";
	reloadProjects: () => Promise<void>;
}): Promise<ProjectStoreInspection> {
	await store.clear({ scope: { kind: scope } });
	await reloadProjects();
	return store.inspect();
}

function readFailureCode(error: unknown): string {
	if (typeof error !== "object" || error === null || !("code" in error)) {
		return "unknown";
	}
	switch (error.code) {
		case "aborted":
		case "quota-exceeded":
		case "unavailable":
		case "corrupt":
		case "conflict":
			return error.code;
		default:
			return "unknown";
	}
}
