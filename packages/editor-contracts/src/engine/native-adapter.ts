import type { Project, Revision } from "..";
import { INITIAL_REVISION, revisionOf } from "..";
import type {
	ProjectId,
	ProjectRecord,
	ProjectSummary,
} from "@opencut/editor-ports";
import { ProjectStoreError } from "@opencut/editor-ports";
import { registerDraftEvidenceErrorType } from "../draft/immutable";
import { cloneTransactionValue } from "./clone";
import type { TransactionDocumentAdapter } from "./adapter";
import { isTransactionEngineDocument } from "./invariant";
import type { TransactionEngineDocument } from "./types";

// This module is the ports-coupled composition zone: it vouches for the store
// error class so committed-state failures keep their prototype across the
// Draft evidence boundary while draft/ stays free of ports imports.
registerDraftEvidenceErrorType(ProjectStoreError);

const DOCUMENT_KEY = "transactionEngine";

interface NativeTransactionData extends Record<string, unknown> {
	readonly transactionEngine: TransactionEngineDocument;
	readonly transactionCreatedAt?: string;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function createTransactionNativeDocumentAdapter(
	options: { readonly now?: () => string } = {},
): TransactionDocumentAdapter {
	const now = options.now ?? (() => new Date().toISOString());
	return {
		decode({ projectId, record }): TransactionEngineDocument {
			if (!isRecord(record.data) || !isRecord(record.data[DOCUMENT_KEY])) {
				throw new TypeError("Missing transaction document");
			}
			const candidate = {
				projectId,
				document: record.data[DOCUMENT_KEY],
			};
			if (!isTransactionEngineDocument(candidate)) {
				throw new TypeError("Invalid transaction document");
			}
			return cloneTransactionValue(candidate.document);
		},
		encode({ projectId, previousRecord, document }) {
			const previous = isRecord(previousRecord.data) ? previousRecord.data : {};
			const timestamp = now();
			const createdAt =
				typeof previous.transactionCreatedAt === "string"
					? previous.transactionCreatedAt
					: timestamp;
			const data: NativeTransactionData = {
				...cloneTransactionValue(previous),
				[DOCUMENT_KEY]: cloneTransactionValue(document),
				transactionCreatedAt: createdAt,
			};
			return {
				record: {
					id: projectId,
					schemaVersion: previousRecord.schemaVersion,
					data,
				},
				summary: {
					id: projectId,
					name: document.project?.name ?? "Untitled project",
					createdAt,
					updatedAt: timestamp,
				},
			};
		},
	};
}

export function createTransactionNativeProjectSeed(args: {
	readonly projectId: ProjectId;
	readonly project?: Project | null;
	readonly schemaVersion?: number;
	readonly revision?: Revision;
	readonly opaque?: Readonly<Record<string, unknown>>;
	readonly now?: string;
}): { readonly record: ProjectRecord; readonly summary: ProjectSummary } {
	const now = args.now ?? "2026-01-01T00:00:00.000Z";
	const project = args.project ?? null;
	const revision = args.revision ?? INITIAL_REVISION;
	const document: TransactionEngineDocument = {
		project,
		tracks: [],
		clips: [],
		assets: [],
		markers: [],
		revision: revisionOf(Number(revision)),
		idempotency: [],
	};
	return {
		record: {
			id: args.projectId,
			schemaVersion: args.schemaVersion ?? 1,
			data: {
				...(args.opaque ?? {}),
				[DOCUMENT_KEY]: cloneTransactionValue(document),
				transactionCreatedAt: now,
			},
		},
		summary: {
			id: args.projectId,
			name: project?.name ?? "Untitled project",
			createdAt: now,
			updatedAt: now,
		},
	};
}
