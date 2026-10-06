import { expect, spyOn, test } from "bun:test";
import { trackId } from "@opencut/editor-contracts";
import * as adapterModule from "../adapter";
import { ProjectMutationArbiter } from "../arbiter";
import { SessionOpenCutTransactions } from "../router";
import { diffOpenCutProjection, projectOpenCutDraft } from "../projection";
import type {
	EncodedOpenCutPublicationReceipt,
	OpenCutProjectDraft,
} from "../types";
import { SessionPersistenceCoordinator } from "../../../persistence";
import { projectFixture, storeFixture, TEST_PROJECT_ID } from "./fixture";

test("UI result takes the consumed receipt draft without sharing publication, cache or later commits", async () => {
	const fixture = await storeFixture();
	const arbiter = new ProjectMutationArbiter();
	const persistence = new SessionPersistenceCoordinator(fixture.store, arbiter);
	const published: OpenCutProjectDraft[] = [];
	const receipts: EncodedOpenCutPublicationReceipt[] = [];
	const facade = new SessionOpenCutTransactions({
		persistence,
		arbiter,
		publish: (draft) => {
			published.push(draft);
		},
	});
	const original = adapterModule.createOpenCutTransactionDocumentAdapter;
	const factory = spyOn(
		adapterModule,
		"createOpenCutTransactionDocumentAdapter",
	).mockImplementation((args) => {
		const adapter = original(args);
		const consume = adapter.consumeReceipt;
		adapter.consumeReceipt = () => {
			const receipt = consume();
			if (receipt) receipts.push(receipt);
			return receipt;
		};
		return adapter;
	});
	try {
		await facade.open({ projectId: TEST_PROJECT_ID, assets: [] });
		const input = { project: projectFixture(), assetCatalog: [] };
		const result = await facade.commitUi({
			baseDraft: () => input,
			prepare: ({ draft, baseRevision, baseDocument }) => {
				draft.project.metadata.name = "Committed name";
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
		expect(receipts).toHaveLength(1);
		expect(result.committedDraft).toBe(receipts[0].draft);
		expect(result.committedDraft).not.toBe(published[0]);
		result.committedDraft.project.metadata.name = "Result mutation";
		result.committedDraft.project.scenes[0].name = "Result scene";
		result.committedDraft.assetCatalog.push({
			id: "result",
			name: "result",
			type: "image",
		});
		expect(published[0].project.metadata.name).toBe("Committed name");
		expect(input.project.metadata.name).toBe("OpenCut routing");
		expect(
			persistence.readCachedProject({ id: TEST_PROJECT_ID })?.metadata.name,
		).toBe("Committed name");
		published[0].project.metadata.name = "Publication mutation";
		published[0].project.scenes[0].name = "Publication scene";
		await facade.apply({
			operations: [
				{
					kind: "update-track",
					trackId: trackId("main-track"),
					patch: { name: "Later track" },
				},
			],
		});
		expect(published[1].project.metadata.name).toBe("Committed name");
		expect(published[1].project.scenes[0].name).toBe(
			input.project.scenes[0].name,
		);
		expect(published[1].assetCatalog).toEqual([]);
		await facade.open({ projectId: TEST_PROJECT_ID, assets: [] });
		expect((await facade.project())?.name).toBe("Committed name");
		expect((await facade.tracks())[0].name).toBe("Later track");
	} finally {
		await facade.dispose();
		factory.mockRestore();
	}
});
