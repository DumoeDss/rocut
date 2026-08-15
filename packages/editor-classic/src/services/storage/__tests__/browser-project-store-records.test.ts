import { describe, expect, test } from "bun:test";
import type { ProjectRecord, ProjectSummary } from "@opencut/editor-ports";

await import("../../../editor/session/__tests__/wasm-test-mock");
const records = await import("../browser-project-store-records");
const internals = await import("../browser-project-store-internals");
const { ATTACHMENT_ENVELOPE_KEY, PROJECT_ENVELOPE_KEY } = internals;

type StoredPair = {
	publicRow: Record<string, unknown> | null;
	authorityRow: Record<string, unknown>;
};

type DecodedProject = {
	record: ProjectRecord;
	summary: ProjectSummary;
};

type DecodedAttachment =
	| {
			kind: "attachment";
			projectId: string;
			key: string;
			metadata: unknown;
			bodyKey: string;
			revision: "current" | "legacy" | 1 | 2;
			mutationId: string | null;
			bodyDigest: string | null;
			byteLength: number | null;
			retiredBodyKeys: readonly string[];
	  }
	| {
			kind: "tombstone";
			projectId: string;
			key: string;
			revision: "current" | 2;
			mutationId: string;
			retiredBodyKeys: readonly string[];
	  };

interface CurrentRecordCodecSurface {
	createCurrentStoredProject?: (args: {
		record: ProjectRecord;
		summary: ProjectSummary;
	}) => StoredPair;
	decodeStoredProjectPair?: (args: {
		publicRow: unknown | null;
		authorityRow: unknown | null;
	}) => DecodedProject | null;
	createCurrentStoredAttachment?: (args: {
		projectId: string;
		key: string;
		metadata: unknown;
		bodyKey: string;
		mutationId: string;
		bodyDigest: string;
		byteLength: number;
		retiredBodyKeys?: readonly string[];
	}) => StoredPair;
	createCurrentStoredAttachmentTombstone?: (args: {
		projectId: string;
		key: string;
		mutationId: string;
		retiredBodyKeys?: readonly string[];
	}) => StoredPair;
	decodeStoredAttachmentPair?: (args: {
		projectId: string;
		publicRow: unknown | null;
		authorityRow: unknown | null;
	}) => DecodedAttachment | null;
}

const current = records as typeof records & CurrentRecordCodecSurface;
const privateNames = internals as typeof internals & {
	projectAuthorityStoreName?: (projectsStore: string) => string;
	attachmentAuthorityStoreName?: (mediaStore: string) => string;
};

function requireCodec<Codec>(args: {
	codec: Codec | undefined;
	name: string;
}): Codec {
	const { codec, name } = args;
	expect(typeof codec, `${name} must be implemented`).toBe("function");
	if (codec === undefined) throw new Error(`${name} is unavailable`);
	return codec;
}

function attachmentMetadata(value: DecodedAttachment | null): unknown {
	expect(value?.kind).toBe("attachment");
	return value?.kind === "attachment" ? value.metadata : undefined;
}

const summary: ProjectSummary = {
	id: "project-1",
	name: "Project one",
	createdAt: "2026-08-02T00:00:00.000Z",
	updatedAt: "2026-08-02T01:00:00.000Z",
};

const projectData = {
	metadata: {
		id: "project-1",
		name: "Project one",
		duration: 120_000,
		createdAt: "2026-08-02T00:00:00.000Z",
		updatedAt: "2026-08-02T01:00:00.000Z",
	},
	scenes: [],
	currentSceneId: "scene-main",
	settings: { fps: 30, canvasSize: { width: 1920, height: 1080 } },
	version: 31,
	timelineViewState: { playheadTime: 4_000, zoomLevel: 7.25 },
	providerPrivate: new Map([["keep", { nested: true }]]),
};

test("derives private authority store names without widening storage identity", () => {
	const projectName = requireCodec({
		codec: privateNames.projectAuthorityStoreName,
		name: "projectAuthorityStoreName",
	});
	const attachmentName = requireCodec({
		codec: privateNames.attachmentAuthorityStoreName,
		name: "attachmentAuthorityStoreName",
	});
	expect(projectName("projects")).toBe("projects-project-authority");
	expect(attachmentName("media-metadata")).toBe(
		"media-metadata-attachment-authority",
	);
});

describe("current browser project record pairs", () => {
	test("projects the ordinary public project row exactly as C4 without duplicating the document", () => {
		const create = requireCodec({
			codec: current.createCurrentStoredProject,
			name: "createCurrentStoredProject",
		});
		const pair = create({
			record: { id: "project-1", schemaVersion: 31, data: projectData },
			summary,
		});

		expect(pair.publicRow).toEqual({ id: "project-1", ...projectData });
		expect(pair.publicRow).not.toHaveProperty(PROJECT_ENVELOPE_KEY);
		expect(pair.authorityRow).toEqual({
			id: "project-1",
			revision: 1,
			schemaVersion: 31,
			summary,
			payload: { kind: "project-row", hadOwnRootId: false },
		});
		expect(pair.authorityRow).not.toHaveProperty("record");
		expect(pair.authorityRow).not.toHaveProperty("data");
	});

	test("reconstructs own-root-id and non-projectable opaque payloads exactly", () => {
		const create = requireCodec({
			codec: current.createCurrentStoredProject,
			name: "createCurrentStoredProject",
		});
		const decode = requireCodec({
			codec: current.decodeStoredProjectPair,
			name: "decodeStoredProjectPair",
		});
		const ownRootData = {
			id: { provider: "opaque-root-id" },
			value: new Set(["keep"]),
		};
		const ownRootPair = create({
			record: { id: "project-1", schemaVersion: 31, data: ownRootData },
			summary,
		});
		expect(ownRootPair.publicRow).toEqual({
			id: "project-1",
			value: new Set(["keep"]),
		});
		expect(ownRootPair.authorityRow).toMatchObject({
			payload: {
				kind: "project-row",
				hadOwnRootId: true,
				rootId: { provider: "opaque-root-id" },
			},
		});
		expect(
			decode({
				publicRow: ownRootPair.publicRow,
				authorityRow: ownRootPair.authorityRow,
			}),
		).toEqual({
			record: { id: "project-1", schemaVersion: 31, data: ownRootData },
			summary,
		});

		const opaqueData = new Map<string, unknown>([
			["root", new Date("2026-08-02T02:00:00.000Z")],
		]);
		const opaquePair = create({
			record: { id: "project-1", schemaVersion: 31, data: opaqueData },
			summary,
		});
		expect(opaquePair.publicRow).toEqual({ id: "project-1" });
		expect(opaquePair.authorityRow).toMatchObject({
			payload: { kind: "opaque", data: opaqueData },
		});
		expect(
			decode({
				publicRow: opaquePair.publicRow,
				authorityRow: opaquePair.authorityRow,
			})?.record.data,
		).toEqual(opaqueData);
	});

	test("defensively clones pair inputs and decoded outputs while rejecting identity mismatch", () => {
		const create = requireCodec({
			codec: current.createCurrentStoredProject,
			name: "createCurrentStoredProject",
		});
		const decode = requireCodec({
			codec: current.decodeStoredProjectPair,
			name: "decodeStoredProjectPair",
		});
		const data = { nested: { value: "keep" } };
		const pair = create({
			record: { id: "project-1", schemaVersion: 31, data },
			summary,
		});
		expect(pair.publicRow).not.toBe(data);
		expect(pair.publicRow?.nested).not.toBe(data.nested);
		const decoded = decode({
			publicRow: pair.publicRow,
			authorityRow: pair.authorityRow,
		});
		expect(decoded?.record.data).not.toBe(pair.publicRow);
		expect(decoded?.summary).not.toBe(pair.authorityRow.summary);
		expect(() =>
			create({
				record: { id: "project-1", schemaVersion: 31, data },
				summary: { ...summary, id: "other-project" },
			}),
		).toThrow();
	});
});

describe("current browser attachment record pairs", () => {
	test("keeps the public media row C4-exact and the complete logical metadata private", () => {
		const create = requireCodec({
			codec: current.createCurrentStoredAttachment,
			name: "createCurrentStoredAttachment",
		});
		const decode = requireCodec({
			codec: current.decodeStoredAttachmentPair,
			name: "decodeStoredAttachmentPair",
		});
		const metadata = {
			id: "media-1",
			name: "clip.mp4",
			type: "video",
			size: 999_999,
			mimeType: "video/mp4",
			lastModified: 42,
			width: 1920,
			height: 1080,
			duration: 12.5,
			fps: 60,
			hasAudio: true,
			ephemeral: false,
			thumbnailUrl: "data:image/png;base64,AA==",
			providerPrivate: new Map([["keep", true]]),
			[ATTACHMENT_ENVELOPE_KEY]: { providerOwned: "keep" },
		};
		const pair = create({
			projectId: "project-1",
			key: "media-1",
			metadata,
			bodyKey: ".c5-body-current",
			mutationId: ".c5-attachment-mutation-current",
			bodyDigest: `sha256:${"a".repeat(64)}`,
			byteLength: 321,
			retiredBodyKeys: ["legacy-body-name", ".c5-body-retired"],
		});

		expect(pair.publicRow).toEqual({
			id: "media-1",
			name: "clip.mp4",
			type: "video",
			size: 321,
			lastModified: 42,
			width: 1920,
			height: 1080,
			duration: 12.5,
			thumbnailUrl: "data:image/png;base64,AA==",
			ephemeral: false,
		});
		expect(pair.publicRow).not.toHaveProperty("mimeType");
		expect(pair.publicRow).not.toHaveProperty("fps");
		expect(pair.publicRow).not.toHaveProperty("hasAudio");
		expect(pair.publicRow).not.toHaveProperty(ATTACHMENT_ENVELOPE_KEY);
		expect(pair.authorityRow).toEqual({
			id: "media-1",
			revision: 1,
			kind: "attachment",
			projectId: "project-1",
			key: "media-1",
			metadata,
			bodyKey: ".c5-body-current",
			mutationId: ".c5-attachment-mutation-current",
			bodyDigest: `sha256:${"a".repeat(64)}`,
			byteLength: 321,
			retiredBodyKeys: ["legacy-body-name", ".c5-body-retired"],
		});
		expect(
			decode({
				projectId: "project-1",
				publicRow: pair.publicRow,
				authorityRow: pair.authorityRow,
			}),
		).toEqual({
			kind: "attachment",
			projectId: "project-1",
			key: "media-1",
			metadata,
			bodyKey: ".c5-body-current",
			revision: "current",
			mutationId: ".c5-attachment-mutation-current",
			bodyDigest: `sha256:${"a".repeat(64)}`,
			byteLength: 321,
			retiredBodyKeys: ["legacy-body-name", ".c5-body-retired"],
		});
		const oldAuthority = { ...pair.authorityRow };
		delete oldAuthority.retiredBodyKeys;
		expect(
			decode({
				projectId: "project-1",
				publicRow: pair.publicRow,
				authorityRow: oldAuthority,
			}),
		).toMatchObject({ retiredBodyKeys: [] });
		expect(
			decode({
				projectId: "project-1",
				publicRow: pair.publicRow,
				authorityRow: {
					...pair.authorityRow,
					retiredBodyKeys: ["duplicate", "duplicate"],
				},
			}),
		).toBeNull();
	});

	test("uses an id-only public row for generic metadata while retaining it exactly", () => {
		const create = requireCodec({
			codec: current.createCurrentStoredAttachment,
			name: "createCurrentStoredAttachment",
		});
		const decode = requireCodec({
			codec: current.decodeStoredAttachmentPair,
			name: "decodeStoredAttachmentPair",
		});
		const metadata = {
			id: "provider-id-that-is-not-the-key",
			value: new Date("2026-08-02T03:00:00.000Z"),
		};
		const pair = create({
			projectId: "project-1",
			key: "logical-key",
			metadata,
			bodyKey: "body",
			mutationId: "mutation",
			bodyDigest: `sha256:${"b".repeat(64)}`,
			byteLength: 7,
		});
		expect(pair.publicRow).toEqual({ id: "logical-key" });
		expect(
			attachmentMetadata(
				decode({
					projectId: "project-1",
					publicRow: pair.publicRow,
					authorityRow: pair.authorityRow,
				}),
			),
		).toEqual(metadata);
		expect(pair.authorityRow.metadata).not.toBe(metadata);
		expect(
			attachmentMetadata(
				decode({
					projectId: "project-1",
					publicRow: pair.publicRow,
					authorityRow: pair.authorityRow,
				}),
			),
		).not.toBe(pair.authorityRow.metadata);
	});
});

describe("three-generation browser record compatibility", () => {
	test("prefers a valid sidecar over provider-owned envelope-looking fields", () => {
		const createProject = requireCodec({
			codec: current.createCurrentStoredProject,
			name: "createCurrentStoredProject",
		});
		const decodeProject = requireCodec({
			codec: current.decodeStoredProjectPair,
			name: "decodeStoredProjectPair",
		});
		const providerData = {
			...projectData,
			[PROJECT_ENVELOPE_KEY]: { providerOwned: "project" },
		};
		const projectPair = createProject({
			record: { id: "project-1", schemaVersion: 31, data: providerData },
			summary,
		});
		expect(
			decodeProject({
				publicRow: projectPair.publicRow,
				authorityRow: projectPair.authorityRow,
			})?.record.data,
		).toEqual(providerData);

		const createAttachment = requireCodec({
			codec: current.createCurrentStoredAttachment,
			name: "createCurrentStoredAttachment",
		});
		const decodeAttachment = requireCodec({
			codec: current.decodeStoredAttachmentPair,
			name: "decodeStoredAttachmentPair",
		});
		const metadata = {
			id: "generic",
			provider: true,
			[ATTACHMENT_ENVELOPE_KEY]: { providerOwned: "attachment" },
		};
		const attachmentPair = createAttachment({
			projectId: "project-1",
			key: "generic",
			metadata,
			bodyKey: "body",
			mutationId: "mutation",
			bodyDigest: `sha256:${"c".repeat(64)}`,
			byteLength: 1,
		});
		expect(
			attachmentMetadata(
				decodeAttachment({
					projectId: "project-1",
					publicRow: attachmentPair.publicRow,
					authorityRow: attachmentPair.authorityRow,
				}),
			),
		).toEqual(metadata);
	});

	test("falls back from absent sidecars to inline C5 and then C4 raw rows", () => {
		const decodeProject = requireCodec({
			codec: current.decodeStoredProjectPair,
			name: "decodeStoredProjectPair",
		});
		const inlineProject = records.createStoredProject({
			record: { id: "project-1", schemaVersion: 31, data: projectData },
			summary,
		});
		expect(
			decodeProject({ publicRow: inlineProject, authorityRow: null }),
		).toEqual({
			record: { id: "project-1", schemaVersion: 31, data: projectData },
			summary,
		});
		const rawProject = { id: "raw-project", ...projectData, version: 17 };
		expect(
			decodeProject({ publicRow: rawProject, authorityRow: null })?.record,
		).toEqual({ id: "raw-project", schemaVersion: 17, data: rawProject });

		const decodeAttachment = requireCodec({
			codec: current.decodeStoredAttachmentPair,
			name: "decodeStoredAttachmentPair",
		});
		const inlineAttachment = records.createStoredAttachment({
			projectId: "project-1",
			key: "inline",
			metadata: { provider: "inline" },
			bodyKey: "inline-body",
			mutationId: "inline-mutation",
			bodyDigest: `sha256:${"d".repeat(64)}`,
			byteLength: 3,
		});
		expect(
			decodeAttachment({
				projectId: "project-1",
				publicRow: inlineAttachment,
				authorityRow: null,
			}),
		).toMatchObject({
			kind: "attachment",
			key: "inline",
			metadata: { provider: "inline" },
			revision: 2,
		});
		const rawAttachment = {
			id: "raw",
			name: "raw.wav",
			type: "audio",
			size: 4,
			lastModified: 8,
		};
		expect(
			decodeAttachment({
				projectId: "project-1",
				publicRow: rawAttachment,
				authorityRow: null,
			}),
		).toMatchObject({
			kind: "attachment",
			key: "raw",
			metadata: rawAttachment,
			bodyKey: "raw",
			revision: "legacy",
		});
	});

	test("fails closed for malformed, mismatched, or incomplete current pairs", () => {
		const createProject = requireCodec({
			codec: current.createCurrentStoredProject,
			name: "createCurrentStoredProject",
		});
		const decodeProject = requireCodec({
			codec: current.decodeStoredProjectPair,
			name: "decodeStoredProjectPair",
		});
		const projectPair = createProject({
			record: { id: "project-1", schemaVersion: 31, data: projectData },
			summary,
		});
		expect(
			decodeProject({
				publicRow: null,
				authorityRow: projectPair.authorityRow,
			}),
		).toBeNull();
		expect(
			decodeProject({
				publicRow: projectPair.publicRow,
				authorityRow: { ...projectPair.authorityRow, id: "other" },
			}),
		).toBeNull();
		expect(
			decodeProject({
				publicRow: projectPair.publicRow,
				authorityRow: { ...projectPair.authorityRow, unexpected: true },
			}),
		).toBeNull();

		const createAttachment = requireCodec({
			codec: current.createCurrentStoredAttachment,
			name: "createCurrentStoredAttachment",
		});
		const decodeAttachment = requireCodec({
			codec: current.decodeStoredAttachmentPair,
			name: "decodeStoredAttachmentPair",
		});
		const attachmentPair = createAttachment({
			projectId: "project-1",
			key: "media-1",
			metadata: { id: "media-1" },
			bodyKey: "body",
			mutationId: "mutation",
			bodyDigest: `sha256:${"e".repeat(64)}`,
			byteLength: 1,
		});
		expect(
			decodeAttachment({
				projectId: "project-1",
				publicRow: null,
				authorityRow: attachmentPair.authorityRow,
			}),
		).toBeNull();
		expect(
			decodeAttachment({
				projectId: "other-project",
				publicRow: attachmentPair.publicRow,
				authorityRow: attachmentPair.authorityRow,
			}),
		).toBeNull();
		expect(
			decodeAttachment({
				projectId: "project-1",
				publicRow: attachmentPair.publicRow,
				authorityRow: {
					...attachmentPair.authorityRow,
					bodyDigest: "not-a-digest",
				},
			}),
		).toBeNull();
	});

	test("represents a current deletion as a strict authority-only tombstone", () => {
		const create = requireCodec({
			codec: current.createCurrentStoredAttachmentTombstone,
			name: "createCurrentStoredAttachmentTombstone",
		});
		const decode = requireCodec({
			codec: current.decodeStoredAttachmentPair,
			name: "decodeStoredAttachmentPair",
		});
		const pair = create({
			projectId: "project-1",
			key: "media-1",
			mutationId: "deleted-mutation",
			retiredBodyKeys: ["legacy-body-name", ".c5-stage-valid-old-body"],
		});
		expect(pair).toEqual({
			publicRow: null,
			authorityRow: {
				id: "media-1",
				revision: 1,
				kind: "deleted",
				projectId: "project-1",
				key: "media-1",
				mutationId: "deleted-mutation",
				retiredBodyKeys: ["legacy-body-name", ".c5-stage-valid-old-body"],
			},
		});
		expect(
			decode({
				projectId: "project-1",
				publicRow: null,
				authorityRow: pair.authorityRow,
			}),
		).toEqual({
			kind: "tombstone",
			projectId: "project-1",
			key: "media-1",
			revision: "current",
			mutationId: "deleted-mutation",
			retiredBodyKeys: ["legacy-body-name", ".c5-stage-valid-old-body"],
		});
		expect(
			decode({
				projectId: "project-1",
				publicRow: { id: "media-1" },
				authorityRow: pair.authorityRow,
			}),
		).toBeNull();
	});
});
