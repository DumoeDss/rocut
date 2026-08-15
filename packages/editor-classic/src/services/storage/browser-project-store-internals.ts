import type {
	LogRecord,
	ProjectStoreErrorCode,
	ProjectStoreErrorScope,
	ProjectStoreOperation,
} from "@opencut/editor-ports";
import { ProjectStoreError } from "@opencut/editor-ports";
import { CURRENT_PROJECT_VERSION } from "./migrations";

export const BROWSER_STORE_SCHEMA_VERSION = CURRENT_PROJECT_VERSION;
export const PROJECT_ENVELOPE_KEY = "__opencutProjectStore";
export const ATTACHMENT_ENVELOPE_KEY = "__opencutAttachmentStore";
export const LIBRARY_ENVELOPE_KEY = "__opencutLibraryStore";
export const ATTACHMENT_STAGE_PREFIX = ".c5-stage-";
export const ATTACHMENT_BODY_PREFIX = ".c5-body-";
export const LIBRARY_KEY_PREFIX = "c5-library:";

export function projectAuthorityStoreName(projectsStore: string): string {
	return `${projectsStore}-project-authority`;
}

export function attachmentAuthorityStoreName(mediaStore: string): string {
	return `${mediaStore}-attachment-authority`;
}

export interface BrowserStorageIdentity {
	readonly identity: string;
	readonly projectsDatabase: string;
	readonly projectsStore: string;
	readonly mediaDatabasePrefix: string;
	readonly mediaStore: string;
	readonly libraryDatabase: string;
	readonly libraryStore: string;
	readonly mediaDirectoryPrefix: string;
}

export interface BrowserMediaBinding {
	readonly revision: 1;
	readonly mediaDatabasePrefix: string;
	readonly mediaStore: string;
	readonly mediaDirectoryPrefix: string;
}

export interface BrowserStoreDiagnostic {
	readonly level: "info" | "warning" | "error";
	readonly phase: string;
	readonly operation?: ProjectStoreOperation;
	readonly scope?: ProjectStoreErrorScope;
	readonly code?: ProjectStoreErrorCode;
	readonly retryable?: boolean;
}

export function browserStoreDiagnosticLogRecord(
	diagnostic: BrowserStoreDiagnostic,
): LogRecord {
	return {
		level: diagnostic.level === "warning" ? "warn" : diagnostic.level,
		message: diagnostic.phase.startsWith("migration-")
			? "Durable migration maintenance is pending retry"
			: "Durable storage maintenance requires attention",
		context: {
			phase: diagnostic.phase,
			operation: diagnostic.operation,
			scope: diagnostic.scope,
			code: diagnostic.code,
			retryable: diagnostic.retryable,
		},
	};
}

export const DEFAULT_BROWSER_STORAGE_IDENTITY: BrowserStorageIdentity = {
	identity: "opencut-browser-production",
	projectsDatabase: "video-editor-projects",
	projectsStore: "projects",
	mediaDatabasePrefix: "video-editor-media-",
	mediaStore: "media-metadata",
	libraryDatabase: "video-editor-saved-sounds",
	libraryStore: "saved-sounds",
	mediaDirectoryPrefix: "media-files-",
};

export function createDisposableBrowserStorageIdentity(args: {
	identity: string;
	prefix: string;
}): BrowserStorageIdentity {
	assertDisposableIdentity(args);
	return {
		identity: args.identity,
		projectsDatabase: `${args.identity}-video-editor-projects`,
		projectsStore: "projects",
		mediaDatabasePrefix: `${args.identity}-video-editor-media-`,
		mediaStore: "media-metadata",
		libraryDatabase: `${args.identity}-video-editor-saved-sounds`,
		libraryStore: "saved-sounds",
		mediaDirectoryPrefix: `${args.identity}-media-files-`,
	};
}

export function assertDisposableIdentity(args: {
	identity: string;
	prefix: string;
}): void {
	if (
		args.prefix.length === 0 ||
		!args.identity.startsWith(args.prefix) ||
		args.identity.length <= args.prefix.length ||
		args.identity.includes("undefined") ||
		args.prefix.includes("undefined")
	) {
		throw new Error(
			"Disposable browser storage identity is outside its prefix",
		);
	}
}

export function validateStorageIdentity(
	identity: BrowserStorageIdentity,
): void {
	for (const value of Object.values(identity)) {
		if (value.length === 0 || value.includes("undefined")) {
			throw new Error("Browser storage identity contains an invalid name");
		}
	}
}

export function durableIdentityKey(identity: BrowserStorageIdentity): string {
	return JSON.stringify([
		identity.projectsDatabase,
		identity.projectsStore,
		identity.mediaDatabasePrefix,
		identity.mediaStore,
		identity.libraryDatabase,
		identity.libraryStore,
		identity.mediaDirectoryPrefix,
	]);
}

export function projectsControlPlaneKey(
	identity: BrowserStorageIdentity,
): string {
	return JSON.stringify([identity.projectsDatabase, identity.projectsStore]);
}

export function mediaBindingForIdentity(
	identity: BrowserStorageIdentity,
): BrowserMediaBinding {
	return {
		revision: 1,
		mediaDatabasePrefix: identity.mediaDatabasePrefix,
		mediaStore: identity.mediaStore,
		mediaDirectoryPrefix: identity.mediaDirectoryPrefix,
	};
}

export function validateMediaBinding(binding: BrowserMediaBinding): void {
	if (
		binding.revision !== 1 ||
		binding.mediaDatabasePrefix.length === 0 ||
		binding.mediaStore.length === 0 ||
		binding.mediaDirectoryPrefix.length === 0 ||
		binding.mediaDatabasePrefix.includes("undefined") ||
		binding.mediaStore.includes("undefined") ||
		binding.mediaDirectoryPrefix.includes("undefined")
	) {
		throw new Error("Browser media binding contains an invalid name");
	}
}

export async function mediaBindingFingerprint(
	binding: BrowserMediaBinding,
): Promise<string> {
	validateMediaBinding(binding);
	const canonical = JSON.stringify([
		binding.revision,
		binding.mediaDatabasePrefix,
		binding.mediaStore,
		binding.mediaDirectoryPrefix,
	]);
	const digest = await crypto.subtle.digest(
		"SHA-256",
		new TextEncoder().encode(canonical),
	);
	return [...new Uint8Array(digest)]
		.map((byte) => byte.toString(16).padStart(2, "0"))
		.join("");
}

export function cloneBrowserValue<Value>(args: {
	value: Value;
	operation: ProjectStoreOperation;
	scope: ProjectStoreErrorScope;
}): Value {
	try {
		return structuredClone(args.value);
	} catch {
		throw new ProjectStoreError({
			code: "corrupt",
			operation: args.operation,
			scope: args.scope,
			message: `Project store ${args.operation} received an invalid opaque value`,
		});
	}
}

export function throwIfBrowserStoreAborted(args: {
	operation: ProjectStoreOperation;
	scope: ProjectStoreErrorScope;
	signal?: AbortSignal;
}): void {
	if (!args.signal?.aborted) return;
	throw new ProjectStoreError({
		code: "aborted",
		operation: args.operation,
		scope: args.scope,
	});
}

export function mapBrowserStoreError(args: {
	error: unknown;
	operation: ProjectStoreOperation;
	scope: ProjectStoreErrorScope;
}): ProjectStoreError {
	if (args.error instanceof ProjectStoreError) return args.error;
	const name =
		args.error && typeof args.error === "object" && "name" in args.error
			? String(args.error.name)
			: "";
	let code: ProjectStoreErrorCode = "unavailable";
	if (name === "AbortError") code = "aborted";
	else if (
		name === "QuotaExceededError" ||
		name === "NS_ERROR_DOM_QUOTA_REACHED"
	) {
		code = "quota-exceeded";
	} else if (
		name === "DataCloneError" ||
		name === "DataError" ||
		name === "EncodingError"
	) {
		code = "corrupt";
	} else if (
		name === "ConstraintError" ||
		name === "VersionError" ||
		name === "InvalidModificationError"
	) {
		code = "conflict";
	}
	return new ProjectStoreError({
		code,
		operation: args.operation,
		scope: args.scope,
		message: `Project store ${args.operation} failed: ${code}`,
	});
}

export function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function encodeLibraryKey(args: {
	namespace: string;
	key: string;
}): string {
	return `${LIBRARY_KEY_PREFIX}${encodeURIComponent(args.namespace)}:${encodeURIComponent(args.key)}`;
}

export function mediaDatabaseName(args: {
	identity: BrowserStorageIdentity;
	projectId: string;
}): string {
	return `${args.identity.mediaDatabasePrefix}${args.projectId}`;
}

export function mediaDirectoryName(args: {
	identity: BrowserStorageIdentity;
	projectId: string;
}): string {
	return `${args.identity.mediaDirectoryPrefix}${args.projectId}`;
}

export function randomInternalName(prefix: string): string {
	return `${prefix}${crypto.randomUUID()}`;
}
