import { describe, expect, test } from "bun:test";
import { assetId, clipId, revisionOf, trackId } from "@/editor/contracts";
import { openTransactionEngine } from "@/editor/contracts/engine";
import { validateTransactionDocument } from "@/editor/contracts/engine/invariant";
import { SessionPersistenceCoordinator } from "@/editor/persistence";
import {
	createOpenCutTransactionDocumentAdapter,
	digestProjectRecord,
	diffOpenCutProjection,
	ProjectMutationArbiter,
	projectOpenCutDraft,
	publicDocumentsEqual,
	SessionOpenCutTransactions,
	type OpenCutCommitToken,
	type OpenCutProjectDraft,
} from "@/editor/transactions/opencut";
import { cloneOpaque } from "@/editor/persistence/opaque-value";
import { projectFixture, recordFixture, storeFixture, TEST_PROJECT_ID } from "./fixture";

describe("OpenCut transaction projection and router", () => {
	test("audio donor candidates encode into a valid reopenable document", async () => {
		const initialRecord = recordFixture();
		const adapter = createOpenCutTransactionDocumentAdapter({
			initialRecord,
			initialAssets: [],
		});
		const draft: OpenCutProjectDraft = {
			project: projectFixture(),
			assetCatalog: [
				{ id: "audio-asset", name: "tone.wav", type: "audio", duration: 2 },
			],
		};
		draft.project.scenes[0].tracks.audio.push({
			id: "audio-track",
			name: "Audio track",
			type: "audio",
			muted: false,
			elements: [
				{
					id: "audio-clip",
					name: "tone.wav",
					type: "audio",
					sourceType: "upload",
					mediaId: "audio-asset",
					startTime: 0 as never,
					duration: 240_000 as never,
					trimStart: 0 as never,
					trimEnd: 0 as never,
					params: {},
				},
			],
		});
		const token = "opencut-ui:audio" as OpenCutCommitToken;
		const document = projectOpenCutDraft(draft, {
			revision: revisionOf(1),
			idempotency: [
				{
					key: token,
					fingerprint: "audio",
					result: {
						revision: revisionOf(1),
						createdIds: [
							assetId("audio-asset"),
							trackId("audio-track"),
							clipId("audio-clip"),
						],
						changedIds: [],
					},
				},
			],
		});
		adapter.stage({
			token,
			baseRevision: 0,
			previousRecordDigest: digestProjectRecord(initialRecord),
			draft,
			projectedDocument: document,
		});
		const encoded = adapter.encode({
			projectId: TEST_PROJECT_ID,
			previousRecord: initialRecord,
			document,
		});
		const decoded = adapter.decode({
			projectId: TEST_PROJECT_ID,
			record: encoded.record,
		});
		expect(validateTransactionDocument({
			projectId: TEST_PROJECT_ID,
			document: decoded,
		})).toEqual([]);
		expect(publicDocumentsEqual(decoded, document)).toBe(true);
	});

	test("projects donor entities and emits stable minimal dependency order", () => {
		const beforeDraft: OpenCutProjectDraft = {
			project: projectFixture(),
			assetCatalog: [],
		};
		const afterDraft = cloneOpaque(beforeDraft);
		afterDraft.assetCatalog.push({
			id: "asset-a",
			name: "A",
			type: "video",
			duration: 1,
		});
		afterDraft.project.scenes[0].tracks.overlay.push({
			id: "overlay-a",
			name: "Overlay",
			type: "video",
			hidden: false,
			muted: false,
			elements: [
				{
					id: "clip-a",
					name: "Clip",
					type: "video",
					mediaId: "asset-a",
					startTime: 0 as never,
					duration: 4_000 as never,
					trimStart: 0 as never,
					trimEnd: 0 as never,
					params: {},
				},
			],
		});
		afterDraft.project.scenes[0].bookmarks.push({
			time: 4_000 as never,
			note: "marker",
		});
		const before = projectOpenCutDraft(beforeDraft, {
			revision: revisionOf(0),
			idempotency: [],
		});
		const after = projectOpenCutDraft(afterDraft, {
			revision: revisionOf(0),
			idempotency: [],
		});
		const first = diffOpenCutProjection({ before, after });
		const second = diffOpenCutProjection({ before, after });
		expect(first).toEqual(second);
		expect(first.map((operation) => operation.kind)).toEqual([
			"create-asset",
			"create-track",
			"create-clip",
			"create-marker",
		]);
		expect(() => diffOpenCutProjection({ before, after: before })).toThrow(
			"non-empty",
		);
	});

	test("staged binding rejects a wrong record digest before save", async () => {
		const fixture = await storeFixture();
		const initialRecord = await fixture.store.load({ id: TEST_PROJECT_ID });
		if (!initialRecord) throw new Error("missing fixture record");
		const adapter = createOpenCutTransactionDocumentAdapter({
			initialRecord,
			initialAssets: [],
		});
		const engine = await openTransactionEngine({
			store: fixture.store,
			projectId: TEST_PROJECT_ID,
			documentAdapter: adapter,
		});
		const draft = { project: projectFixture(), assetCatalog: [] };
		draft.project.scenes[0].tracks.main.name = "Candidate";
		const token = "opencut-ui:mismatch" as OpenCutCommitToken;
		adapter.stage({
			token,
			baseRevision: 0,
			previousRecordDigest: "wrong",
			draft,
			projectedDocument: projectOpenCutDraft(draft, {
				revision: revisionOf(1),
				idempotency: [],
			}),
		});
		await expect(
			engine.apply({
				operations: [
					{
						kind: "update-track",
						trackId: trackId("main-track"),
						patch: { name: "Candidate" },
					},
				],
				idempotencyKey: token,
			}),
		).rejects.toMatchObject({ operation: "save-project" });
		expect(fixture.getSaveCount()).toBe(0);
		expect(Number(await engine.revision())).toBe(0);
	});

	test("UI and automation share invocation order, exact adoption, and opaque overlay", async () => {
		const fixture = await storeFixture();
		const arbiter = new ProjectMutationArbiter();
		const persistence = new SessionPersistenceCoordinator(
			fixture.store,
			arbiter,
		);
		await persistence.loadProject({ id: TEST_PROJECT_ID });
		const publications: string[] = [];
		const facade = new SessionOpenCutTransactions({
			persistence,
			arbiter,
			publish: (draft) => {
				publications.push(draft.project.scenes[0].tracks.main.name);
			},
		});
		await facade.open({ projectId: TEST_PROJECT_ID, assets: [] });
		const watched: number[] = [];
		facade.watch((revision) => watched.push(revision));

		const ui = facade.commitUi({
			baseDraft: () => ({ project: projectFixture(), assetCatalog: [] }),
			prepare: ({ draft, baseDocument, baseRevision }) => {
				draft.project.scenes[0].tracks.main.name = "UI";
				const after = projectOpenCutDraft(draft, {
					revision: baseRevision,
					idempotency: [],
				});
				return {
					draft,
					operations: diffOpenCutProjection({ before: baseDocument, after }),
					payload: "ui",
				};
			},
		});
		const automation = facade.apply({
			operations: [
				{
					kind: "update-track",
					trackId: trackId("main-track"),
					patch: { name: "Automation" },
				},
			],
		});
		const [uiResult, automationResult] = await Promise.all([ui, automation]);
		expect(
			[uiResult.transaction.revision, automationResult.revision].map(Number),
		).toEqual([
			1, 2,
		]);
		expect(watched.map(Number)).toEqual([1, 2]);
		expect(publications).toEqual(["UI", "Automation"]);
		expect(fixture.getSaveCount()).toBe(2);
		expect(
			persistence.readCachedProject({ id: TEST_PROJECT_ID })?.scenes[0].tracks
				.main.name,
		).toBe("Automation");
		const record = await fixture.store.load({ id: TEST_PROJECT_ID });
		expect(
			(record?.data as { nestedOpaque?: unknown }).nestedOpaque,
		).toEqual({ sentinel: ["keep", { value: 42 }] });
		await facade.dispose();
		const reopened = new SessionOpenCutTransactions({
			persistence,
			arbiter,
			publish: () => undefined,
		});
		await reopened.open({ projectId: TEST_PROJECT_ID, assets: [] });
		expect(Number(await reopened.revision())).toBe(2);
		expect((await reopened.tracks())[0].name).toBe("Automation");
		await reopened.dispose();
	});

	test("durable failure publishes nothing and leaves the shared queue usable", async () => {
		const fixture = await storeFixture();
		const arbiter = new ProjectMutationArbiter();
		const persistence = new SessionPersistenceCoordinator(fixture.store, arbiter);
		await persistence.loadProject({ id: TEST_PROJECT_ID });
		let publications = 0;
		const facade = new SessionOpenCutTransactions({
			persistence,
			arbiter,
			publish: () => publications++,
		});
		await facade.open({ projectId: TEST_PROJECT_ID, assets: [] });
		fixture.control.failNext({ operation: "save-project", code: "unavailable" });
		await expect(
			facade.apply({
				operations: [
					{
						kind: "update-track",
						trackId: trackId("main-track"),
						patch: { name: "failed" },
					},
				],
			}),
		).rejects.toMatchObject({ code: "unavailable" });
		expect(Number(await facade.revision())).toBe(0);
		expect(publications).toBe(0);
		await facade.apply({
			operations: [
				{
					kind: "update-track",
					trackId: trackId("main-track"),
					patch: { name: "later" },
				},
			],
		});
		expect(Number(await facade.revision())).toBe(1);
		expect(publications).toBe(1);
	});
});
