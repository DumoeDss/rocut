import { describe, expect, test } from "bun:test";
import type { ProjectStoreErrorScope } from "@opencut/editor-ports";
import type { BrowserStorageIdentity } from "../browser-project-store-internals";
import type {
	BrowserStorageTopology,
	BrowserStorageTopologyRequest,
	MediaPhysicalClaim,
} from "../browser-project-store-topology";

await import("@/editor/session/__tests__/wasm-test-mock");
const { createBrowserStorageTopology, isBrowserStorageTopologyConflict } =
	await import("../browser-project-store-topology");

const identity: BrowserStorageIdentity = {
	identity: "topology-test",
	projectsDatabase: "topology-projects",
	projectsStore: "projects",
	mediaDatabasePrefix: "topology-media-",
	mediaStore: "media",
	libraryDatabase: "topology-library",
	libraryStore: "library",
	mediaDirectoryPrefix: "topology-files-",
};

const context = {
	operation: "clear" as const,
	scope: { kind: "store" } satisfies ProjectStoreErrorScope,
};

function mediaClaim(args: {
	fingerprint: string;
	projectId: string;
	database: string;
	directory: string;
}): MediaPhysicalClaim {
	return args;
}

function expectConflict(args: {
	topology: BrowserStorageTopology;
	request: BrowserStorageTopologyRequest;
	physicalNames: readonly string[];
}): void {
	let thrown: unknown;
	try {
		args.topology.authorize(args.request);
	} catch (error) {
		thrown = error;
	}
	expect(isBrowserStorageTopologyConflict(thrown)).toBe(true);
	const rendered = String(thrown);
	for (const name of args.physicalNames) expect(rendered).not.toContain(name);
}

describe("browser project store physical topology", () => {
	test("owns every canonical control and migration-stage name", () => {
		const names = createBrowserStorageTopology(identity).names;
		expect(names).toEqual({
			project: {
				database: "topology-projects",
				stores: {
					public: "projects",
					authority: "projects-project-authority",
					cascade: "projects-cascade-maintenance",
					mediaOwnership: "projects-media-ownership",
					libraryClearBindings: "projects-library-clear-bindings",
					migrationMaintenance: "projects-migration-maintenance",
				},
			},
			migrationStages: {
				projects: {
					database: "topology-projects-c5-projects-stage",
					store: "staged-projects",
				},
				attachments: {
					database: "topology-projects-c5-attachments-stage",
					store: "staged-attachments",
				},
			},
		});
	});

	test("rejects every reserved projects-database store pair without leaking its name", () => {
		const base = createBrowserStorageTopology(identity);
		for (const store of Object.values(base.names.project.stores)) {
			const aliased = createBrowserStorageTopology({
				...identity,
				libraryDatabase: identity.projectsDatabase,
				libraryStore: store,
			});
			expectConflict({
				topology: aliased,
				request: { kind: "static-identity", context },
				physicalNames: [identity.projectsDatabase, store],
			});
		}
	});

	test("allows a library to share the projects database through a non-reserved store", () => {
		const topology = createBrowserStorageTopology({
			...identity,
			libraryDatabase: identity.projectsDatabase,
			libraryStore: "safe-library-store",
		});
		const permit = topology.authorize({ kind: "static-identity", context });
		expect(permit).toEqual({ kind: "static-identity" });
		expect(Object.isFrozen(permit)).toBe(true);
	});

	test("rejects retained authorization and ownership store pairs from cascade cleanup", () => {
		const topology = createBrowserStorageTopology(identity);
		for (const store of [
			topology.names.project.stores.libraryClearBindings,
			topology.names.project.stores.mediaOwnership,
		]) {
			expectConflict({
				topology,
				request: {
					kind: "cascade-cleanup",
					media: [],
					library: [
						{
							fingerprint: `retained-${store}`,
							database: identity.projectsDatabase,
							store,
						},
					],
					knownMedia: [],
					knownLibraries: [],
					context,
				},
				physicalNames: [identity.projectsDatabase, store],
			});
		}
	});

	test("rejects every protected database from cascade media deletion", () => {
		const topology = createBrowserStorageTopology(identity);
		const protectedDatabases = [
			identity.projectsDatabase,
			identity.libraryDatabase,
			topology.names.migrationStages.projects.database,
			topology.names.migrationStages.attachments.database,
		];
		for (const database of protectedDatabases) {
			expectConflict({
				topology,
				request: {
					kind: "cascade-cleanup",
					media: [
						mediaClaim({
							fingerprint: "current",
							projectId: "project",
							database,
							directory: "topology-files-project",
						}),
					],
					library: [],
					knownMedia: [],
					knownLibraries: [],
					context,
				},
				physicalNames: [database],
			});
		}
	});

	test("rejects different owners that claim the same database or root directory", () => {
		const topology = createBrowserStorageTopology(identity);
		const known = mediaClaim({
			fingerprint: "old",
			projectId: "old-project",
			database: "old-database",
			directory: "old-directory",
		});
		for (const candidate of [
			mediaClaim({
				fingerprint: "new",
				projectId: "new-project",
				database: known.database,
				directory: "new-directory",
			}),
			mediaClaim({
				fingerprint: "new",
				projectId: "new-project",
				database: "new-database",
				directory: known.directory,
			}),
		]) {
			expectConflict({
				topology,
				request: {
					kind: "media-access",
					candidate,
					knownMedia: [known],
					knownLibraries: [],
					context,
				},
				physicalNames: [candidate.database, candidate.directory],
			});
		}
	});

	test("permits an idempotent retry by the same owner and exact tuple", () => {
		const topology = createBrowserStorageTopology(identity);
		const claim = mediaClaim({
			fingerprint: "same",
			projectId: "same-project",
			database: "same-database",
			directory: "same-directory",
		});
		const permit = topology.authorize({
			kind: "media-access",
			candidate: claim,
			knownMedia: [claim],
			knownLibraries: [],
			context,
		});
		expect(permit).toEqual({ kind: "media-access", candidate: claim });
		expect(Object.isFrozen(permit)).toBe(true);
		expect(Object.isFrozen(permit.candidate)).toBe(true);
	});

	test("allows only canonical stage self-delete with no live physical alias", () => {
		const topology = createBrowserStorageTopology(identity);
		const projectsStage = topology.names.migrationStages.projects;
		const attachmentsStage = topology.names.migrationStages.attachments;
		const permit = topology.authorize({
			kind: "migration-cleanup",
			databases: [
				{
					kind: "stage-database",
					stage: "projects",
					database: projectsStage.database,
				},
				{
					kind: "stage-database",
					stage: "attachments",
					database: attachmentsStage.database,
				},
			],
			directories: [],
			sources: [],
			knownMedia: [],
			knownLibraries: [],
			context,
		});
		expect(permit.kind).toBe("migration-cleanup");
		if (permit.kind !== "migration-cleanup") return;
		expect(permit.databases).toHaveLength(2);
		expect(Object.isFrozen(permit.databases)).toBe(true);
	});

	test("freezes v1 source authority without widening the cleanup subset", () => {
		const topology = createBrowserStorageTopology(identity);
		const projectId = "legacy-project";
		const timelineDatabase = `video-editor-timelines-${projectId}`;
		const legacyMediaDatabase = `video-editor-media-${projectId}`;
		const currentMedia = mediaClaim({
			fingerprint: "current-media",
			projectId,
			database: legacyMediaDatabase,
			directory: "current-media-directory",
		});
		const permit = topology.authorize({
			kind: "migration-cleanup",
			databases: [
				{
					kind: "legacy-database",
					projectId,
					database: timelineDatabase,
				},
			],
			directories: [],
			sources: [
				{ kind: "legacy-timeline", projectId, database: timelineDatabase },
				{
					kind: "legacy-media",
					projectId,
					database: legacyMediaDatabase,
					mediaOwnerFingerprint: currentMedia.fingerprint,
				},
			],
			knownMedia: [currentMedia],
			knownLibraries: [],
			context,
		});
		expect(permit.databases).toHaveLength(1);
		expect(permit.sources).toHaveLength(2);
		expect(Object.isFrozen(permit.sources)).toBe(true);
		expect(permit.databases[0]).toEqual({
			kind: "legacy-database",
			projectId,
			database: timelineDatabase,
		});
	});

	test("rejects a v1 timeline source that aliases a live media database", () => {
		const topology = createBrowserStorageTopology(identity);
		const projectId = "legacy-project";
		const currentMedia = mediaClaim({
			fingerprint: "current-media",
			projectId,
			database: "live-media-database",
			directory: "live-media-directory",
		});
		expectConflict({
			topology,
			request: {
				kind: "migration-cleanup",
				databases: [],
				directories: [],
				sources: [
					{
						kind: "legacy-timeline",
						projectId,
						database: currentMedia.database,
					},
				],
				knownMedia: [currentMedia],
				knownLibraries: [],
				context,
			},
			physicalNames: [currentMedia.database],
		});
	});

	test("rejects a legacy-media source that aliases a different retained binding", () => {
		const topology = createBrowserStorageTopology(identity);
		const projectId = "legacy-project";
		const retainedMedia = mediaClaim({
			fingerprint: "retained-media",
			projectId,
			database: `video-editor-media-${projectId}`,
			directory: "retained-media-directory",
		});
		expectConflict({
			topology,
			request: {
				kind: "migration-cleanup",
				databases: [],
				directories: [],
				sources: [
					{
						kind: "legacy-media",
						projectId,
						database: retainedMedia.database,
					},
				],
				knownMedia: [retainedMedia],
				knownLibraries: [],
				context,
			},
			physicalNames: [retainedMedia.database],
		});
	});

	test("rejects noncanonical or physically aliased stage deletion", () => {
		const topology = createBrowserStorageTopology(identity);
		const stage = topology.names.migrationStages.projects.database;
		for (const request of [
			{
				kind: "migration-cleanup" as const,
				databases: [
					{
						kind: "stage-database" as const,
						stage: "projects" as const,
						database: "not-the-projects-stage",
					},
				],
				directories: [],
				sources: [],
				knownMedia: [],
				knownLibraries: [],
				context,
			},
			{
				kind: "migration-cleanup" as const,
				databases: [
					{
						kind: "stage-database" as const,
						stage: "projects" as const,
						database: stage,
					},
				],
				directories: [],
				sources: [],
				knownMedia: [
					mediaClaim({
						fingerprint: "media",
						projectId: "project",
						database: stage,
						directory: "media-directory",
					}),
				],
				knownLibraries: [],
				context,
			},
			{
				kind: "migration-cleanup" as const,
				databases: [
					{
						kind: "legacy-database" as const,
						projectId: "project",
						database: stage,
					},
				],
				directories: [],
				sources: [],
				knownMedia: [],
				knownLibraries: [],
				context,
			},
		]) {
			expectConflict({
				topology,
				request,
				physicalNames: [stage, request.databases[0].database],
			});
		}
	});
});
