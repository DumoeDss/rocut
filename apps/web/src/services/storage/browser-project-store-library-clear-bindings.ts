import type {
	ProjectStoreErrorScope,
	ProjectStoreOperation,
} from "@opencut/editor-ports";
import { ProjectStoreError } from "@opencut/editor-ports";
import {
	isRecord,
	type BrowserStorageIdentity,
} from "./browser-project-store-internals";
import {
	browserProjectTopologyStoreNames,
	type LibraryPhysicalClaim,
} from "./browser-project-store-topology";
import { idbGet, idbGetAll } from "./browser-storage-mechanisms";

const LIBRARY_CLEAR_BINDING_FIELD = "__opencutLibraryClearBinding";
const LIBRARY_CLEAR_BINDING_PREFIX = ".c5-library-clear-binding:";

interface BindingContext {
	readonly operation: ProjectStoreOperation;
	readonly scope: ProjectStoreErrorScope;
}

export interface BrowserLibraryClearBindingV1 {
	readonly revision: 1;
	readonly projectsDatabase: string;
	readonly projectsStore: string;
	readonly libraryDatabase: string;
	readonly libraryStore: string;
}

export interface LibraryClearTargetV1 {
	readonly revision: 1;
	readonly kind: "library";
	readonly fingerprint: string;
	readonly database: string;
	readonly store: string;
}

export interface PreparedLibraryClearAuthorization {
	readonly bindingStore: string;
	readonly descriptor: Record<string, unknown>;
	readonly target: LibraryClearTargetV1;
}

export function libraryClearBindingStoreName(projectsStore: string): string {
	return browserProjectTopologyStoreNames(projectsStore).libraryClearBindings;
}

export function libraryClearBindingForIdentity(
	identity: BrowserStorageIdentity,
): BrowserLibraryClearBindingV1 {
	return {
		revision: 1,
		projectsDatabase: identity.projectsDatabase,
		projectsStore: identity.projectsStore,
		libraryDatabase: identity.libraryDatabase,
		libraryStore: identity.libraryStore,
	};
}

export function validateLibraryClearBinding(
	binding: BrowserLibraryClearBindingV1,
): void {
	if (
		binding.revision !== 1 ||
		![
			binding.projectsDatabase,
			binding.projectsStore,
			binding.libraryDatabase,
			binding.libraryStore,
		].every(isValidPhysicalName)
	) {
		throw new Error("Browser library clear binding contains an invalid name");
	}
}

export async function libraryClearBindingFingerprint(
	binding: BrowserLibraryClearBindingV1,
): Promise<string> {
	validateLibraryClearBinding(binding);
	const canonical = JSON.stringify([
		"opencut-library-clear-binding",
		binding.revision,
		binding.projectsDatabase,
		binding.projectsStore,
		binding.libraryDatabase,
		binding.libraryStore,
	]);
	const digest = await crypto.subtle.digest(
		"SHA-256",
		new TextEncoder().encode(canonical),
	);
	return [...new Uint8Array(digest)]
		.map((byte) => byte.toString(16).padStart(2, "0"))
		.join("");
}

export async function prepareLibraryClearAuthorization(args: {
	identity: BrowserStorageIdentity;
	binding?: BrowserLibraryClearBindingV1;
	context: BindingContext;
}): Promise<PreparedLibraryClearAuthorization> {
	const binding = args.binding ?? libraryClearBindingForIdentity(args.identity);
	assertControlPlane({
		identity: args.identity,
		binding,
		context: args.context,
	});
	const fingerprint = await libraryClearBindingFingerprint(binding);
	const descriptor = createLibraryClearBindingRecord({ binding, fingerprint });
	const bindingStore = libraryClearBindingStoreName(
		args.identity.projectsStore,
	);
	const existing = await idbGet<unknown>({
		database: args.identity.projectsDatabase,
		store: bindingStore,
		key: libraryClearBindingKey(fingerprint),
		context: args.context,
	});
	if (existing !== null) {
		const decoded = await decodeLibraryClearBindingRecord(existing);
		if (
			!decoded ||
			decoded.fingerprint !== fingerprint ||
			!sameLibraryBinding({ left: decoded.binding, right: binding })
		) {
			throwBindingFailure({ context: args.context, code: "corrupt" });
		}
	}
	return {
		bindingStore,
		descriptor,
		target: {
			revision: 1,
			kind: "library",
			fingerprint,
			database: binding.libraryDatabase,
			store: binding.libraryStore,
		},
	};
}

export async function validatePreparedLibraryClearAuthorization(args: {
	identity: BrowserStorageIdentity;
	prepared: PreparedLibraryClearAuthorization;
	context: BindingContext;
}): Promise<void> {
	const descriptor = await decodeLibraryClearBindingRecord(
		args.prepared.descriptor,
	);
	if (!descriptor) {
		throwBindingFailure({ context: args.context, code: "corrupt" });
	}
	assertControlPlane({
		identity: args.identity,
		binding: descriptor.binding,
		context: args.context,
	});
	assertTargetMatchesDescriptor({
		target: args.prepared.target,
		fingerprint: descriptor.fingerprint,
		binding: descriptor.binding,
		context: args.context,
	});
}

export async function validateLibraryClearTarget(args: {
	identity: BrowserStorageIdentity;
	target: LibraryClearTargetV1;
	context: BindingContext;
}): Promise<void> {
	const raw = await idbGet<unknown>({
		database: args.identity.projectsDatabase,
		store: libraryClearBindingStoreName(args.identity.projectsStore),
		key: libraryClearBindingKey(args.target.fingerprint),
		context: args.context,
	});
	if (raw === null) {
		throwBindingFailure({ context: args.context, code: "unavailable" });
	}
	const descriptor = await decodeLibraryClearBindingRecord(raw);
	if (!descriptor) {
		throwBindingFailure({ context: args.context, code: "corrupt" });
	}
	assertControlPlane({
		identity: args.identity,
		binding: descriptor.binding,
		context: args.context,
	});
	assertTargetMatchesDescriptor({
		target: args.target,
		fingerprint: descriptor.fingerprint,
		binding: descriptor.binding,
		context: args.context,
	});
}

export async function readKnownLibraryPhysicalClaims(args: {
	identity: BrowserStorageIdentity;
	context: BindingContext;
}): Promise<readonly LibraryPhysicalClaim[]> {
	const claims = new Map<string, LibraryPhysicalClaim>();
	const currentBinding = libraryClearBindingForIdentity(args.identity);
	const currentFingerprint =
		await libraryClearBindingFingerprint(currentBinding);
	const current = await decodeLibraryClearBindingRecord(
		createLibraryClearBindingRecord({
			binding: currentBinding,
			fingerprint: currentFingerprint,
		}),
	);
	if (!current) {
		throwBindingFailure({ context: args.context, code: "corrupt" });
	}
	claims.set(current.fingerprint, libraryPhysicalClaim(current));
	const rows = await idbGetAll<unknown>({
		database: args.identity.projectsDatabase,
		store: libraryClearBindingStoreName(args.identity.projectsStore),
		context: args.context,
	});
	for (const row of rows) {
		const decoded = await decodeLibraryClearBindingRecord(row);
		if (!decoded) {
			throwBindingFailure({ context: args.context, code: "corrupt" });
		}
		assertControlPlane({
			identity: args.identity,
			binding: decoded.binding,
			context: args.context,
		});
		const claim = libraryPhysicalClaim(decoded);
		const existing = claims.get(decoded.fingerprint);
		if (
			existing &&
			(existing.database !== claim.database || existing.store !== claim.store)
		) {
			throwBindingFailure({ context: args.context, code: "corrupt" });
		}
		claims.set(decoded.fingerprint, claim);
	}
	return Object.freeze(
		[...claims.values()]
			.sort((left, right) =>
				JSON.stringify([
					left.database,
					left.store,
					left.fingerprint,
				]).localeCompare(
					JSON.stringify([right.database, right.store, right.fingerprint]),
				),
			)
			.map((claim) => Object.freeze({ ...claim })),
	);
}

export function decodeLibraryClearTarget(
	value: unknown,
): LibraryClearTargetV1 | null {
	if (
		!isRecord(value) ||
		!hasExactKeys({
			value,
			expected: ["revision", "kind", "fingerprint", "database", "store"],
		}) ||
		value.revision !== 1 ||
		value.kind !== "library" ||
		!isValidPhysicalName(value.fingerprint) ||
		!isValidPhysicalName(value.database) ||
		!isValidPhysicalName(value.store)
	) {
		return null;
	}
	return {
		revision: 1,
		kind: "library",
		fingerprint: value.fingerprint,
		database: value.database,
		store: value.store,
	};
}

async function decodeLibraryClearBindingRecord(value: unknown): Promise<{
	readonly fingerprint: string;
	readonly binding: BrowserLibraryClearBindingV1;
} | null> {
	if (
		!isRecord(value) ||
		!hasExactKeys({
			value,
			expected: ["id", LIBRARY_CLEAR_BINDING_FIELD],
		}) ||
		typeof value.id !== "string"
	) {
		return null;
	}
	const envelope = value[LIBRARY_CLEAR_BINDING_FIELD];
	if (
		!isRecord(envelope) ||
		!hasExactKeys({
			value: envelope,
			expected: ["revision", "kind", "fingerprint", "binding"],
		}) ||
		envelope.revision !== 1 ||
		envelope.kind !== "clear-authorization" ||
		!isValidPhysicalName(envelope.fingerprint) ||
		!isLibraryClearBinding(envelope.binding) ||
		value.id !== libraryClearBindingKey(envelope.fingerprint) ||
		(await libraryClearBindingFingerprint(envelope.binding)) !==
			envelope.fingerprint
	) {
		return null;
	}
	return {
		fingerprint: envelope.fingerprint,
		binding: envelope.binding,
	};
}

function createLibraryClearBindingRecord(args: {
	binding: BrowserLibraryClearBindingV1;
	fingerprint: string;
}): Record<string, unknown> {
	return {
		id: libraryClearBindingKey(args.fingerprint),
		[LIBRARY_CLEAR_BINDING_FIELD]: {
			revision: 1,
			kind: "clear-authorization",
			fingerprint: args.fingerprint,
			binding: args.binding,
		},
	};
}

function libraryPhysicalClaim(args: {
	fingerprint: string;
	binding: BrowserLibraryClearBindingV1;
}): LibraryPhysicalClaim {
	return {
		fingerprint: args.fingerprint,
		database: args.binding.libraryDatabase,
		store: args.binding.libraryStore,
	};
}

function libraryClearBindingKey(fingerprint: string): string {
	return `${LIBRARY_CLEAR_BINDING_PREFIX}${fingerprint}`;
}

function isLibraryClearBinding(
	value: unknown,
): value is BrowserLibraryClearBindingV1 {
	return (
		isRecord(value) &&
		hasExactKeys({
			value,
			expected: [
				"revision",
				"projectsDatabase",
				"projectsStore",
				"libraryDatabase",
				"libraryStore",
			],
		}) &&
		value.revision === 1 &&
		isValidPhysicalName(value.projectsDatabase) &&
		isValidPhysicalName(value.projectsStore) &&
		isValidPhysicalName(value.libraryDatabase) &&
		isValidPhysicalName(value.libraryStore)
	);
}

function assertControlPlane(args: {
	identity: BrowserStorageIdentity;
	binding: BrowserLibraryClearBindingV1;
	context: BindingContext;
}): void {
	if (
		args.binding.projectsDatabase !== args.identity.projectsDatabase ||
		args.binding.projectsStore !== args.identity.projectsStore
	) {
		throwBindingFailure({ context: args.context, code: "corrupt" });
	}
}

function assertTargetMatchesDescriptor(args: {
	target: LibraryClearTargetV1;
	fingerprint: string;
	binding: BrowserLibraryClearBindingV1;
	context: BindingContext;
}): void {
	if (
		args.target.fingerprint !== args.fingerprint ||
		args.target.database !== args.binding.libraryDatabase ||
		args.target.store !== args.binding.libraryStore
	) {
		throwBindingFailure({ context: args.context, code: "corrupt" });
	}
}

function sameLibraryBinding(args: {
	left: BrowserLibraryClearBindingV1;
	right: BrowserLibraryClearBindingV1;
}): boolean {
	return (
		args.left.revision === args.right.revision &&
		args.left.projectsDatabase === args.right.projectsDatabase &&
		args.left.projectsStore === args.right.projectsStore &&
		args.left.libraryDatabase === args.right.libraryDatabase &&
		args.left.libraryStore === args.right.libraryStore
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

function isValidPhysicalName(value: unknown): value is string {
	return (
		typeof value === "string" &&
		value.length > 0 &&
		!value.includes("undefined")
	);
}

function throwBindingFailure(args: {
	context: BindingContext;
	code: "corrupt" | "unavailable";
}): never {
	throw new ProjectStoreError({
		code: args.code,
		operation: args.context.operation,
		scope: args.context.scope,
	});
}
