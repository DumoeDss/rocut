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

test.each(["ui", "automation"] as const)(
	"%s transfers its private publication when no result draft is requested",
	async (mode) => {
		const fixture = await storeFixture();
		const arbiter = new ProjectMutationArbiter();
		const persistence = new SessionPersistenceCoordinator(
			fixture.store,
			arbiter,
		);
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
			let finalized = 0;
			const commit = () =>
				mode === "automation"
					? facade.apply({
							operations: [
								{
									kind: "update-track",
									trackId: trackId("main-track"),
									patch: { name: "Saved track" },
								},
							],
						})
					: facade.commitUi({
							returnCommittedDraft: false,
							baseDraft: () => input,
							prepare: ({ draft, baseRevision, baseDocument }) => {
								draft.project.scenes[0].tracks.main.name = "Saved track";
								const after = projectOpenCutDraft(draft, {
									revision: baseRevision,
									idempotency: [],
								});
								return {
									draft,
									operations: diffOpenCutProjection({
										before: baseDocument,
										after,
									}),
									payload: draft,
								};
							},
							finalize: () => {
								finalized++;
							},
						});
			fixture.control.failNext({
				operation: "save-project",
				code: "unavailable",
			});
			await expect(commit()).rejects.toMatchObject({ code: "unavailable" });
			expect(published).toHaveLength(0);
			expect(finalized).toBe(0);
			expect((await facade.tracks())[0].name).toBe("Main Track");
			receipts.length = 0;
			const clone = spyOn(globalThis, "structuredClone");
			let result;
			try {
				result = await commit();
				expect(receipts).toHaveLength(1);
				expect(
					clone.mock.calls.filter(([value]) => value === receipts[0].draft),
				).toHaveLength(0);
			} finally {
				clone.mockRestore();
			}
			expect(published[0]).toBe(receipts[0].draft);
			expect("committedDraft" in result).toBe(false);
			expect(finalized).toBe(mode === "ui" ? 1 : 0);
			input.project.scenes[0].tracks.main.name = "Input mutation";
			if ("payload" in result)
				result.payload.project.scenes[0].tracks.main.name = "Payload mutation";
			expect(published[0].project.scenes[0].tracks.main.name).toBe(
				"Saved track",
			);
			published[0].project.metadata.name = "Publication mutation";
			published[0].project.scenes[0].tracks.main.name = "Publication track";
			expect(
				persistence.readCachedProject({ id: TEST_PROJECT_ID })?.scenes[0].tracks
					.main.name,
			).toBe("Saved track");
			expect((await facade.tracks())[0].name).toBe("Saved track");
			await facade.apply({
				operations: [
					{
						kind: "update-track",
						trackId: trackId("main-track"),
						patch: { name: "Next track" },
					},
				],
			});
			expect(published[1].project.metadata.name).toBe("OpenCut routing");
			await facade.open({ projectId: TEST_PROJECT_ID, assets: [] });
			expect((await facade.tracks())[0].name).toBe("Next track");
			expect((await facade.project())?.name).toBe("OpenCut routing");
		} finally {
			await facade.dispose();
			factory.mockRestore();
		}
	},
);
