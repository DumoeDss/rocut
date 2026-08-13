import type { ProjectId, ProjectRecord, ProjectSummary } from "@/editor/ports";
import { ProjectStoreError } from "@/editor/ports";
import { validateTransactionDocument } from "./invariant";
import type { TransactionEngineDocument } from "./types";

export interface TransactionDocumentAdapter {
	decode(args: {
		readonly projectId: ProjectId;
		readonly record: ProjectRecord;
	}): TransactionEngineDocument;
	encode(args: {
		readonly projectId: ProjectId;
		readonly previousRecord: ProjectRecord;
		readonly document: TransactionEngineDocument;
	}): {
		readonly record: ProjectRecord;
		readonly summary: ProjectSummary;
	};
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isNonNegativeInteger(value: unknown): value is number {
	return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function corrupt(projectId: ProjectId): ProjectStoreError {
	return new ProjectStoreError({
		code: "corrupt",
		operation: "load-project",
		scope: { kind: "project", projectId },
		message: "The persisted transaction document is invalid",
	});
}

export function assertDecodedTransactionDocument(args: {
	readonly projectId: ProjectId;
	readonly record: ProjectRecord;
	readonly document: TransactionEngineDocument;
}): void {
	const { projectId, record, document } = args;
	if (
		record.id !== projectId ||
		!isNonNegativeInteger(record.schemaVersion) ||
		!isRecord(document) ||
		!isNonNegativeInteger(document.revision) ||
		!Array.isArray(document.tracks) ||
		!Array.isArray(document.clips) ||
		!Array.isArray(document.assets) ||
		!Array.isArray(document.markers) ||
		!Array.isArray(document.idempotency)
	) {
		throw corrupt(projectId);
	}
	if (validateTransactionDocument({ projectId, document }).length > 0) {
		throw corrupt(projectId);
	}
}

export function assertEncodedTransactionDocument(args: {
	readonly projectId: ProjectId;
	readonly encoded: {
		readonly record: ProjectRecord;
		readonly summary: ProjectSummary;
	};
	readonly documentAdapter: TransactionDocumentAdapter;
}): void {
	if (
		args.encoded.record.id !== args.projectId ||
		args.encoded.summary.id !== args.projectId ||
		args.encoded.record.id !== args.encoded.summary.id
	) {
		throw new ProjectStoreError({
			code: "conflict",
			operation: "save-project",
			scope: { kind: "project", projectId: args.projectId },
			message: "The transaction adapter returned mismatched project identities",
		});
	}
	try {
		const document = args.documentAdapter.decode({
			projectId: args.projectId,
			record: args.encoded.record,
		});
		assertDecodedTransactionDocument({
			projectId: args.projectId,
			record: args.encoded.record,
			document,
		});
	} catch {
		throw new ProjectStoreError({
			code: "corrupt",
			operation: "save-project",
			scope: { kind: "project", projectId: args.projectId },
			message:
				"The transaction adapter could not encode a reopenable replacement",
		});
	}
}

export function normalizeDecodeFailure(args: {
	readonly projectId: ProjectId;
	readonly error: unknown;
}): ProjectStoreError {
	if (
		args.error instanceof ProjectStoreError &&
		args.error.code === "corrupt" &&
		args.error.operation === "load-project"
	) {
		return args.error;
	}
	return corrupt(args.projectId);
}
