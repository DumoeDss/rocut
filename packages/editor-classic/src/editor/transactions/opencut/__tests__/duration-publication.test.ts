import { expect, test } from "bun:test";
import { decodeProject } from "../../../persistence/project-codec";
import { SessionPersistenceCoordinator } from "../../../persistence";
import { ProjectMutationArbiter } from "../arbiter";
import { SessionOpenCutTransactions } from "../router";
import { diffOpenCutProjection, projectOpenCutDraft } from "../projection";
import type { OpenCutProjectDraft } from "../types";
import { projectFixture, storeFixture, TEST_PROJECT_ID } from "./fixture";
import { mediaTimeFromSeconds } from "../../../../wasm";

test.each(["ui", "automation"] as const)(
	"%s publishes current duration in the same durable commit, including shrink and clear",
	async (mode) => {
		const fixture = await storeFixture();
		const arbiter = new ProjectMutationArbiter();
		const persistence = new SessionPersistenceCoordinator(
			fixture.store,
			arbiter,
		);
		let live: OpenCutProjectDraft = {
			project: projectFixture(),
			assetCatalog: [],
		};
		const facade = new SessionOpenCutTransactions({
			persistence,
			arbiter,
			publish: (draft) => {
				live = draft;
			},
		});
		await facade.open({ projectId: TEST_PROJECT_ID, assets: [] });
		const commit = async (seconds: number) => {
			const prepare = ({
				draft,
				baseRevision,
				baseDocument,
			}: Parameters<Parameters<typeof facade.commitUi>[0]["prepare"]>[0]) => {
				draft.assetCatalog = [
					{ id: "audio", name: "speech.wav", type: "audio", duration: 20 },
				];
				draft.project.scenes[0].tracks.audio = [
					{
						id: "audio-track",
						name: "Audio",
						type: "audio",
						muted: false,
						elements:
							seconds === 0
								? []
								: [
										{
											id: "audio-clip",
											name: "speech.wav",
											type: "audio",
											sourceType: "upload",
											mediaId: "audio",
											startTime: mediaTimeFromSeconds({ seconds: 1 }),
											duration: mediaTimeFromSeconds({ seconds }),
											trimStart: mediaTimeFromSeconds({ seconds: 0 }),
											trimEnd: mediaTimeFromSeconds({ seconds: 0 }),
											params: {},
										},
									],
					},
				];
				const after = projectOpenCutDraft(draft, {
					revision: baseRevision,
					idempotency: [],
				});
				return {
					draft,
					operations: diffOpenCutProjection({ before: baseDocument, after }),
					payload: null,
				};
			};
			if (mode === "ui")
				return facade.commitUi({
					baseDraft: () => live,
					prepare,
					returnCommittedDraft: false,
				});
			const baseRevision = await facade.revision();
			const baseDocument = projectOpenCutDraft(live, {
				revision: baseRevision,
				idempotency: [],
			});
			return facade.apply({
				operations: prepare({
					draft: structuredClone(live),
					baseRevision,
					baseDocument,
				}).operations,
			});
		};
		try {
			let saves = 0;
			for (const seconds of [2, 5, 1, 0, 5]) {
				const before = structuredClone(live);
				const storedBefore = await fixture.store.load({ id: TEST_PROJECT_ID });
				fixture.control.failNext({
					operation: "save-project",
					code: "unavailable",
				});
				await expect(commit(seconds)).rejects.toMatchObject({
					code: "unavailable",
				});
				expect(live).toEqual(before);
				expect(await fixture.store.load({ id: TEST_PROJECT_ID })).toEqual(
					storedBefore,
				);
				await commit(seconds);
				saves += 2;
				expect(fixture.getSaveCount()).toBe(saves);
				const expected = mediaTimeFromSeconds({
					seconds: seconds === 0 ? 0 : seconds + 1,
				});
				expect(live.project.metadata.duration).toBe(expected);
				expect(
					persistence.readCachedProject({ id: TEST_PROJECT_ID })?.metadata
						.duration,
				).toBe(expected);
				const stored = await fixture.store.load({ id: TEST_PROJECT_ID });
				expect(decodeProject(stored!.data).metadata.duration).toBe(expected);
				await facade.open({ projectId: TEST_PROJECT_ID, assets: [] });
			}
		} finally {
			await facade.dispose();
		}
	},
);
