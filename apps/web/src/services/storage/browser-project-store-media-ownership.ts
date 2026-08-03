import type {
	ProjectStoreErrorScope,
	ProjectStoreOperation,
} from "@/editor/ports";
import { ProjectStoreError } from "@/editor/ports";
import {
	isRecord,
	mediaBindingFingerprint,
	mediaBindingForIdentity,
	type BrowserMediaBinding,
	type BrowserStorageIdentity,
	type BrowserStoreDiagnostic,
} from "./browser-project-store-internals";
import { readKnownLibraryPhysicalClaims } from "./browser-project-store-library-clear-bindings";
import {
	browserProjectTopologyStoreNames,
	createBrowserStorageTopology,
	isBrowserStorageTopologyConflict,
	type BrowserStorageTopology,
	type LibraryPhysicalClaim,
	type MediaPhysicalClaim,
} from "./browser-project-store-topology";
import {
	idbGetAll,
	idbPutMany,
	inspectDatabaseNames,
	listRootEntries,
} from "./browser-storage-mechanisms";

const MEDIA_OWNER_FIELD = "__opencutMediaOwner";
const LEGACY_COVERAGE_KEY = ".c5-media-owner-coverage";
const LEGACY_OWNER_PREFIX = ".c5-media-owner:";
const BINDING_PREFIX = ".c5-media-binding:";
const OWNER_V2_PREFIX = ".c5-media-owner-v2:";
const COVERAGE_V2_PREFIX = ".c5-media-coverage:";

interface LegacyOwnerRecord {
	readonly kind: "legacy-owner";
	readonly projectId: string;
}

interface LegacyCoverageRecord {
	readonly kind: "legacy-coverage";
}

interface LegacyBindingRecord {
	readonly kind: "legacy-binding";
	readonly fingerprint: string;
}

interface BindingRecord {
	readonly kind: "binding";
	readonly fingerprint: string;
	readonly binding: BrowserMediaBinding;
}

interface OwnerRecord {
	readonly kind: "owner";
	readonly fingerprint: string;
	readonly projectId: string;
}

interface CoverageRecord {
	readonly kind: "coverage";
	readonly fingerprint: string;
}

type DecodedOwnershipRecord =
	| LegacyOwnerRecord
	| LegacyCoverageRecord
	| LegacyBindingRecord
	| BindingRecord
	| OwnerRecord
	| CoverageRecord;

interface MediaOwnershipState {
	readonly bindings: ReadonlyMap<string, BrowserMediaBinding>;
	readonly owners: ReadonlyMap<string, ReadonlySet<string>>;
	readonly knownMedia: readonly MediaPhysicalClaim[];
	readonly certificates: ReadonlySet<string>;
	readonly legacyOwners: ReadonlySet<string>;
	readonly legacyCoverage: boolean;
	readonly legacyBindingFingerprint: string | null;
}

interface OwnershipContext {
	readonly operation: ProjectStoreOperation;
	readonly scope: ProjectStoreErrorScope;
}

export interface MediaClearTarget {
	readonly fingerprint: string;
	readonly projectId: string;
	readonly database: string;
	readonly directory: string;
}

export interface MediaClearPlan {
	readonly revision: 2;
	readonly projectIds: readonly string[];
	readonly targets: readonly MediaClearTarget[];
}

export function mediaOwnershipStoreName(projectsStore: string): string {
	return browserProjectTopologyStoreNames(projectsStore).mediaOwnership;
}

export async function registerMediaOwner(args: {
	identity: BrowserStorageIdentity;
	projectId: string;
	context: OwnershipContext;
	topology?: BrowserStorageTopology;
}): Promise<void> {
	if (!isNonEmptyString(args.projectId)) throwOwnershipFailure(args.context);
	const topology = args.topology ?? createBrowserStorageTopology(args.identity);
	const binding = mediaBindingForIdentity(args.identity);
	const fingerprint = await mediaBindingFingerprint(binding);
	const candidate = mediaClaimForBinding({
		binding,
		fingerprint,
		projectId: args.projectId,
		context: args.context,
	});
	const knownLibraries = await readKnownLibraryPhysicalClaims({
		identity: args.identity,
		context: args.context,
	});
	authorizeMediaClaim({
		topology,
		candidate,
		knownMedia: [],
		knownLibraries,
		context: args.context,
	});
	const state = await readMediaOwnership(args);
	authorizeMediaClaim({
		topology,
		candidate,
		knownMedia: state.knownMedia,
		knownLibraries,
		context: args.context,
	});
	const existing = state.bindings.get(fingerprint);
	if (existing && !sameBinding({ left: existing, right: binding })) {
		throwOwnershipFailure(args.context);
	}
	const store = mediaOwnershipStoreName(args.identity.projectsStore);
	await idbPutMany({
		database: args.identity.projectsDatabase,
		store,
		values: [
			createBindingRecord({ binding, fingerprint }),
			createOwnerRecord({ fingerprint, projectId: args.projectId }),
		],
		context: args.context,
	});
}

export async function opportunisticallyCertifyMediaOwnership(args: {
	identity: BrowserStorageIdentity;
	previousBinding?: BrowserMediaBinding;
	diagnostic?: (diagnostic: BrowserStoreDiagnostic) => void;
	topology?: BrowserStorageTopology;
}): Promise<boolean> {
	const context = { operation: "inspect", scope: { kind: "store" } } as const;
	try {
		const state = await refreshMediaOwnership({
			identity: args.identity,
			previousBinding: args.previousBinding,
			diagnostic: args.diagnostic,
			topology: args.topology,
			context,
		});
		if (hasUnboundLegacyState(state)) {
			reportLegacyUnbound({
				diagnostic: args.diagnostic,
				operation: "inspect",
			});
			return false;
		}
		return everyBindingCertified(state);
	} catch (error) {
		args.diagnostic?.({
			level: "warning",
			phase: "media-owner-coverage",
			operation: "inspect",
			scope: { kind: "store" },
			code: error instanceof ProjectStoreError ? error.code : "unavailable",
			retryable: true,
		});
		return false;
	}
}

export async function planMediaClear(args: {
	identity: BrowserStorageIdentity;
	logicalProjectIds: ReadonlySet<string>;
	previousBinding?: BrowserMediaBinding;
	diagnostic?: (diagnostic: BrowserStoreDiagnostic) => void;
}): Promise<MediaClearPlan> {
	const context = { operation: "clear", scope: { kind: "store" } } as const;
	const state = await refreshMediaOwnership({
		identity: args.identity,
		previousBinding: args.previousBinding,
		diagnostic: args.diagnostic,
		context,
	});
	if (hasUnboundLegacyState(state) || !everyBindingCertified(state)) {
		if (hasUnboundLegacyState(state)) {
			reportLegacyUnbound({
				diagnostic: args.diagnostic,
				operation: "clear",
			});
		}
		throw unavailableClear();
	}
	const currentBinding = mediaBindingForIdentity(args.identity);
	const currentFingerprint = await mediaBindingFingerprint(currentBinding);
	const projectIds = new Set(args.logicalProjectIds);
	const targets = new Map<string, MediaClearTarget>();
	for (const [fingerprint, owners] of state.owners) {
		const binding = state.bindings.get(fingerprint);
		if (!binding) throwOwnershipFailure(context);
		for (const projectId of owners) {
			projectIds.add(projectId);
			addTarget({ targets, fingerprint, binding, projectId, context });
		}
	}
	if (state.legacyBindingFingerprint) {
		const binding = state.bindings.get(state.legacyBindingFingerprint);
		if (!binding) throwOwnershipFailure(context);
		for (const projectId of state.legacyOwners) {
			projectIds.add(projectId);
			addTarget({
				targets,
				fingerprint: state.legacyBindingFingerprint,
				binding,
				projectId,
				context,
			});
		}
	}
	for (const projectId of args.logicalProjectIds) {
		addTarget({
			targets,
			fingerprint: currentFingerprint,
			binding: currentBinding,
			projectId,
			context,
		});
	}
	const plan: MediaClearPlan = {
		revision: 2,
		projectIds: [...projectIds].sort(),
		targets: [...targets.values()].sort((left, right) =>
			compareTargets({ left, right }),
		),
	};
	await validateMediaClearPlan({ identity: args.identity, plan, context });
	return plan;
}

export async function validateMediaClearPlan(args: {
	identity: BrowserStorageIdentity;
	plan: Pick<MediaClearPlan, "revision" | "targets">;
	context: OwnershipContext;
}): Promise<void> {
	if (args.plan.revision !== 2) throwOwnershipFailure(args.context);
	const state = await readMediaOwnership({
		identity: args.identity,
		context: args.context,
	});
	const targetKeys = new Set<string>();
	for (const target of args.plan.targets) {
		if (
			!isNonEmptyString(target.fingerprint) ||
			!isNonEmptyString(target.projectId) ||
			!isNonEmptyString(target.database) ||
			!isNonEmptyString(target.directory)
		) {
			throwOwnershipFailure(args.context);
		}
		const targetKey = JSON.stringify([
			target.fingerprint,
			target.projectId,
			target.database,
			target.directory,
		]);
		if (targetKeys.has(targetKey)) throwOwnershipFailure(args.context);
		targetKeys.add(targetKey);
		const binding = state.bindings.get(target.fingerprint);
		if (!binding || !state.certificates.has(target.fingerprint)) {
			throwOwnershipFailure(args.context);
		}
		const expected = deriveTargetsForBinding({
			binding,
			projectId: target.projectId,
			context: args.context,
		});
		if (
			target.database !== expected.database ||
			target.directory !== expected.directory
		) {
			throwOwnershipFailure(args.context);
		}
	}
}

export async function readKnownMediaPhysicalClaims(args: {
	identity: BrowserStorageIdentity;
	context: OwnershipContext;
}): Promise<readonly MediaPhysicalClaim[]> {
	return (await readMediaOwnership(args)).knownMedia;
}

export async function currentMediaPhysicalClaim(args: {
	identity: BrowserStorageIdentity;
	projectId: string;
	context: OwnershipContext;
}): Promise<MediaPhysicalClaim> {
	const binding = mediaBindingForIdentity(args.identity);
	return mediaClaimForBinding({
		binding,
		fingerprint: await mediaBindingFingerprint(binding),
		projectId: args.projectId,
		context: args.context,
	});
}

export function deriveOwnedMediaTargets(args: {
	identity: BrowserStorageIdentity;
	projectId: string;
}): { database: string; directory: string } {
	return deriveTargetsForBinding({
		binding: mediaBindingForIdentity(args.identity),
		projectId: args.projectId,
		context: { operation: "clear", scope: { kind: "store" } },
	});
}

async function refreshMediaOwnership(args: {
	identity: BrowserStorageIdentity;
	previousBinding?: BrowserMediaBinding;
	diagnostic?: (diagnostic: BrowserStoreDiagnostic) => void;
	topology?: BrowserStorageTopology;
	context: OwnershipContext;
}): Promise<MediaOwnershipState> {
	const topology = args.topology ?? createBrowserStorageTopology(args.identity);
	authorizeStaticTopology({ topology, context: args.context });
	const currentBinding = mediaBindingForIdentity(args.identity);
	const currentFingerprint = await mediaBindingFingerprint(currentBinding);
	const knownLibraries = await readKnownLibraryPhysicalClaims({
		identity: args.identity,
		context: args.context,
	});
	let state = await readMediaOwnership(args);
	authorizeKnownMediaClaims({
		topology,
		knownMedia: state.knownMedia,
		knownLibraries,
		context: args.context,
	});
	const currentBindingMissing = !state.bindings.has(currentFingerprint);
	if (currentBindingMissing) {
		state = withMediaBinding({
			state,
			fingerprint: currentFingerprint,
			binding: currentBinding,
			context: args.context,
		});
	}
	if (state.legacyCoverage && args.previousBinding) {
		await explicitlyBindLegacyOwnership({
			identity: args.identity,
			previousBinding: args.previousBinding,
			state,
			topology,
			knownLibraries,
			context: args.context,
		});
		state = await readMediaOwnership(args);
		if (currentBindingMissing && !state.bindings.has(currentFingerprint)) {
			state = withMediaBinding({
				state,
				fingerprint: currentFingerprint,
				binding: currentBinding,
				context: args.context,
			});
		}
	}
	if (hasUnboundLegacyState(state)) return state;
	const uncertified = new Set(
		[...state.bindings.keys()].filter(
			(fingerprint) => !state.certificates.has(fingerprint),
		),
	);
	let databaseNames: readonly string[];
	let directoryNames: readonly string[];
	try {
		const databases = await inspectDatabaseNames();
		if (databases.kind === "unsupported") {
			if (uncertified.size === 0) reportOptionalInventory(args.diagnostic);
			return state;
		}
		databaseNames = databases.names;
		directoryNames = await listRootEntries();
	} catch {
		if (uncertified.size > 0) throw unavailableClear();
		reportOptionalInventory(args.diagnostic);
		return state;
	}
	const discovered = collectUnambiguousOwners({
		bindings: state.bindings,
		databaseNames,
		directoryNames,
		context: args.context,
	});
	const discoveredState = withMediaOwners({
		state,
		owners: discovered,
		context: args.context,
	});
	authorizeKnownMediaClaims({
		topology,
		knownMedia: discoveredState.knownMedia,
		knownLibraries,
		context: args.context,
	});
	const values: Record<string, unknown>[] = [];
	if (currentBindingMissing) {
		values.push(
			createBindingRecord({
				binding: currentBinding,
				fingerprint: currentFingerprint,
			}),
		);
	}
	for (const [fingerprint, projectIds] of discovered) {
		for (const projectId of projectIds) {
			values.push(createOwnerRecord({ fingerprint, projectId }));
		}
	}
	for (const fingerprint of uncertified) {
		values.push(createCoverageRecord(fingerprint));
	}
	if (values.length > 0) {
		await idbPutMany({
			database: args.identity.projectsDatabase,
			store: mediaOwnershipStoreName(args.identity.projectsStore),
			values,
			context: args.context,
		});
		state = await readMediaOwnership(args);
	}
	return values.length > 0 ? state : discoveredState;
}

async function explicitlyBindLegacyOwnership(args: {
	identity: BrowserStorageIdentity;
	previousBinding: BrowserMediaBinding;
	state: MediaOwnershipState;
	topology: BrowserStorageTopology;
	knownLibraries: readonly LibraryPhysicalClaim[];
	context: OwnershipContext;
}): Promise<void> {
	const fingerprint = await mediaBindingFingerprint(args.previousBinding);
	const existing = args.state.bindings.get(fingerprint);
	if (
		existing &&
		!sameBinding({ left: existing, right: args.previousBinding })
	) {
		throwOwnershipFailure(args.context);
	}
	const backfilledOwners = new Set(args.state.legacyOwners);
	let projected = withMediaBinding({
		state: args.state,
		fingerprint,
		binding: args.previousBinding,
		context: args.context,
	});
	projected = withMediaOwners({
		state: projected,
		owners: new Map([[fingerprint, backfilledOwners]]),
		context: args.context,
	});
	authorizeKnownMediaClaims({
		topology: args.topology,
		knownMedia: projected.knownMedia,
		knownLibraries: args.knownLibraries,
		context: args.context,
	});
	const snapshots = await optionalOwnershipSnapshots();
	if (snapshots) {
		const discovered = collectUnambiguousOwners({
			bindings: projected.bindings,
			databaseNames: snapshots.databaseNames,
			directoryNames: snapshots.directoryNames,
			context: args.context,
		});
		for (const projectId of discovered.get(fingerprint) ?? []) {
			backfilledOwners.add(projectId);
		}
	}
	projected = withMediaOwners({
		state: projected,
		owners: new Map([[fingerprint, backfilledOwners]]),
		context: args.context,
	});
	authorizeKnownMediaClaims({
		topology: args.topology,
		knownMedia: projected.knownMedia,
		knownLibraries: args.knownLibraries,
		context: args.context,
	});
	const values: Record<string, unknown>[] = [
		createBindingRecord({
			binding: args.previousBinding,
			fingerprint,
		}),
		...[...backfilledOwners]
			.sort()
			.map((projectId) => createOwnerRecord({ fingerprint, projectId })),
		createCoverageRecord(fingerprint),
		createLegacyBindingRecord(fingerprint),
	];
	await idbPutMany({
		database: args.identity.projectsDatabase,
		store: mediaOwnershipStoreName(args.identity.projectsStore),
		values,
		context: args.context,
	});
}

async function optionalOwnershipSnapshots(): Promise<{
	databaseNames: readonly string[];
	directoryNames: readonly string[];
} | null> {
	try {
		const databases = await inspectDatabaseNames();
		if (databases.kind === "unsupported") return null;
		return {
			databaseNames: databases.names,
			directoryNames: await listRootEntries(),
		};
	} catch {
		return null;
	}
}

async function readMediaOwnership(args: {
	identity: BrowserStorageIdentity;
	context: OwnershipContext;
}): Promise<MediaOwnershipState> {
	const rows = await idbGetAll<unknown>({
		database: args.identity.projectsDatabase,
		store: mediaOwnershipStoreName(args.identity.projectsStore),
		context: args.context,
	});
	const bindings = new Map<string, BrowserMediaBinding>();
	const owners = new Map<string, Set<string>>();
	const certificates = new Set<string>();
	const legacyOwners = new Set<string>();
	let legacyCoverage = false;
	let legacyBindingFingerprint: string | null = null;
	for (const row of rows) {
		const decoded = await decodeMediaOwnershipRecord(row);
		if (!decoded) throwOwnershipFailure(args.context);
		switch (decoded.kind) {
			case "binding": {
				const existing = bindings.get(decoded.fingerprint);
				if (
					existing &&
					!sameBinding({ left: existing, right: decoded.binding })
				) {
					throwOwnershipFailure(args.context);
				}
				bindings.set(decoded.fingerprint, decoded.binding);
				break;
			}
			case "owner": {
				const scoped = owners.get(decoded.fingerprint) ?? new Set<string>();
				scoped.add(decoded.projectId);
				owners.set(decoded.fingerprint, scoped);
				break;
			}
			case "coverage":
				certificates.add(decoded.fingerprint);
				break;
			case "legacy-owner":
				legacyOwners.add(decoded.projectId);
				break;
			case "legacy-coverage":
				legacyCoverage = true;
				break;
			case "legacy-binding":
				legacyBindingFingerprint = decoded.fingerprint;
				break;
		}
	}
	for (const fingerprint of [...owners.keys(), ...certificates]) {
		if (!bindings.has(fingerprint)) throwOwnershipFailure(args.context);
	}
	if (
		legacyBindingFingerprint &&
		(!bindings.has(legacyBindingFingerprint) ||
			!certificates.has(legacyBindingFingerprint))
	) {
		throwOwnershipFailure(args.context);
	}
	return createMediaOwnershipState({
		bindings,
		owners,
		certificates,
		legacyOwners,
		legacyCoverage,
		legacyBindingFingerprint,
		context: args.context,
	});
}

function createMediaOwnershipState(args: {
	bindings: ReadonlyMap<string, BrowserMediaBinding>;
	owners: ReadonlyMap<string, ReadonlySet<string>>;
	certificates: ReadonlySet<string>;
	legacyOwners: ReadonlySet<string>;
	legacyCoverage: boolean;
	legacyBindingFingerprint: string | null;
	context: OwnershipContext;
}): MediaOwnershipState {
	return {
		bindings: args.bindings,
		owners: args.owners,
		knownMedia: knownMediaClaims({
			bindings: args.bindings,
			owners: args.owners,
			legacyOwners: args.legacyOwners,
			legacyBindingFingerprint: args.legacyBindingFingerprint,
			context: args.context,
		}),
		certificates: args.certificates,
		legacyOwners: args.legacyOwners,
		legacyCoverage: args.legacyCoverage,
		legacyBindingFingerprint: args.legacyBindingFingerprint,
	};
}

function withMediaBinding(args: {
	state: MediaOwnershipState;
	fingerprint: string;
	binding: BrowserMediaBinding;
	context: OwnershipContext;
}): MediaOwnershipState {
	const bindings = new Map(args.state.bindings);
	const existing = bindings.get(args.fingerprint);
	if (existing && !sameBinding({ left: existing, right: args.binding })) {
		throwOwnershipFailure(args.context);
	}
	bindings.set(args.fingerprint, args.binding);
	return createMediaOwnershipState({
		...args.state,
		bindings,
		context: args.context,
	});
}

function withMediaOwners(args: {
	state: MediaOwnershipState;
	owners: ReadonlyMap<string, ReadonlySet<string>>;
	context: OwnershipContext;
}): MediaOwnershipState {
	const owners = new Map<string, Set<string>>(
		[...args.state.owners].map(([fingerprint, projectIds]) => [
			fingerprint,
			new Set(projectIds),
		]),
	);
	for (const [fingerprint, projectIds] of args.owners) {
		if (!args.state.bindings.has(fingerprint)) {
			throwOwnershipFailure(args.context);
		}
		const scoped = owners.get(fingerprint) ?? new Set<string>();
		for (const projectId of projectIds) scoped.add(projectId);
		owners.set(fingerprint, scoped);
	}
	return createMediaOwnershipState({
		...args.state,
		owners,
		context: args.context,
	});
}

function knownMediaClaims(args: {
	bindings: ReadonlyMap<string, BrowserMediaBinding>;
	owners: ReadonlyMap<string, ReadonlySet<string>>;
	legacyOwners: ReadonlySet<string>;
	legacyBindingFingerprint: string | null;
	context: OwnershipContext;
}): readonly MediaPhysicalClaim[] {
	const claims = new Map<string, MediaPhysicalClaim>();
	for (const [fingerprint, projectIds] of args.owners) {
		const binding = args.bindings.get(fingerprint);
		if (!binding) throwOwnershipFailure(args.context);
		for (const projectId of projectIds) {
			const claim = mediaClaimForBinding({
				binding,
				fingerprint,
				projectId,
				context: args.context,
			});
			claims.set(JSON.stringify([fingerprint, projectId]), claim);
		}
	}
	if (args.legacyBindingFingerprint) {
		const binding = args.bindings.get(args.legacyBindingFingerprint);
		if (!binding) throwOwnershipFailure(args.context);
		for (const projectId of args.legacyOwners) {
			const claim = mediaClaimForBinding({
				binding,
				fingerprint: args.legacyBindingFingerprint,
				projectId,
				context: args.context,
			});
			claims.set(
				JSON.stringify([args.legacyBindingFingerprint, projectId]),
				claim,
			);
		}
	}
	return Object.freeze(
		[...claims.values()].sort((left, right) => compareTargets({ left, right })),
	);
}

async function decodeMediaOwnershipRecord(
	value: unknown,
): Promise<DecodedOwnershipRecord | null> {
	if (
		!isRecord(value) ||
		!hasExactKeys({ value, expected: ["id", MEDIA_OWNER_FIELD] }) ||
		typeof value.id !== "string"
	) {
		return null;
	}
	const envelope = value[MEDIA_OWNER_FIELD];
	if (!isRecord(envelope)) return null;
	if (envelope.revision === 1) {
		if (
			envelope.kind === "owner" &&
			hasExactKeys({
				value: envelope,
				expected: ["revision", "kind", "projectId"],
			}) &&
			isNonEmptyString(envelope.projectId) &&
			value.id === legacyOwnerKey(envelope.projectId)
		) {
			return { kind: "legacy-owner", projectId: envelope.projectId };
		}
		if (
			envelope.kind === "coverage" &&
			hasExactKeys({
				value: envelope,
				expected: ["revision", "kind", "coverage"],
			}) &&
			envelope.coverage === "complete" &&
			value.id === LEGACY_COVERAGE_KEY
		) {
			return { kind: "legacy-coverage" };
		}
		return null;
	}
	if (envelope.revision !== 2) return null;
	if (
		envelope.kind === "binding" &&
		hasExactKeys({
			value: envelope,
			expected: ["revision", "kind", "fingerprint", "binding"],
		}) &&
		isNonEmptyString(envelope.fingerprint) &&
		isMediaBinding(envelope.binding) &&
		value.id === mediaBindingKey(envelope.fingerprint) &&
		(await mediaBindingFingerprint(envelope.binding)) === envelope.fingerprint
	) {
		return {
			kind: "binding",
			fingerprint: envelope.fingerprint,
			binding: envelope.binding,
		};
	}
	if (
		envelope.kind === "owner" &&
		hasExactKeys({
			value: envelope,
			expected: ["revision", "kind", "fingerprint", "projectId"],
		}) &&
		isNonEmptyString(envelope.fingerprint) &&
		isNonEmptyString(envelope.projectId) &&
		value.id ===
			mediaOwnerV2Key({
				fingerprint: envelope.fingerprint,
				projectId: envelope.projectId,
			})
	) {
		return {
			kind: "owner",
			fingerprint: envelope.fingerprint,
			projectId: envelope.projectId,
		};
	}
	if (
		envelope.kind === "coverage" &&
		hasExactKeys({
			value: envelope,
			expected: ["revision", "kind", "fingerprint", "coverage"],
		}) &&
		isNonEmptyString(envelope.fingerprint) &&
		envelope.coverage === "complete" &&
		value.id === mediaCoverageKey(envelope.fingerprint)
	) {
		return { kind: "coverage", fingerprint: envelope.fingerprint };
	}
	if (
		envelope.kind === "legacy-binding" &&
		hasExactKeys({
			value: envelope,
			expected: ["revision", "kind", "fingerprint"],
		}) &&
		isNonEmptyString(envelope.fingerprint) &&
		value.id === LEGACY_COVERAGE_KEY
	) {
		return { kind: "legacy-binding", fingerprint: envelope.fingerprint };
	}
	return null;
}

function collectUnambiguousOwners(args: {
	bindings: ReadonlyMap<string, BrowserMediaBinding>;
	databaseNames: readonly string[];
	directoryNames: readonly string[];
	context: OwnershipContext;
}): ReadonlyMap<string, ReadonlySet<string>> {
	const owners = new Map<string, Set<string>>();
	for (const name of args.databaseNames) {
		const matches = [...args.bindings].flatMap(([fingerprint, binding]) => {
			if (!name.startsWith(binding.mediaDatabasePrefix)) return [];
			const projectId = name.slice(binding.mediaDatabasePrefix.length);
			return isNonEmptyString(projectId) ? [{ fingerprint, projectId }] : [];
		});
		addUnambiguousMatch({ matches, owners, context: args.context });
	}
	for (const name of args.directoryNames) {
		const matches = [...args.bindings].flatMap(([fingerprint, binding]) => {
			if (!name.startsWith(binding.mediaDirectoryPrefix)) return [];
			const projectId = name.slice(binding.mediaDirectoryPrefix.length);
			return isNonEmptyString(projectId) ? [{ fingerprint, projectId }] : [];
		});
		addUnambiguousMatch({ matches, owners, context: args.context });
	}
	return owners;
}

function addUnambiguousMatch(args: {
	matches: readonly { fingerprint: string; projectId: string }[];
	owners: Map<string, Set<string>>;
	context: OwnershipContext;
}): void {
	if (args.matches.length === 0) return;
	if (args.matches.length !== 1) throwOwnershipFailure(args.context);
	const match = args.matches[0];
	const scoped = args.owners.get(match.fingerprint) ?? new Set<string>();
	scoped.add(match.projectId);
	args.owners.set(match.fingerprint, scoped);
}

function addTarget(args: {
	targets: Map<string, MediaClearTarget>;
	fingerprint: string;
	binding: BrowserMediaBinding;
	projectId: string;
	context: OwnershipContext;
}): void {
	const physical = deriveTargetsForBinding(args);
	const target: MediaClearTarget = {
		fingerprint: args.fingerprint,
		projectId: args.projectId,
		...physical,
	};
	args.targets.set(JSON.stringify([args.fingerprint, args.projectId]), target);
}

function mediaClaimForBinding(args: {
	binding: BrowserMediaBinding;
	fingerprint: string;
	projectId: string;
	context: OwnershipContext;
}): MediaPhysicalClaim {
	return {
		fingerprint: args.fingerprint,
		projectId: args.projectId,
		...deriveTargetsForBinding(args),
	};
}

function authorizeStaticTopology(args: {
	topology: BrowserStorageTopology;
	context: OwnershipContext;
}): void {
	try {
		args.topology.authorize({
			kind: "static-identity",
			context: args.context,
		});
	} catch (error) {
		if (!isBrowserStorageTopologyConflict(error)) throw error;
		throwTopologyUnavailable(args.context);
	}
}

function authorizeKnownMediaClaims(args: {
	topology: BrowserStorageTopology;
	knownMedia: readonly MediaPhysicalClaim[];
	knownLibraries: readonly LibraryPhysicalClaim[];
	context: OwnershipContext;
}): void {
	for (const candidate of args.knownMedia) {
		authorizeMediaClaim({ ...args, candidate });
	}
}

function authorizeMediaClaim(args: {
	topology: BrowserStorageTopology;
	candidate: MediaPhysicalClaim;
	knownMedia: readonly MediaPhysicalClaim[];
	knownLibraries: readonly LibraryPhysicalClaim[];
	context: OwnershipContext;
}): void {
	try {
		args.topology.authorize({
			kind: "media-access",
			candidate: args.candidate,
			knownMedia: args.knownMedia,
			knownLibraries: args.knownLibraries,
			context: args.context,
		});
	} catch (error) {
		if (!isBrowserStorageTopologyConflict(error)) throw error;
		throwTopologyUnavailable(args.context);
	}
}

function deriveTargetsForBinding(args: {
	binding: BrowserMediaBinding;
	projectId: string;
	context: OwnershipContext;
}): { database: string; directory: string } {
	if (!isNonEmptyString(args.projectId)) throwOwnershipFailure(args.context);
	const database = `${args.binding.mediaDatabasePrefix}${args.projectId}`;
	const directory = `${args.binding.mediaDirectoryPrefix}${args.projectId}`;
	if (
		database.slice(args.binding.mediaDatabasePrefix.length) !==
			args.projectId ||
		directory.slice(args.binding.mediaDirectoryPrefix.length) !== args.projectId
	) {
		throwOwnershipFailure(args.context);
	}
	return { database, directory };
}

function createBindingRecord(args: {
	binding: BrowserMediaBinding;
	fingerprint: string;
}): Record<string, unknown> {
	return {
		id: mediaBindingKey(args.fingerprint),
		[MEDIA_OWNER_FIELD]: {
			revision: 2,
			kind: "binding",
			fingerprint: args.fingerprint,
			binding: args.binding,
		},
	};
}

function createOwnerRecord(args: {
	fingerprint: string;
	projectId: string;
}): Record<string, unknown> {
	return {
		id: mediaOwnerV2Key(args),
		[MEDIA_OWNER_FIELD]: {
			revision: 2,
			kind: "owner",
			fingerprint: args.fingerprint,
			projectId: args.projectId,
		},
	};
}

function createCoverageRecord(fingerprint: string): Record<string, unknown> {
	return {
		id: mediaCoverageKey(fingerprint),
		[MEDIA_OWNER_FIELD]: {
			revision: 2,
			kind: "coverage",
			fingerprint,
			coverage: "complete",
		},
	};
}

function createLegacyBindingRecord(
	fingerprint: string,
): Record<string, unknown> {
	return {
		id: LEGACY_COVERAGE_KEY,
		[MEDIA_OWNER_FIELD]: {
			revision: 2,
			kind: "legacy-binding",
			fingerprint,
		},
	};
}

function legacyOwnerKey(projectId: string): string {
	return `${LEGACY_OWNER_PREFIX}${encodeURIComponent(projectId)}`;
}

function mediaBindingKey(fingerprint: string): string {
	return `${BINDING_PREFIX}${fingerprint}`;
}

function mediaOwnerV2Key(args: {
	fingerprint: string;
	projectId: string;
}): string {
	return `${OWNER_V2_PREFIX}${args.fingerprint}:${encodeURIComponent(args.projectId)}`;
}

function mediaCoverageKey(fingerprint: string): string {
	return `${COVERAGE_V2_PREFIX}${fingerprint}`;
}

function isMediaBinding(value: unknown): value is BrowserMediaBinding {
	return (
		isRecord(value) &&
		hasExactKeys({
			value,
			expected: [
				"revision",
				"mediaDatabasePrefix",
				"mediaStore",
				"mediaDirectoryPrefix",
			],
		}) &&
		value.revision === 1 &&
		isNonEmptyString(value.mediaDatabasePrefix) &&
		isNonEmptyString(value.mediaStore) &&
		isNonEmptyString(value.mediaDirectoryPrefix) &&
		!value.mediaDatabasePrefix.includes("undefined") &&
		!value.mediaStore.includes("undefined") &&
		!value.mediaDirectoryPrefix.includes("undefined")
	);
}

function sameBinding(args: {
	left: BrowserMediaBinding;
	right: BrowserMediaBinding;
}): boolean {
	return (
		args.left.revision === args.right.revision &&
		args.left.mediaDatabasePrefix === args.right.mediaDatabasePrefix &&
		args.left.mediaStore === args.right.mediaStore &&
		args.left.mediaDirectoryPrefix === args.right.mediaDirectoryPrefix
	);
}

function everyBindingCertified(state: MediaOwnershipState): boolean {
	return [...state.bindings.keys()].every((fingerprint) =>
		state.certificates.has(fingerprint),
	);
}

function hasUnboundLegacyState(state: MediaOwnershipState): boolean {
	return (
		state.legacyCoverage ||
		(state.legacyOwners.size > 0 && state.legacyBindingFingerprint === null)
	);
}

function compareTargets(args: {
	left: MediaClearTarget;
	right: MediaClearTarget;
}): number {
	const { left, right } = args;
	return (
		left.database.localeCompare(right.database) ||
		left.directory.localeCompare(right.directory) ||
		left.fingerprint.localeCompare(right.fingerprint) ||
		left.projectId.localeCompare(right.projectId)
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

function reportLegacyUnbound(args: {
	diagnostic: ((diagnostic: BrowserStoreDiagnostic) => void) | undefined;
	operation: "inspect" | "clear";
}): void {
	args.diagnostic?.({
		level: "warning",
		phase: "media-owner-legacy-binding-required",
		operation: args.operation,
		scope: { kind: "store" },
		code: "unavailable",
		retryable: false,
	});
}

function reportOptionalInventory(
	diagnostic: ((diagnostic: BrowserStoreDiagnostic) => void) | undefined,
): void {
	diagnostic?.({
		level: "warning",
		phase: "media-owner-inventory",
		operation: "clear",
		scope: { kind: "store" },
		code: "unavailable",
		retryable: true,
	});
}

function throwOwnershipFailure(context: OwnershipContext): never {
	throw new ProjectStoreError({
		code: "corrupt",
		operation: context.operation,
		scope: context.scope,
	});
}

function throwTopologyUnavailable(context: OwnershipContext): never {
	throw new ProjectStoreError({
		code: "unavailable",
		operation: context.operation,
		scope: context.scope,
	});
}

function unavailableClear(): ProjectStoreError {
	return new ProjectStoreError({
		code: "unavailable",
		operation: "clear",
		scope: { kind: "store" },
	});
}
