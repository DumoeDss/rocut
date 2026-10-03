import type { ProjectStoreErrorCode } from "@opencut/editor-ports";
import type { TransactionErrorCode } from "@opencut/editor-contracts";

const failureCodes = new Set<string>([
	"aborted",
	"quota-exceeded",
	"unavailable",
	"corrupt",
	"conflict",
	"validation",
	"not-found",
	"duplicate",
	"unsupported",
] satisfies (ProjectStoreErrorCode | TransactionErrorCode)[]);

function isDiagnosticInteger(value: unknown): value is number {
	return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

/** Host diagnostics must not serialize provider messages, paths or project data. */
export function describePersistenceFailure({
	error,
}: {
	error: unknown;
}): Record<string, unknown> {
	if (error === null || typeof error !== "object") return { code: "unknown" };
	const code =
		"code" in error &&
		typeof error.code === "string" &&
		failureCodes.has(error.code)
			? error.code
			: "unknown";
	// Preserve the stable transaction identity and numeric location, not its free-text
	// message. Do not coerce unknown values: even toString() can expose payloads.
	if (!("name" in error) || error.name !== "TransactionError") return { code };
	return {
		code,
		name: "TransactionError",
		...("operationIndex" in error && isDiagnosticInteger(error.operationIndex)
			? { operationIndex: error.operationIndex }
			: {}),
		...("expectedRevision" in error &&
		isDiagnosticInteger(error.expectedRevision)
			? { expectedRevision: error.expectedRevision }
			: {}),
		...("actualRevision" in error && isDiagnosticInteger(error.actualRevision)
			? { actualRevision: error.actualRevision }
			: {}),
	};
}
