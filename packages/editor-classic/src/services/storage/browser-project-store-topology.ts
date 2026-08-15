import type {
	ProjectStoreErrorScope,
	ProjectStoreOperation,
} from "@opencut/editor-ports";
import {
	projectAuthorityStoreName,
	type BrowserStorageIdentity,
} from "./browser-project-store-internals";

interface TopologyContext {
	readonly operation: ProjectStoreOperation;
	readonly scope: ProjectStoreErrorScope;
}

export interface MediaPhysicalClaim {
	readonly fingerprint: string;
	readonly projectId: string;
	readonly database: string;
	readonly directory: string;
}

export interface LibraryPhysicalClaim {
	readonly fingerprint: string;
	readonly database: string;
	readonly store: string;
}

export type MigrationDatabaseCleanupClaim =
	| {
			readonly kind: "stage-database";
			readonly stage: "projects" | "attachments";
			readonly database: string;
	  }
	| {
			readonly kind: "legacy-database";
			readonly projectId: string;
			readonly database: string;
	  };

export interface MigrationDatabaseSourceClaim {
	readonly kind: "legacy-timeline" | "legacy-media";
	readonly projectId: string;
	readonly database: string;
	readonly mediaOwnerFingerprint?: string;
}

export interface MigrationDirectoryCleanupClaim {
	readonly kind: "legacy-directory";
	readonly projectId: string;
	readonly directory: string;
}

export type BrowserStorageTopologyRequest =
	| { readonly kind: "static-identity"; readonly context: TopologyContext }
	| {
			readonly kind: "media-access";
			readonly candidate: MediaPhysicalClaim;
			readonly knownMedia: readonly MediaPhysicalClaim[];
			readonly knownLibraries: readonly LibraryPhysicalClaim[];
			readonly context: TopologyContext;
	  }
	| {
			readonly kind: "cascade-cleanup";
			readonly media: readonly MediaPhysicalClaim[];
			readonly library: readonly LibraryPhysicalClaim[];
			readonly knownMedia: readonly MediaPhysicalClaim[];
			readonly knownLibraries: readonly LibraryPhysicalClaim[];
			readonly context: TopologyContext;
	  }
	| {
			readonly kind: "migration-cleanup";
			readonly databases: readonly MigrationDatabaseCleanupClaim[];
			readonly directories: readonly MigrationDirectoryCleanupClaim[];
			readonly sources: readonly MigrationDatabaseSourceClaim[];
			readonly knownMedia: readonly MediaPhysicalClaim[];
			readonly knownLibraries: readonly LibraryPhysicalClaim[];
			readonly context: TopologyContext;
	  };

export type BrowserStorageTopologyPermit =
	| Readonly<{ kind: "static-identity" }>
	| Readonly<{ kind: "media-access"; candidate: MediaPhysicalClaim }>
	| Readonly<{
			kind: "cascade-cleanup";
			media: readonly MediaPhysicalClaim[];
			library: readonly LibraryPhysicalClaim[];
	  }>
	| Readonly<{
			kind: "migration-cleanup";
			databases: readonly MigrationDatabaseCleanupClaim[];
			directories: readonly MigrationDirectoryCleanupClaim[];
			sources: readonly MigrationDatabaseSourceClaim[];
	  }>;

export type BrowserStorageTopologyPermitFor<
	Request extends BrowserStorageTopologyRequest,
> = Extract<BrowserStorageTopologyPermit, { kind: Request["kind"] }>;

type TopologyRequestFor<Kind extends BrowserStorageTopologyRequest["kind"]> =
	Extract<BrowserStorageTopologyRequest, { kind: Kind }>;

type TopologyPermitFor<Kind extends BrowserStorageTopologyPermit["kind"]> =
	Extract<BrowserStorageTopologyPermit, { kind: Kind }>;

export type BrowserStorageTopologyConflictReason =
	| "reserved-store-pair"
	| "protected-database"
	| "ambiguous-physical-owner";

export interface BrowserStorageTopologyNames {
	readonly project: {
		readonly database: string;
		readonly stores: BrowserProjectTopologyStoreNames;
	};
	readonly migrationStages: BrowserMigrationStageNames;
}

export interface BrowserProjectTopologyStoreNames {
	readonly public: string;
	readonly authority: string;
	readonly cascade: string;
	readonly mediaOwnership: string;
	readonly libraryClearBindings: string;
	readonly migrationMaintenance: string;
}

export interface BrowserMigrationStageNames {
	readonly projects: { readonly database: string; readonly store: string };
	readonly attachments: { readonly database: string; readonly store: string };
}

export interface BrowserStorageTopology {
	readonly names: BrowserStorageTopologyNames;
	authorize(
		request: TopologyRequestFor<"static-identity">,
	): TopologyPermitFor<"static-identity">;
	authorize(
		request: TopologyRequestFor<"media-access">,
	): TopologyPermitFor<"media-access">;
	authorize(
		request: TopologyRequestFor<"cascade-cleanup">,
	): TopologyPermitFor<"cascade-cleanup">;
	authorize(
		request: TopologyRequestFor<"migration-cleanup">,
	): TopologyPermitFor<"migration-cleanup">;
	authorize(
		request: BrowserStorageTopologyRequest,
	): BrowserStorageTopologyPermit;
}

export class BrowserStorageTopologyConflict extends Error {
	readonly reason: BrowserStorageTopologyConflictReason;

	constructor(reason: BrowserStorageTopologyConflictReason) {
		super("Browser storage topology is unavailable");
		this.name = "BrowserStorageTopologyConflict";
		this.reason = reason;
	}
}

export function isBrowserStorageTopologyConflict(
	error: unknown,
): error is BrowserStorageTopologyConflict {
	return error instanceof BrowserStorageTopologyConflict;
}

export function browserProjectTopologyStoreNames(
	projectsStore: string,
): BrowserProjectTopologyStoreNames {
	return Object.freeze({
		public: projectsStore,
		authority: projectAuthorityStoreName(projectsStore),
		cascade: `${projectsStore}-cascade-maintenance`,
		mediaOwnership: `${projectsStore}-media-ownership`,
		libraryClearBindings: `${projectsStore}-library-clear-bindings`,
		migrationMaintenance: `${projectsStore}-migration-maintenance`,
	});
}

export function browserMigrationStageNames(
	projectsDatabase: string,
): BrowserMigrationStageNames {
	return Object.freeze({
		projects: Object.freeze({
			database: `${projectsDatabase}-c5-projects-stage`,
			store: "staged-projects",
		}),
		attachments: Object.freeze({
			database: `${projectsDatabase}-c5-attachments-stage`,
			store: "staged-attachments",
		}),
	});
}

export function createBrowserStorageTopology(
	identity: BrowserStorageIdentity,
): BrowserStorageTopology {
	return Object.freeze(new BrowserStorageTopologyPolicy(identity));
}

class BrowserStorageTopologyPolicy implements BrowserStorageTopology {
	readonly names: BrowserStorageTopologyNames;
	private readonly identity: BrowserStorageIdentity;
	private readonly protectedDatabases: ReadonlySet<string>;
	private readonly protectedLibraryDatabases: ReadonlySet<string>;
	private readonly reservedLibraryPairs: ReadonlySet<string>;

	constructor(identity: BrowserStorageIdentity) {
		this.identity = identity;
		const stores = browserProjectTopologyStoreNames(identity.projectsStore);
		const migrationStages = browserMigrationStageNames(
			identity.projectsDatabase,
		);
		this.names = Object.freeze({
			project: Object.freeze({ database: identity.projectsDatabase, stores }),
			migrationStages,
		});
		this.protectedDatabases = new Set([
			identity.projectsDatabase,
			identity.libraryDatabase,
			migrationStages.projects.database,
			migrationStages.attachments.database,
		]);
		this.protectedLibraryDatabases = new Set([
			migrationStages.projects.database,
			migrationStages.attachments.database,
		]);
		this.reservedLibraryPairs = projectReservedStorePairs({
			projectsDatabase: identity.projectsDatabase,
			stores,
		});
	}

	authorize(
		request: TopologyRequestFor<"static-identity">,
	): TopologyPermitFor<"static-identity">;
	authorize(
		request: TopologyRequestFor<"media-access">,
	): TopologyPermitFor<"media-access">;
	authorize(
		request: TopologyRequestFor<"cascade-cleanup">,
	): TopologyPermitFor<"cascade-cleanup">;
	authorize(
		request: TopologyRequestFor<"migration-cleanup">,
	): TopologyPermitFor<"migration-cleanup">;
	authorize(
		request: BrowserStorageTopologyRequest,
	): BrowserStorageTopologyPermit;
	authorize(
		request: BrowserStorageTopologyRequest,
	): BrowserStorageTopologyPermit {
		assertStaticIdentity({ identity: this.identity, names: this.names });
		switch (request.kind) {
			case "static-identity":
				return Object.freeze({ kind: "static-identity" });
			case "media-access":
				assertOwnershipClaims({
					media: [...request.knownMedia, request.candidate],
					libraries: request.knownLibraries,
					protectedDatabases: this.protectedDatabases,
					protectedLibraryDatabases: this.protectedLibraryDatabases,
					reservedLibraryPairs: this.reservedLibraryPairs,
				});
				return Object.freeze({
					kind: "media-access",
					candidate: freezeMediaClaim(request.candidate),
				});
			case "cascade-cleanup":
				assertOwnershipClaims({
					media: [...request.knownMedia, ...request.media],
					libraries: [...request.knownLibraries, ...request.library],
					protectedDatabases: this.protectedDatabases,
					protectedLibraryDatabases: this.protectedLibraryDatabases,
					reservedLibraryPairs: this.reservedLibraryPairs,
				});
				return Object.freeze({
					kind: "cascade-cleanup",
					media: Object.freeze(request.media.map(freezeMediaClaim)),
					library: Object.freeze(request.library.map(freezeLibraryClaim)),
				});
			case "migration-cleanup":
				return authorizeMigrationCleanup({
					request,
					names: this.names,
					protectedDatabases: this.protectedDatabases,
					protectedLibraryDatabases: this.protectedLibraryDatabases,
					reservedLibraryPairs: this.reservedLibraryPairs,
				});
		}
	}
}

function assertStaticIdentity(args: {
	identity: BrowserStorageIdentity;
	names: BrowserStorageTopologyNames;
}): void {
	if (!Object.values(args.identity).every(isPhysicalName)) {
		throwConflict("ambiguous-physical-owner");
	}
	const reservedPairs = projectReservedStorePairs({
		projectsDatabase: args.identity.projectsDatabase,
		stores: args.names.project.stores,
	});
	if (
		reservedPairs.has(
			JSON.stringify([
				args.identity.libraryDatabase,
				args.identity.libraryStore,
			]),
		)
	) {
		throwConflict("reserved-store-pair");
	}
	if (
		args.identity.libraryDatabase ===
			args.names.migrationStages.projects.database ||
		args.identity.libraryDatabase ===
			args.names.migrationStages.attachments.database
	) {
		throwConflict("protected-database");
	}
}

function assertOwnershipClaims(args: {
	media: readonly MediaPhysicalClaim[];
	libraries: readonly LibraryPhysicalClaim[];
	protectedDatabases: ReadonlySet<string>;
	protectedLibraryDatabases: ReadonlySet<string>;
	reservedLibraryPairs: ReadonlySet<string>;
}): void {
	for (const claim of args.media) {
		if (!isMediaClaim(claim)) throwConflict("ambiguous-physical-owner");
		if (args.protectedDatabases.has(claim.database)) {
			throwConflict("protected-database");
		}
	}
	for (const claim of args.libraries) {
		if (!isLibraryClaim(claim)) throwConflict("ambiguous-physical-owner");
		if (args.protectedLibraryDatabases.has(claim.database)) {
			throwConflict("protected-database");
		}
		if (
			args.reservedLibraryPairs.has(
				JSON.stringify([claim.database, claim.store]),
			)
		) {
			throwConflict("reserved-store-pair");
		}
	}
	for (let left = 0; left < args.media.length; left += 1) {
		for (let right = left + 1; right < args.media.length; right += 1) {
			const a = args.media[left];
			const b = args.media[right];
			const collides = a.database === b.database || a.directory === b.directory;
			const exactTuple =
				a.database === b.database && a.directory === b.directory;
			if (collides && (!sameMediaOwner({ left: a, right: b }) || !exactTuple)) {
				throwConflict("ambiguous-physical-owner");
			}
		}
	}
	for (const media of args.media) {
		if (args.libraries.some((library) => library.database === media.database)) {
			throwConflict("ambiguous-physical-owner");
		}
	}
	for (let left = 0; left < args.libraries.length; left += 1) {
		for (let right = left + 1; right < args.libraries.length; right += 1) {
			const a = args.libraries[left];
			const b = args.libraries[right];
			if (
				a.database === b.database &&
				a.store === b.store &&
				a.fingerprint !== b.fingerprint
			) {
				throwConflict("ambiguous-physical-owner");
			}
		}
	}
}

function authorizeMigrationCleanup(args: {
	request: Extract<
		BrowserStorageTopologyRequest,
		{ kind: "migration-cleanup" }
	>;
	names: BrowserStorageTopologyNames;
	protectedDatabases: ReadonlySet<string>;
	protectedLibraryDatabases: ReadonlySet<string>;
	reservedLibraryPairs: ReadonlySet<string>;
}): TopologyPermitFor<"migration-cleanup"> {
	assertOwnershipClaims({
		media: args.request.knownMedia,
		libraries: args.request.knownLibraries,
		protectedDatabases: args.protectedDatabases,
		protectedLibraryDatabases: args.protectedLibraryDatabases,
		reservedLibraryPairs: args.reservedLibraryPairs,
	});
	assertMigrationSources({
		sources: args.request.sources,
		cleanupDatabases: args.request.databases,
		knownMedia: args.request.knownMedia,
		knownLibraries: args.request.knownLibraries,
		names: args.names,
	});
	const legacyDatabases = args.request.databases.filter(
		(
			target,
		): target is Extract<
			MigrationDatabaseCleanupClaim,
			{ kind: "legacy-database" }
		> => target.kind === "legacy-database",
	);
	for (const target of args.request.databases) {
		if (!isPhysicalName(target.database)) {
			throwConflict("ambiguous-physical-owner");
		}
		if (target.kind === "stage-database") {
			const canonical = args.names.migrationStages[target.stage].database;
			if (target.database !== canonical) throwConflict("protected-database");
			if (
				legacyDatabases.some((legacy) => legacy.database === target.database) ||
				args.request.knownMedia.some(
					(media) => media.database === target.database,
				) ||
				args.request.knownLibraries.some(
					(library) => library.database === target.database,
				)
			) {
				throwConflict("ambiguous-physical-owner");
			}
			continue;
		}
		if (
			!isPhysicalName(target.projectId) ||
			args.protectedDatabases.has(target.database) ||
			args.request.knownMedia.some(
				(media) => media.database === target.database,
			) ||
			args.request.knownLibraries.some(
				(library) => library.database === target.database,
			)
		) {
			throwConflict("protected-database");
		}
	}
	for (const target of args.request.directories) {
		if (
			!isPhysicalName(target.projectId) ||
			!isPhysicalName(target.directory) ||
			args.request.knownMedia.some(
				(media) => media.directory === target.directory,
			)
		) {
			throwConflict("ambiguous-physical-owner");
		}
	}
	for (let left = 0; left < legacyDatabases.length; left += 1) {
		for (let right = left + 1; right < legacyDatabases.length; right += 1) {
			const a = legacyDatabases[left];
			const b = legacyDatabases[right];
			if (a.database === b.database && a.projectId !== b.projectId) {
				throwConflict("ambiguous-physical-owner");
			}
		}
	}
	for (let left = 0; left < args.request.directories.length; left += 1) {
		for (
			let right = left + 1;
			right < args.request.directories.length;
			right += 1
		) {
			const a = args.request.directories[left];
			const b = args.request.directories[right];
			if (a.directory === b.directory && a.projectId !== b.projectId) {
				throwConflict("ambiguous-physical-owner");
			}
		}
	}
	return Object.freeze({
		kind: "migration-cleanup",
		databases: Object.freeze(
			args.request.databases.map((target) => Object.freeze({ ...target })),
		),
		directories: Object.freeze(
			args.request.directories.map((target) => Object.freeze({ ...target })),
		),
		sources: Object.freeze(
			args.request.sources.map((target) => Object.freeze({ ...target })),
		),
	});
}

function assertMigrationSources(args: {
	sources: readonly MigrationDatabaseSourceClaim[];
	cleanupDatabases: readonly MigrationDatabaseCleanupClaim[];
	knownMedia: readonly MediaPhysicalClaim[];
	knownLibraries: readonly LibraryPhysicalClaim[];
	names: BrowserStorageTopologyNames;
}): void {
	const protectedDatabases = new Set([
		args.names.project.database,
		args.names.migrationStages.projects.database,
		args.names.migrationStages.attachments.database,
		...args.knownLibraries.map((claim) => claim.database),
	]);
	for (const source of args.sources) {
		if (
			!isPhysicalName(source.projectId) ||
			!isPhysicalName(source.database) ||
			(source.mediaOwnerFingerprint !== undefined &&
				(!isPhysicalName(source.mediaOwnerFingerprint) ||
					source.kind !== "legacy-media")) ||
			protectedDatabases.has(source.database)
		) {
			throwConflict("protected-database");
		}
		const collidingMedia = args.knownMedia.filter(
			(claim) => claim.database === source.database,
		);
		if (
			collidingMedia.length > 0 &&
			(source.kind !== "legacy-media" ||
				!source.mediaOwnerFingerprint ||
				collidingMedia.some(
					(claim) =>
						claim.projectId !== source.projectId ||
						claim.fingerprint !== source.mediaOwnerFingerprint,
				))
		) {
			throwConflict("protected-database");
		}
		const collidingCleanup = args.cleanupDatabases.filter(
			(target) => target.database === source.database,
		);
		if (
			collidingCleanup.some(
				(target) =>
					target.kind !== "legacy-database" ||
					target.projectId !== source.projectId ||
					source.kind !== "legacy-timeline",
			)
		) {
			throwConflict("ambiguous-physical-owner");
		}
	}
	for (let left = 0; left < args.sources.length; left += 1) {
		for (let right = left + 1; right < args.sources.length; right += 1) {
			const a = args.sources[left];
			const b = args.sources[right];
			if (
				a.database === b.database &&
				(a.projectId !== b.projectId || a.kind !== b.kind)
			) {
				throwConflict("ambiguous-physical-owner");
			}
		}
	}
}

function sameMediaOwner(args: {
	left: MediaPhysicalClaim;
	right: MediaPhysicalClaim;
}): boolean {
	return (
		args.left.fingerprint === args.right.fingerprint &&
		args.left.projectId === args.right.projectId
	);
}

function isMediaClaim(value: MediaPhysicalClaim): boolean {
	return [
		value.fingerprint,
		value.projectId,
		value.database,
		value.directory,
	].every(isPhysicalName);
}

function isLibraryClaim(value: LibraryPhysicalClaim): boolean {
	return [value.fingerprint, value.database, value.store].every(isPhysicalName);
}

function freezeMediaClaim(claim: MediaPhysicalClaim): MediaPhysicalClaim {
	return Object.freeze({ ...claim });
}

function freezeLibraryClaim(claim: LibraryPhysicalClaim): LibraryPhysicalClaim {
	return Object.freeze({ ...claim });
}

function projectReservedStorePairs(args: {
	projectsDatabase: string;
	stores: BrowserProjectTopologyStoreNames;
}): ReadonlySet<string> {
	return new Set(
		Object.values(args.stores).map((store) =>
			JSON.stringify([args.projectsDatabase, store]),
		),
	);
}

function isPhysicalName(value: unknown): value is string {
	return (
		typeof value === "string" &&
		value.length > 0 &&
		!value.includes("undefined")
	);
}

function throwConflict(reason: BrowserStorageTopologyConflictReason): never {
	throw new BrowserStorageTopologyConflict(reason);
}
