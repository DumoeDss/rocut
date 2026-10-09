import { expect, test } from "bun:test";
import { projectId, revisionOf } from "@opencut/editor-contracts";
import { openTransactionEngine } from "@opencut/editor-contracts/engine";
import { createOpenCutTransactionDocumentAdapter } from "../adapter";
import {
	openCutEditingPolicy,
	validateDocumentEditing,
} from "../editing-policy";
import { storeFixture, TEST_PROJECT_ID } from "./fixture";
import { decodeProject } from "../../../persistence/project-codec";

test("Agent master post is validated, persisted, detached, reopened and explicitly cleared", async () => {
	const { store } = await storeFixture();
	const open = async () => {
		const record = await store.load({ id: TEST_PROJECT_ID });
		if (!record) throw Error("Missing fixture project");
		const adapter = createOpenCutTransactionDocumentAdapter({
			initialRecord: record,
			initialAssets: [],
			validateEditing: validateDocumentEditing,
		});
		return openTransactionEngine({
			store,
			projectId: TEST_PROJECT_ID,
			documentAdapter: adapter,
			placementPolicies: [openCutEditingPolicy],
		});
	};
	const engine = await open();
	const params = {
		exposure: 0.5,
		contrast: 0,
		saturation: 0,
		temperature: 0,
		tint: 0,
	};
	const effects = [
		{ id: "master-grade", type: "color-adjustment", enabled: true, params },
	];
	const expected = structuredClone(effects);
	await engine.apply({
		expectedRevision: revisionOf(0),
		operations: [
			{
				kind: "update-project",
				projectId: projectId(TEST_PROJECT_ID),
				patch: { masterEffects: effects },
			},
		],
	});
	const stored = await store.load({ id: TEST_PROJECT_ID });
	expect(decodeProject(stored?.data).settings.masterEffects).toEqual(effects);
	const reread = await engine.project();
	expect(reread?.masterEffects).toEqual(effects);
	expect(reread?.masterEffects).not.toBe(effects);
	effects[0].params.exposure = 1;
	expect((await engine.project())?.masterEffects).toEqual(expected);
	expect(
		decodeProject((await store.load({ id: TEST_PROJECT_ID }))?.data).settings
			.masterEffects,
	).toEqual(expected);
	for (const invalid of [
		[effects[0], effects[0]],
		[{ ...effects[0], enabled: false, type: "unknown-effect" }],
		[{ ...effects[0], enabled: false, params: { unexpected: true } }],
	]) {
		await expect(
			engine.apply({
				operations: [
					{
						kind: "update-project",
						projectId: projectId(TEST_PROJECT_ID),
						patch: { masterEffects: invalid },
					},
				],
			}),
		).rejects.toThrow();
		expect(await store.load({ id: TEST_PROJECT_ID })).toEqual(stored);
	}
	const reopened = await open();
	expect((await reopened.project())?.masterEffects).toEqual(expected);
	await reopened.apply({
		expectedRevision: revisionOf(1),
		operations: [
			{
				kind: "update-project",
				projectId: projectId(TEST_PROJECT_ID),
				patch: { masterEffects: [] },
			},
		],
	});
	expect(
		decodeProject((await store.load({ id: TEST_PROJECT_ID }))?.data).settings
			.masterEffects,
	).toEqual([]);
});
