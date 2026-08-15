import type {
	LibraryRecord,
	ProjectAttachment,
	ProjectRecord,
	ProjectSummary,
} from "@opencut/editor-ports";
import { ProjectStoreError } from "@opencut/editor-ports";
import {
	ATTACHMENT_ENVELOPE_KEY,
	LIBRARY_ENVELOPE_KEY,
	PROJECT_ENVELOPE_KEY,
	cloneBrowserValue,
	encodeLibraryKey,
	isRecord,
} from "./browser-project-store-internals";

interface ProjectEnvelope {
	readonly revision: 1;
	readonly record: ProjectRecord;
	readonly summary: ProjectSummary;
}

interface ProjectAuthorityV1 extends Record<string, unknown> {
	readonly id: string;
	readonly revision: 1;
	readonly schemaVersion: number;
	readonly summary: ProjectSummary;
	readonly payload:
		| { readonly kind: "project-row"; readonly hadOwnRootId: false }
		| {
				readonly kind: "project-row";
				readonly hadOwnRootId: true;
				readonly rootId: unknown;
		  }
		| { readonly kind: "opaque"; readonly data: unknown };
}

interface AttachmentEnvelopeV2 {
	readonly revision: 2;
	readonly kind: "attachment";
	readonly projectId: string;
	readonly key: string;
	readonly metadata: unknown;
	readonly bodyKey: string;
	readonly mutationId: string;
	readonly bodyDigest: string;
	readonly byteLength: number;
}

interface AttachmentTombstoneEnvelopeV2 {
	readonly revision: 2;
	readonly kind: "deleted";
	readonly projectId: string;
	readonly key: string;
	readonly mutationId: string;
}

interface AttachmentAuthorityV1 extends Record<string, unknown> {
	readonly id: string;
	readonly revision: 1;
	readonly kind: "attachment";
	readonly projectId: string;
	readonly key: string;
	readonly metadata: unknown;
	readonly bodyKey: string;
	readonly mutationId: string;
	readonly bodyDigest: string;
	readonly byteLength: number;
	readonly retiredBodyKeys?: readonly string[];
}

interface AttachmentTombstoneAuthorityV1 extends Record<string, unknown> {
	readonly id: string;
	readonly revision: 1;
	readonly kind: "deleted";
	readonly projectId: string;
	readonly key: string;
	readonly mutationId: string;
	readonly retiredBodyKeys?: readonly string[];
}

export interface CurrentStoredRecordPair {
	readonly publicRow: Record<string, unknown> | null;
	readonly authorityRow: Record<string, unknown>;
}

export interface DecodedStoredAttachment extends Omit<
	ProjectAttachment,
	"body"
> {
	readonly kind: "attachment";
	readonly bodyKey: string;
	readonly revision: "current" | "legacy" | 1 | 2;
	readonly mutationId: string | null;
	readonly bodyDigest: string | null;
	readonly byteLength: number | null;
	readonly retiredBodyKeys: readonly string[];
}

export interface DecodedStoredAttachmentTombstone {
	readonly kind: "tombstone";
	readonly projectId: string;
	readonly key: string;
	readonly revision: "current" | 2;
	readonly mutationId: string;
	readonly retiredBodyKeys: readonly string[];
}

export type DecodedStoredAttachmentRecord =
	| DecodedStoredAttachment
	| DecodedStoredAttachmentTombstone;

interface LibraryEnvelope {
	readonly revision: 1;
	readonly namespace: string;
	readonly key: string;
	readonly schemaVersion: number;
	readonly data: unknown;
}

export function projectIdFromStored(value: unknown): string | null {
	if (!isRecord(value)) return null;
	if (typeof value.id === "string" && value.id.length > 0) return value.id;
	return isRecord(value.metadata) && typeof value.metadata.id === "string"
		? value.metadata.id
		: null;
}

export function projectVersionFromStored(value: unknown): number {
	if (!isRecord(value)) return 0;
	const envelope = value[PROJECT_ENVELOPE_KEY];
	if (
		isRecord(envelope) &&
		isRecord(envelope.record) &&
		typeof envelope.record.schemaVersion === "number"
	) {
		return envelope.record.schemaVersion;
	}
	if (typeof value.version === "number") return value.version;
	return Array.isArray(value.scenes) && value.scenes.length > 0 ? 1 : 0;
}

export function createCurrentStoredProject(args: {
	record: ProjectRecord;
	summary: ProjectSummary;
}): CurrentStoredRecordPair {
	const scope = { kind: "project", projectId: args.record.id } as const;
	if (args.record.id !== args.summary.id) {
		throw new ProjectStoreError({
			code: "conflict",
			operation: "save-project",
			scope,
			message: "Project record and summary identities do not match",
		});
	}
	const record = cloneBrowserValue({
		value: args.record,
		operation: "save-project",
		scope,
	});
	const summary = strictProjectSummary({
		value: cloneBrowserValue({
			value: args.summary,
			operation: "save-project",
			scope,
		}),
		id: record.id,
	});
	if (
		record.id.length === 0 ||
		!Number.isFinite(record.schemaVersion) ||
		summary === null
	) {
		throw new ProjectStoreError({
			code: "corrupt",
			operation: "save-project",
			scope,
			message: "Project store save-project received an invalid record",
		});
	}

	let publicRow: Record<string, unknown>;
	let payload: ProjectAuthorityV1["payload"];
	if (isPlainRecord(record.data)) {
		const data = cloneBrowserValue({
			value: record.data,
			operation: "save-project",
			scope,
		});
		const hadOwnRootId = Object.hasOwn(data, "id");
		publicRow = { ...data, id: record.id };
		payload = hadOwnRootId
			? {
					kind: "project-row",
					hadOwnRootId: true,
					rootId: cloneBrowserValue({
						value: data.id,
						operation: "save-project",
						scope,
					}),
				}
			: { kind: "project-row", hadOwnRootId: false };
	} else {
		publicRow = { id: record.id };
		payload = {
			kind: "opaque",
			data: cloneBrowserValue({
				value: record.data,
				operation: "save-project",
				scope,
			}),
		};
	}

	const authorityRow: ProjectAuthorityV1 = {
		id: record.id,
		revision: 1,
		schemaVersion: record.schemaVersion,
		summary,
		payload,
	};
	return { publicRow, authorityRow };
}

export function decodeStoredProjectPair(args: {
	publicRow: unknown | null;
	authorityRow: unknown | null;
}): { record: ProjectRecord; summary: ProjectSummary } | null {
	if (args.authorityRow === null) {
		return args.publicRow === null ? null : decodeStoredProject(args.publicRow);
	}
	if (!isPlainRecord(args.publicRow)) return null;
	const authority = decodeProjectAuthority(args.authorityRow);
	if (
		authority === null ||
		typeof args.publicRow.id !== "string" ||
		args.publicRow.id !== authority.id
	) {
		return null;
	}
	const scope = { kind: "project", projectId: authority.id } as const;
	let data: unknown;
	if (authority.payload.kind === "opaque") {
		if (!hasExactKeys({ value: args.publicRow, keys: ["id"] })) return null;
		data = authority.payload.data;
	} else {
		const projected = cloneBrowserValue({
			value: args.publicRow,
			operation: "load-project",
			scope,
		});
		delete projected.id;
		if (authority.payload.hadOwnRootId) {
			projected.id = authority.payload.rootId;
		}
		data = projected;
	}
	return cloneBrowserValue({
		value: {
			record: {
				id: authority.id,
				schemaVersion: authority.schemaVersion,
				data,
			},
			summary: authority.summary,
		},
		operation: "load-project",
		scope,
	});
}

export function createStoredProject(args: {
	record: ProjectRecord;
	summary: ProjectSummary;
}): Record<string, unknown> {
	const scope = { kind: "project", projectId: args.record.id } as const;
	const record = cloneBrowserValue({
		value: args.record,
		operation: "save-project",
		scope,
	});
	const summary = cloneBrowserValue({
		value: args.summary,
		operation: "save-project",
		scope,
	});
	const compatibility = isRecord(record.data)
		? cloneBrowserValue({
				value: record.data,
				operation: "save-project",
				scope,
			})
		: {};
	const envelope: ProjectEnvelope = { revision: 1, record, summary };
	return {
		...compatibility,
		id: record.id,
		[PROJECT_ENVELOPE_KEY]: envelope,
	};
}

export function decodeStoredProject(value: unknown): {
	record: ProjectRecord;
	summary: ProjectSummary;
} | null {
	if (!isRecord(value)) return null;
	const id = projectIdFromStored(value);
	if (!id) return null;
	const scope = { kind: "project", projectId: id } as const;
	if (Object.hasOwn(value, PROJECT_ENVELOPE_KEY)) {
		const decodedEnvelope = decodeProjectEnvelope(value[PROJECT_ENVELOPE_KEY]);
		if (
			!decodedEnvelope ||
			decodedEnvelope.record.id !== id ||
			decodedEnvelope.summary.id !== id
		) {
			return null;
		}
		return cloneBrowserValue({
			value: decodedEnvelope,
			operation: "load-project",
			scope,
		});
	}
	if (!isRecognizedLegacyProject(value)) return null;
	const summary = legacyProjectSummary({ value, id });
	return {
		record: cloneBrowserValue({
			value: {
				id,
				schemaVersion: projectVersionFromStored(value),
				data: value,
			},
			operation: "load-project",
			scope,
		}),
		summary,
	};
}

function isRecognizedLegacyProject(value: Record<string, unknown>): boolean {
	return (
		isRecord(value.metadata) ||
		Array.isArray(value.scenes) ||
		typeof value.version === "number"
	);
}

function decodeProjectEnvelope(value: unknown): {
	record: ProjectRecord;
	summary: ProjectSummary;
} | null {
	if (
		!isRecord(value) ||
		value.revision !== 1 ||
		!isRecord(value.record) ||
		!isRecord(value.summary)
	) {
		return null;
	}
	const { record, summary } = value;
	if (
		typeof record.id !== "string" ||
		typeof record.schemaVersion !== "number" ||
		typeof summary.id !== "string" ||
		typeof summary.name !== "string" ||
		typeof summary.createdAt !== "string" ||
		typeof summary.updatedAt !== "string"
	) {
		return null;
	}
	const thumbnail = summary.thumbnail;
	const thumbnailPath =
		isRecord(thumbnail) && typeof thumbnail.path === "string"
			? thumbnail.path
			: null;
	if (thumbnail !== undefined && thumbnailPath === null) {
		return null;
	}
	return {
		record: {
			id: record.id,
			schemaVersion: record.schemaVersion,
			data: record.data,
		},
		summary: {
			id: summary.id,
			name: summary.name,
			createdAt: summary.createdAt,
			updatedAt: summary.updatedAt,
			...(thumbnailPath === null ? {} : { thumbnail: { path: thumbnailPath } }),
		},
	};
}

function legacyProjectSummary(args: {
	value: Record<string, unknown>;
	id: string;
}): ProjectSummary {
	const metadata = isRecord(args.value.metadata)
		? args.value.metadata
		: args.value;
	const createdAt =
		typeof metadata.createdAt === "string"
			? metadata.createdAt
			: new Date(0).toISOString();
	const updatedAt =
		typeof metadata.updatedAt === "string" ? metadata.updatedAt : createdAt;
	const thumbnail =
		isRecord(metadata.thumbnail) && typeof metadata.thumbnail.path === "string"
			? { path: metadata.thumbnail.path }
			: undefined;
	return cloneBrowserValue({
		value: {
			id: args.id,
			name: typeof metadata.name === "string" ? metadata.name : args.id,
			createdAt,
			updatedAt,
			...(thumbnail ? { thumbnail } : {}),
		},
		operation: "list-projects",
		scope: { kind: "store" },
	});
}

export function createCurrentStoredAttachment(args: {
	projectId: string;
	key: string;
	metadata: unknown;
	bodyKey: string;
	mutationId: string;
	bodyDigest: string;
	byteLength: number;
	retiredBodyKeys?: readonly string[];
}): CurrentStoredRecordPair {
	const scope = {
		kind: "attachment",
		projectId: args.projectId,
		key: args.key,
	} as const;
	const retiredBodyKeys = strictRetiredBodyKeys(args.retiredBodyKeys ?? []);
	if (
		args.projectId.length === 0 ||
		args.key.length === 0 ||
		args.bodyKey.length === 0 ||
		!validMutationId(args.mutationId) ||
		!validBodyDigest(args.bodyDigest) ||
		!isNonNegativeSafeInteger(args.byteLength) ||
		retiredBodyKeys === null ||
		retiredBodyKeys.includes(args.bodyKey)
	) {
		throw new ProjectStoreError({
			code: "corrupt",
			operation: "save-attachment",
			scope,
			message: "Project store save-attachment received an invalid record",
		});
	}
	const metadata = cloneBrowserValue({
		value: args.metadata,
		operation: "save-attachment",
		scope,
	});
	const publicRow = projectCurrentMediaRow({
		key: args.key,
		metadata,
		byteLength: args.byteLength,
	});
	const authorityRow: AttachmentAuthorityV1 = {
		id: args.key,
		revision: 1,
		kind: "attachment",
		projectId: args.projectId,
		key: args.key,
		metadata,
		bodyKey: args.bodyKey,
		mutationId: args.mutationId,
		bodyDigest: args.bodyDigest,
		byteLength: args.byteLength,
		retiredBodyKeys,
	};
	return { publicRow, authorityRow };
}

export function createCurrentStoredAttachmentTombstone(args: {
	projectId: string;
	key: string;
	mutationId: string;
	retiredBodyKeys?: readonly string[];
}): CurrentStoredRecordPair {
	const scope = {
		kind: "attachment",
		projectId: args.projectId,
		key: args.key,
	} as const;
	const retiredBodyKeys = strictRetiredBodyKeys(args.retiredBodyKeys ?? []);
	if (
		args.projectId.length === 0 ||
		args.key.length === 0 ||
		!validMutationId(args.mutationId) ||
		retiredBodyKeys === null
	) {
		throw new ProjectStoreError({
			code: "corrupt",
			operation: "remove-attachment",
			scope,
			message: "Project store remove-attachment received an invalid record",
		});
	}
	const authorityRow: AttachmentTombstoneAuthorityV1 = {
		id: args.key,
		revision: 1,
		kind: "deleted",
		projectId: args.projectId,
		key: args.key,
		mutationId: args.mutationId,
		retiredBodyKeys,
	};
	return { publicRow: null, authorityRow };
}

export function decodeStoredAttachmentPair(args: {
	projectId: string;
	publicRow: unknown | null;
	authorityRow: unknown | null;
}): DecodedStoredAttachmentRecord | null {
	if (args.authorityRow === null) {
		if (args.publicRow === null) return null;
		const decoded = decodeStoredAttachmentRecord({
			projectId: args.projectId,
			value: args.publicRow,
		});
		return decoded === null
			? null
			: cloneBrowserValue({
					value: decoded,
					operation: "load-attachment",
					scope: {
						kind: "attachment",
						projectId: args.projectId,
						key: decoded.key,
					},
				});
	}
	const authority = decodeAttachmentAuthority({
		projectId: args.projectId,
		value: args.authorityRow,
	});
	if (authority === null) return null;
	if (authority.kind === "deleted") {
		return args.publicRow === null
			? {
					kind: "tombstone",
					projectId: authority.projectId,
					key: authority.key,
					revision: "current",
					mutationId: authority.mutationId,
					retiredBodyKeys: authority.retiredBodyKeys ?? [],
				}
			: null;
	}
	if (!isPlainRecord(args.publicRow)) return null;
	const expectedPublicRow = projectCurrentMediaRow({
		key: authority.key,
		metadata: authority.metadata,
		byteLength: authority.byteLength,
	});
	if (!equalExactRecord({ left: args.publicRow, right: expectedPublicRow })) {
		return null;
	}
	return cloneBrowserValue({
		value: {
			kind: "attachment" as const,
			projectId: authority.projectId,
			key: authority.key,
			metadata: authority.metadata,
			bodyKey: authority.bodyKey,
			revision: "current" as const,
			mutationId: authority.mutationId,
			bodyDigest: authority.bodyDigest,
			byteLength: authority.byteLength,
			retiredBodyKeys: authority.retiredBodyKeys ?? [],
		},
		operation: "load-attachment",
		scope: {
			kind: "attachment",
			projectId: authority.projectId,
			key: authority.key,
		},
	});
}

export function createStoredAttachment(args: {
	projectId: string;
	key: string;
	metadata: unknown;
	bodyKey: string;
	mutationId: string;
	bodyDigest: string;
	byteLength: number;
}): Record<string, unknown> {
	const scope = {
		kind: "attachment",
		projectId: args.projectId,
		key: args.key,
	} as const;
	const metadata = cloneBrowserValue({
		value: args.metadata,
		operation: "save-attachment",
		scope,
	});
	const compatibility = isRecord(metadata)
		? cloneBrowserValue({
				value: metadata,
				operation: "save-attachment",
				scope,
			})
		: {};
	const envelope: AttachmentEnvelopeV2 = {
		revision: 2,
		kind: "attachment",
		projectId: args.projectId,
		key: args.key,
		metadata,
		bodyKey: args.bodyKey,
		mutationId: args.mutationId,
		bodyDigest: args.bodyDigest,
		byteLength: args.byteLength,
	};
	return {
		...compatibility,
		id: args.key,
		[ATTACHMENT_ENVELOPE_KEY]: envelope,
	};
}

export function createStoredAttachmentTombstone(args: {
	projectId: string;
	key: string;
	mutationId: string;
}): Record<string, unknown> {
	const envelope: AttachmentTombstoneEnvelopeV2 = {
		revision: 2,
		kind: "deleted",
		projectId: args.projectId,
		key: args.key,
		mutationId: args.mutationId,
	};
	return {
		id: args.key,
		[ATTACHMENT_ENVELOPE_KEY]: envelope,
	};
}

export async function digestAttachmentBody(body: ArrayBuffer): Promise<string> {
	const digest = await crypto.subtle.digest("SHA-256", body);
	return `sha256:${Array.from(new Uint8Array(digest), (byte) =>
		byte.toString(16).padStart(2, "0"),
	).join("")}`;
}

export function decodeStoredAttachment(args: {
	projectId: string;
	value: unknown;
}): DecodedStoredAttachment | null {
	const decoded = decodeStoredAttachmentRecord(args);
	return decoded?.kind === "attachment" ? decoded : null;
}

export function decodeStoredAttachmentRecord(args: {
	projectId: string;
	value: unknown;
}): DecodedStoredAttachmentRecord | null {
	if (!isRecord(args.value) || typeof args.value.id !== "string") return null;
	if (Object.hasOwn(args.value, ATTACHMENT_ENVELOPE_KEY)) {
		const envelope = args.value[ATTACHMENT_ENVELOPE_KEY];
		if (!isRecord(envelope)) return null;
		if (envelope.revision === 1) {
			if (
				envelope.projectId !== args.projectId ||
				envelope.key !== args.value.id ||
				typeof envelope.bodyKey !== "string" ||
				envelope.bodyKey.length === 0
			) {
				return null;
			}
			return {
				kind: "attachment",
				projectId: args.projectId,
				key: args.value.id,
				metadata: envelope.metadata,
				bodyKey: envelope.bodyKey,
				revision: 1,
				mutationId: null,
				bodyDigest: null,
				byteLength: null,
				retiredBodyKeys: [],
			};
		}
		if (
			envelope.revision !== 2 ||
			envelope.projectId !== args.projectId ||
			envelope.key !== args.value.id ||
			!validMutationId(envelope.mutationId)
		) {
			return null;
		}
		if (envelope.kind === "deleted") {
			if (
				!hasExactKeys({
					value: envelope,
					keys: ["revision", "kind", "projectId", "key", "mutationId"],
				})
			) {
				return null;
			}
			return {
				kind: "tombstone",
				projectId: args.projectId,
				key: args.value.id,
				revision: 2,
				mutationId: envelope.mutationId,
				retiredBodyKeys: [],
			};
		}
		if (
			envelope.kind !== "attachment" ||
			typeof envelope.bodyKey !== "string" ||
			envelope.bodyKey.length === 0 ||
			!validBodyDigest(envelope.bodyDigest) ||
			!isNonNegativeSafeInteger(envelope.byteLength)
		) {
			return null;
		}
		return {
			kind: "attachment",
			projectId: args.projectId,
			key: args.value.id,
			metadata: envelope.metadata,
			bodyKey: envelope.bodyKey,
			revision: 2,
			mutationId: envelope.mutationId,
			bodyDigest: envelope.bodyDigest,
			byteLength: envelope.byteLength,
			retiredBodyKeys: [],
		};
	}
	return {
		kind: "attachment",
		projectId: args.projectId,
		key: args.value.id,
		metadata: args.value,
		bodyKey: args.value.id,
		revision: "legacy",
		mutationId: null,
		bodyDigest: null,
		byteLength: null,
		retiredBodyKeys: [],
	};
}

function strictProjectSummary(args: {
	value: unknown;
	id: string;
}): ProjectSummary | null {
	if (!isPlainRecord(args.value)) return null;
	const thumbnailPresent = Object.hasOwn(args.value, "thumbnail");
	const keys = thumbnailPresent
		? ["id", "name", "createdAt", "updatedAt", "thumbnail"]
		: ["id", "name", "createdAt", "updatedAt"];
	if (
		!hasExactKeys({ value: args.value, keys }) ||
		args.value.id !== args.id ||
		typeof args.value.name !== "string" ||
		typeof args.value.createdAt !== "string" ||
		typeof args.value.updatedAt !== "string"
	) {
		return null;
	}
	if (!thumbnailPresent) {
		return {
			id: args.id,
			name: args.value.name,
			createdAt: args.value.createdAt,
			updatedAt: args.value.updatedAt,
		};
	}
	if (
		!isPlainRecord(args.value.thumbnail) ||
		!hasExactKeys({ value: args.value.thumbnail, keys: ["path"] }) ||
		typeof args.value.thumbnail.path !== "string"
	) {
		return null;
	}
	return {
		id: args.id,
		name: args.value.name,
		createdAt: args.value.createdAt,
		updatedAt: args.value.updatedAt,
		thumbnail: { path: args.value.thumbnail.path },
	};
}

function decodeProjectAuthority(value: unknown): ProjectAuthorityV1 | null {
	if (
		!isPlainRecord(value) ||
		!hasExactKeys({
			value,
			keys: ["id", "revision", "schemaVersion", "summary", "payload"],
		}) ||
		typeof value.id !== "string" ||
		value.id.length === 0 ||
		value.revision !== 1 ||
		typeof value.schemaVersion !== "number" ||
		!Number.isFinite(value.schemaVersion) ||
		!isPlainRecord(value.payload)
	) {
		return null;
	}
	const summary = strictProjectSummary({ value: value.summary, id: value.id });
	if (summary === null) return null;
	if (value.payload.kind === "opaque") {
		if (!hasExactKeys({ value: value.payload, keys: ["kind", "data"] })) {
			return null;
		}
		return {
			id: value.id,
			revision: 1,
			schemaVersion: value.schemaVersion,
			summary,
			payload: { kind: "opaque", data: value.payload.data },
		};
	}
	if (
		value.payload.kind !== "project-row" ||
		typeof value.payload.hadOwnRootId !== "boolean"
	) {
		return null;
	}
	if (value.payload.hadOwnRootId) {
		if (
			!hasExactKeys({
				value: value.payload,
				keys: ["kind", "hadOwnRootId", "rootId"],
			})
		) {
			return null;
		}
		return {
			id: value.id,
			revision: 1,
			schemaVersion: value.schemaVersion,
			summary,
			payload: {
				kind: "project-row",
				hadOwnRootId: true,
				rootId: value.payload.rootId,
			},
		};
	}
	if (
		!hasExactKeys({
			value: value.payload,
			keys: ["kind", "hadOwnRootId"],
		})
	) {
		return null;
	}
	return {
		id: value.id,
		revision: 1,
		schemaVersion: value.schemaVersion,
		summary,
		payload: { kind: "project-row", hadOwnRootId: false },
	};
}

function decodeAttachmentAuthority(args: {
	projectId: string;
	value: unknown;
}): AttachmentAuthorityV1 | AttachmentTombstoneAuthorityV1 | null {
	if (
		!isPlainRecord(args.value) ||
		args.value.revision !== 1 ||
		typeof args.value.id !== "string" ||
		args.value.id.length === 0 ||
		args.value.projectId !== args.projectId ||
		typeof args.value.key !== "string" ||
		args.value.key !== args.value.id ||
		!validMutationId(args.value.mutationId)
	) {
		return null;
	}
	if (args.value.kind === "deleted") {
		const retiredBodyKeys = strictRetiredBodyKeys(
			args.value.retiredBodyKeys ?? [],
		);
		if (
			retiredBodyKeys === null ||
			(!hasExactKeys({
				value: args.value,
				keys: ["id", "revision", "kind", "projectId", "key", "mutationId"],
			}) &&
				!hasExactKeys({
					value: args.value,
					keys: [
						"id",
						"revision",
						"kind",
						"projectId",
						"key",
						"mutationId",
						"retiredBodyKeys",
					],
				}))
		) {
			return null;
		}
		return {
			id: args.value.id,
			revision: 1,
			kind: "deleted",
			projectId: args.projectId,
			key: args.value.key,
			mutationId: args.value.mutationId,
			retiredBodyKeys,
		};
	}
	const retiredBodyKeys = strictRetiredBodyKeys(
		args.value.retiredBodyKeys ?? [],
	);
	if (
		args.value.kind !== "attachment" ||
		(!hasExactKeys({
			value: args.value,
			keys: [
				"id",
				"revision",
				"kind",
				"projectId",
				"key",
				"metadata",
				"bodyKey",
				"mutationId",
				"bodyDigest",
				"byteLength",
			],
		}) &&
			!hasExactKeys({
				value: args.value,
				keys: [
					"id",
					"revision",
					"kind",
					"projectId",
					"key",
					"metadata",
					"bodyKey",
					"mutationId",
					"bodyDigest",
					"byteLength",
					"retiredBodyKeys",
				],
			})) ||
		typeof args.value.bodyKey !== "string" ||
		args.value.bodyKey.length === 0 ||
		!validBodyDigest(args.value.bodyDigest) ||
		!isNonNegativeSafeInteger(args.value.byteLength) ||
		retiredBodyKeys === null ||
		retiredBodyKeys.includes(args.value.bodyKey)
	) {
		return null;
	}
	return {
		id: args.value.id,
		revision: 1,
		kind: "attachment",
		projectId: args.projectId,
		key: args.value.key,
		metadata: args.value.metadata,
		bodyKey: args.value.bodyKey,
		mutationId: args.value.mutationId,
		bodyDigest: args.value.bodyDigest,
		byteLength: args.value.byteLength,
		retiredBodyKeys,
	};
}

function projectCurrentMediaRow(args: {
	key: string;
	metadata: unknown;
	byteLength: number;
}): Record<string, unknown> {
	const metadata = currentMediaMetadata({
		value: args.metadata,
		key: args.key,
	});
	if (metadata === null) {
		return { id: args.key };
	}
	return {
		id: args.key,
		name: metadata.name,
		type: metadata.type,
		size: args.byteLength,
		lastModified: metadata.lastModified,
		width: metadata.width,
		height: metadata.height,
		duration: metadata.duration,
		thumbnailUrl: metadata.thumbnailUrl,
		ephemeral: metadata.ephemeral,
	};
}

function currentMediaMetadata(args: { value: unknown; key: string }):
	| (Record<string, unknown> & {
			id: string;
			name: string;
			type: "image" | "video" | "audio";
			lastModified: number;
	  })
	| null {
	const value = args.value;
	if (!isPlainRecord(value)) return null;
	return value.id === args.key &&
		typeof value.name === "string" &&
		(value.type === "image" ||
			value.type === "video" ||
			value.type === "audio") &&
		typeof value.lastModified === "number" &&
		Number.isFinite(value.lastModified) &&
		optionalFiniteNumber(value.width) &&
		optionalFiniteNumber(value.height) &&
		optionalFiniteNumber(value.duration) &&
		optionalString(value.thumbnailUrl) &&
		optionalBoolean(value.ephemeral)
		? {
				...value,
				id: value.id,
				name: value.name,
				type: value.type,
				lastModified: value.lastModified,
			}
		: null;
}

function optionalFiniteNumber(value: unknown): boolean {
	return (
		value === undefined || (typeof value === "number" && Number.isFinite(value))
	);
}

function optionalString(value: unknown): boolean {
	return value === undefined || typeof value === "string";
}

function optionalBoolean(value: unknown): boolean {
	return value === undefined || typeof value === "boolean";
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
	if (!isRecord(value)) return false;
	const prototype: unknown = Object.getPrototypeOf(value);
	return prototype === Object.prototype || prototype === null;
}

function equalExactRecord(args: {
	left: Record<string, unknown>;
	right: Record<string, unknown>;
}): boolean {
	const { left, right } = args;
	const leftKeys = Object.keys(left).sort();
	const rightKeys = Object.keys(right).sort();
	return (
		leftKeys.length === rightKeys.length &&
		leftKeys.every(
			(key, index) =>
				key === rightKeys[index] && Object.is(left[key], right[key]),
		)
	);
}

function validMutationId(value: unknown): value is string {
	return typeof value === "string" && value.length > 0;
}

function validBodyDigest(value: unknown): value is string {
	return typeof value === "string" && /^sha256:[0-9a-f]{64}$/.test(value);
}

function strictRetiredBodyKeys(value: unknown): string[] | null {
	if (!Array.isArray(value)) return null;
	const keys: string[] = [];
	for (const key of value) {
		if (typeof key !== "string" || key.length === 0 || keys.includes(key)) {
			return null;
		}
		keys.push(key);
	}
	return keys;
}

export function isNonNegativeSafeInteger(value: unknown): value is number {
	return Number.isSafeInteger(value) && typeof value === "number" && value >= 0;
}

function hasExactKeys(args: {
	value: Record<string, unknown>;
	keys: readonly string[];
}): boolean {
	const actual = Object.keys(args.value).sort();
	const expected = [...args.keys].sort();
	return (
		actual.length === expected.length &&
		actual.every((key, index) => key === expected[index])
	);
}

export function createStoredLibraryRecord(
	args: LibraryRecord,
): Record<string, unknown> {
	const scope = {
		kind: "library",
		namespace: args.namespace,
		key: args.key,
	} as const;
	const envelope: LibraryEnvelope = cloneBrowserValue({
		value: {
			revision: 1,
			namespace: args.namespace,
			key: args.key,
			schemaVersion: args.schemaVersion,
			data: args.data,
		},
		operation: "save-library-record",
		scope,
	});
	return {
		id: encodeLibraryKey(args),
		[LIBRARY_ENVELOPE_KEY]: envelope,
	};
}

export function decodeStoredLibraryRecord(
	value: unknown,
): LibraryRecord | null {
	if (
		!isRecord(value) ||
		typeof value.id !== "string" ||
		!Object.hasOwn(value, LIBRARY_ENVELOPE_KEY)
	) {
		return null;
	}
	const envelope = value[LIBRARY_ENVELOPE_KEY];
	if (
		!isRecord(envelope) ||
		envelope.revision !== 1 ||
		typeof envelope.namespace !== "string" ||
		typeof envelope.key !== "string" ||
		typeof envelope.schemaVersion !== "number" ||
		value.id !==
			encodeLibraryKey({
				namespace: envelope.namespace,
				key: envelope.key,
			})
	) {
		return null;
	}
	return {
		namespace: envelope.namespace,
		key: envelope.key,
		schemaVersion: envelope.schemaVersion,
		data: envelope.data,
	};
}
