import { expect, spyOn, test } from "bun:test";
import { trackId } from "@opencut/editor-contracts";
import * as adapterModule from "../adapter";
import { ProjectMutationArbiter } from "../arbiter";
import { SessionOpenCutTransactions } from "../router";
import { diffOpenCutProjection, projectOpenCutDraft } from "../projection";
import { SessionPersistenceCoordinator } from "../../../persistence";
import { projectFixture, storeFixture, TEST_PROJECT_ID } from "./fixture";

test("legacy saves and UI/automation commits each adopt one durable record; failed saves adopt none", async () => {
	const fixture = await storeFixture();
	const arbiter = new ProjectMutationArbiter();
	const persistence = new SessionPersistenceCoordinator(fixture.store, arbiter);
	const publications: string[] = [];
	const facade = new SessionOpenCutTransactions({
		persistence,
		arbiter,
		publish: (draft) => publications.push(draft.project.metadata.name),
	});
	const original = adapterModule.createOpenCutTransactionDocumentAdapter;
	let adoptions = 0;
	const publicationsAdopted = spyOn(persistence, "adoptCommittedProjectRecord");
	const factory = spyOn(
		adapterModule,
		"createOpenCutTransactionDocumentAdapter",
	).mockImplementation((args) => {
		const adapter = original(args);
		const adopt = adapter.adoptCommittedRecord;
		adapter.adoptCommittedRecord = (...args) => {
			adoptions++;
			expect(args[1]).toEqual({ takeOwnership: true });
			adopt(...args);
		};
		return adapter;
	});
	try {
		await facade.open({ projectId: TEST_PROJECT_ID, assets: [] });
		expect(adoptions).toBe(0);
		const legacy = projectFixture();
		// Ordinary saves carry donor-private state; public renames must be transactions.
		legacy.settings.canvasSizeMode = "custom";
		await persistence.saveProject({ project: legacy });
		expect(adoptions).toBe(1);
		expect(publicationsAdopted).not.toHaveBeenCalled();
		await facade.apply({
			operations: [
				{
					kind: "update-track",
					trackId: trackId("main-track"),
					patch: { name: "Automation track" },
				},
			],
		});
		expect(adoptions).toBe(2);
		expect(publicationsAdopted).toHaveBeenCalledTimes(1);
		expect(publicationsAdopted.mock.calls[0][0]).toMatchObject({
			returnProject: false,
			takeOwnership: true,
		});
		expect(publications).toEqual(["OpenCut routing"]);
		expect(
			persistence.readCachedProject({ id: TEST_PROJECT_ID })?.settings
				.canvasSizeMode,
		).toEqual(legacy.settings.canvasSizeMode);
		await facade.commitUi({
			baseDraft: () => {
				const project = persistence.readCachedProject({ id: TEST_PROJECT_ID });
				if (!project) throw new Error("missing cached project");
				return { project, assetCatalog: [] };
			},
			prepare: ({ draft, baseDocument, baseRevision }) => {
				draft.project.metadata.name = "UI name";
				const after = projectOpenCutDraft(draft, {
					revision: baseRevision,
					idempotency: [],
				});
				return {
					draft,
					operations: diffOpenCutProjection({ before: baseDocument, after }),
					payload: undefined,
				};
			},
		});
		expect(adoptions).toBe(3);
		expect(publicationsAdopted).toHaveBeenCalledTimes(2);
		expect(publicationsAdopted.mock.calls[1][0]).toMatchObject({
			returnProject: false,
			takeOwnership: true,
		});
		expect(publications).toEqual(["OpenCut routing", "UI name"]);
		expect((await facade.tracks())[0].name).toBe("Automation track");
		fixture.control.failNext({
			operation: "save-project",
			code: "unavailable",
		});
		await expect(
			facade.apply({
				operations: [
					{
						kind: "update-track",
						trackId: trackId("main-track"),
						patch: { name: "Must not publish" },
					},
				],
			}),
		).rejects.toMatchObject({ code: "unavailable" });
		expect(adoptions).toBe(3);
		expect(publicationsAdopted).toHaveBeenCalledTimes(2);
		expect(publications).toEqual(["OpenCut routing", "UI name"]);
		expect((await facade.tracks())[0].name).toBe("Automation track");
	} finally {
		await facade.dispose();
		factory.mockRestore();
		publicationsAdopted.mockRestore();
	}
});
