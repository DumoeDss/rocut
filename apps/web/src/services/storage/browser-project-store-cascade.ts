import type { ProjectStoreErrorScope } from "@/editor/ports";
import {
	cloneBrowserValue,
	isRecord,
	randomInternalName,
} from "./browser-project-store-internals";
import { browserProjectTopologyStoreNames } from "./browser-project-store-topology";
import type { MediaClearTarget } from "./browser-project-store-media-ownership";
import {
	decodeLibraryClearTarget,
	type LibraryClearTargetV1,
} from "./browser-project-store-library-clear-bindings";

const CASCADE_ENVELOPE_KEY = "__opencutProjectCascade";
const CLEAR_JOURNAL_PREFIX = ".c5-project-clear-";
const PROJECT_TOMBSTONE_PREFIX = ".c5-project-tombstone:";

interface CascadeEnvelopeV1 {
	readonly revision: 1;
	readonly kind: "project-tombstone" | "clear-journal";
	readonly operation: "remove-project" | "clear";
	readonly scope: ProjectStoreErrorScope;
	readonly databases: readonly string[];
	readonly directories: readonly string[];
	readonly clearLibrary: boolean;
}

interface CascadeEnvelopeV2 {
	readonly revision: 2;
	readonly kind: "clear-journal";
	readonly operation: "clear";
	readonly scope: { readonly kind: "store" };
	readonly targets: readonly MediaClearTarget[];
	readonly clearLibrary: boolean;
}

interface CascadeEnvelopeV3 {
	readonly revision: 3;
	readonly kind: "clear-journal";
	readonly operation: "clear";
	readonly scope: { readonly kind: "store" };
	readonly clearScope: "projects" | "all";
	readonly targets: {
		readonly media: readonly MediaClearTarget[];
		readonly library: readonly LibraryClearTargetV1[];
	};
}

export type CascadeEnvelope =
	| CascadeEnvelopeV1
	| CascadeEnvelopeV2
	| CascadeEnvelopeV3;

export interface CascadeCleanupRecord {
	readonly id: string;
	readonly envelope: CascadeEnvelope;
}

export function createProjectTombstone(args: {
	projectId: string;
	operation: "remove-project" | "clear";
	databases?: readonly string[];
	directories?: readonly string[];
}): Record<string, unknown> {
	return createRecord({
		id: projectTombstoneKey(args.projectId),
		envelope: {
			revision: 1,
			kind: "project-tombstone",
			operation: args.operation,
			scope: { kind: "project", projectId: args.projectId },
			databases: args.databases ?? [],
			directories: args.directories ?? [],
			clearLibrary: false,
		},
	});
}

export function createClearJournal(args: {
	id?: string;
	clearScope: "projects" | "all";
	mediaTargets: readonly MediaClearTarget[];
	libraryTargets: readonly LibraryClearTargetV1[];
}): Record<string, unknown> {
	return createRecord({
		id: args.id ?? randomInternalName(CLEAR_JOURNAL_PREFIX),
		envelope: {
			revision: 3,
			kind: "clear-journal",
			operation: "clear",
			scope: { kind: "store" },
			clearScope: args.clearScope,
			targets: {
				media: args.mediaTargets,
				library: args.libraryTargets,
			},
		},
	});
}

export function completeProjectTombstone(
	record: CascadeCleanupRecord,
): Record<string, unknown> {
	if (
		record.envelope.revision !== 1 ||
		record.envelope.kind !== "project-tombstone" ||
		record.envelope.scope.kind !== "project"
	) {
		throw new TypeError("Project tombstone is missing its project scope");
	}
	return createProjectTombstone({
		projectId: record.envelope.scope.projectId,
		operation: record.envelope.operation,
	});
}

export function decodeCascadeCleanupRecord(
	value: unknown,
): CascadeCleanupRecord | null {
	if (!isRecord(value) || typeof value.id !== "string") return null;
	const envelope = value[CASCADE_ENVELOPE_KEY];
	if (!isRecord(envelope)) return null;
	if (envelope.revision === 1)
		return decodeRevision1({ id: value.id, envelope });
	if (envelope.revision === 2)
		return decodeRevision2({ value, id: value.id, envelope });
	if (envelope.revision === 3)
		return decodeRevision3({ value, id: value.id, envelope });
	return null;
}

export function cascadeMaintenanceStoreName(projectsStore: string): string {
	return browserProjectTopologyStoreNames(projectsStore).cascade;
}

export function projectTombstoneKey(projectId: string): string {
	return `${PROJECT_TOMBSTONE_PREFIX}${encodeURIComponent(projectId)}`;
}

function decodeRevision1(args: {
	id: string;
	envelope: Record<string, unknown>;
}): CascadeCleanupRecord | null {
	const { id, envelope } = args;
	if (
		(envelope.kind !== "project-tombstone" &&
			envelope.kind !== "clear-journal") ||
		(envelope.operation !== "remove-project" &&
			envelope.operation !== "clear") ||
		!isScope(envelope.scope) ||
		!isStringArray(envelope.databases) ||
		!isStringArray(envelope.directories) ||
		typeof envelope.clearLibrary !== "boolean"
	) {
		return null;
	}
	if (
		(envelope.kind === "project-tombstone" &&
			(envelope.scope.kind !== "project" ||
				projectTombstoneKey(envelope.scope.projectId) !== id)) ||
		(envelope.kind === "clear-journal" &&
			(!id.startsWith(CLEAR_JOURNAL_PREFIX) || envelope.scope.kind !== "store"))
	) {
		return null;
	}
	return cloneBrowserValue({
		value: {
			id,
			envelope: {
				revision: 1,
				kind: envelope.kind,
				operation: envelope.operation,
				scope: envelope.scope,
				databases: envelope.databases,
				directories: envelope.directories,
				clearLibrary: envelope.clearLibrary,
			},
		},
		operation: envelope.operation,
		scope: envelope.scope,
	});
}

function decodeRevision2(args: {
	value: Record<string, unknown>;
	id: string;
	envelope: Record<string, unknown>;
}): CascadeCleanupRecord | null {
	const { value, id, envelope } = args;
	if (
		!hasExactKeys({ value, expected: ["id", CASCADE_ENVELOPE_KEY] }) ||
		!hasExactKeys({
			value: envelope,
			expected: [
				"revision",
				"kind",
				"operation",
				"scope",
				"targets",
				"clearLibrary",
			],
		}) ||
		envelope.kind !== "clear-journal" ||
		envelope.operation !== "clear" ||
		!isExactStoreScope(envelope.scope) ||
		!Array.isArray(envelope.targets) ||
		typeof envelope.clearLibrary !== "boolean" ||
		!id.startsWith(CLEAR_JOURNAL_PREFIX)
	) {
		return null;
	}
	const targets: MediaClearTarget[] = [];
	const targetKeys = new Set<string>();
	for (const target of envelope.targets) {
		const decoded = decodeTarget(target);
		if (!decoded) return null;
		const key = JSON.stringify([
			decoded.fingerprint,
			decoded.projectId,
			decoded.database,
			decoded.directory,
		]);
		if (targetKeys.has(key)) return null;
		targetKeys.add(key);
		targets.push(decoded);
	}
	return cloneBrowserValue({
		value: {
			id,
			envelope: {
				revision: 2,
				kind: "clear-journal",
				operation: "clear",
				scope: { kind: "store" },
				targets,
				clearLibrary: envelope.clearLibrary,
			},
		},
		operation: "clear",
		scope: { kind: "store" },
	});
}

function decodeRevision3(args: {
	value: Record<string, unknown>;
	id: string;
	envelope: Record<string, unknown>;
}): CascadeCleanupRecord | null {
	const { value, id, envelope } = args;
	if (
		!hasExactKeys({ value, expected: ["id", CASCADE_ENVELOPE_KEY] }) ||
		!hasExactKeys({
			value: envelope,
			expected: [
				"revision",
				"kind",
				"operation",
				"scope",
				"clearScope",
				"targets",
			],
		}) ||
		envelope.kind !== "clear-journal" ||
		envelope.operation !== "clear" ||
		(envelope.clearScope !== "projects" && envelope.clearScope !== "all") ||
		!isExactStoreScope(envelope.scope) ||
		!isRecord(envelope.targets) ||
		!hasExactKeys({
			value: envelope.targets,
			expected: ["media", "library"],
		}) ||
		!Array.isArray(envelope.targets.media) ||
		!Array.isArray(envelope.targets.library) ||
		!id.startsWith(CLEAR_JOURNAL_PREFIX)
	) {
		return null;
	}
	const media = decodeMediaTargets(envelope.targets.media);
	const library = decodeLibraryTargets(envelope.targets.library);
	if (
		!media ||
		!library ||
		(envelope.clearScope === "projects" && library.length !== 0) ||
		(envelope.clearScope === "all" && library.length !== 1)
	) {
		return null;
	}
	return cloneBrowserValue({
		value: {
			id,
			envelope: {
				revision: 3,
				kind: "clear-journal",
				operation: "clear",
				scope: { kind: "store" },
				clearScope: envelope.clearScope,
				targets: { media, library },
			},
		},
		operation: "clear",
		scope: { kind: "store" },
	});
}

function decodeMediaTargets(
	value: readonly unknown[],
): MediaClearTarget[] | null {
	const targets: MediaClearTarget[] = [];
	const targetKeys = new Set<string>();
	for (const target of value) {
		const decoded = decodeTarget(target);
		if (!decoded) return null;
		const key = JSON.stringify([
			decoded.fingerprint,
			decoded.projectId,
			decoded.database,
			decoded.directory,
		]);
		if (targetKeys.has(key)) return null;
		targetKeys.add(key);
		targets.push(decoded);
	}
	return targets;
}

function decodeLibraryTargets(
	value: readonly unknown[],
): LibraryClearTargetV1[] | null {
	const targets: LibraryClearTargetV1[] = [];
	const targetKeys = new Set<string>();
	for (const target of value) {
		const decoded = decodeLibraryClearTarget(target);
		if (!decoded) return null;
		const key = JSON.stringify([
			decoded.fingerprint,
			decoded.database,
			decoded.store,
		]);
		if (targetKeys.has(key)) return null;
		targetKeys.add(key);
		targets.push(decoded);
	}
	return targets;
}

function decodeTarget(value: unknown): MediaClearTarget | null {
	if (
		!isRecord(value) ||
		!hasExactKeys({
			value,
			expected: ["fingerprint", "projectId", "database", "directory"],
		}) ||
		!isNonEmptyString(value.fingerprint) ||
		!isNonEmptyString(value.projectId) ||
		!isNonEmptyString(value.database) ||
		!isNonEmptyString(value.directory)
	) {
		return null;
	}
	return {
		fingerprint: value.fingerprint,
		projectId: value.projectId,
		database: value.database,
		directory: value.directory,
	};
}

function createRecord(args: CascadeCleanupRecord): Record<string, unknown> {
	return {
		id: args.id,
		[CASCADE_ENVELOPE_KEY]: cloneBrowserValue({
			value: args.envelope,
			operation: args.envelope.operation,
			scope: args.envelope.scope,
		}),
	};
}

function isStringArray(value: unknown): value is string[] {
	return (
		Array.isArray(value) && value.every((item) => typeof item === "string")
	);
}

function isScope(value: unknown): value is ProjectStoreErrorScope {
	if (!isRecord(value) || typeof value.kind !== "string") return false;
	switch (value.kind) {
		case "store":
			return true;
		case "project":
			return typeof value.projectId === "string";
		default:
			return false;
	}
}

function isExactStoreScope(value: unknown): value is { kind: "store" } {
	return (
		isRecord(value) &&
		hasExactKeys({ value, expected: ["kind"] }) &&
		value.kind === "store"
	);
}

function hasExactKeys(args: {
	value: Record<string, unknown>;
	expected: readonly string[];
}): boolean {
	const actual = Object.keys(args.value).sort();
	return (
		actual.length === args.expected.length &&
		[...args.expected].sort().every((key, index) => actual[index] === key)
	);
}

function isNonEmptyString(value: unknown): value is string {
	return typeof value === "string" && value.length > 0;
}
