import { expect, test } from "bun:test";
import { createAutomation } from "@opencut/editor-automation";
import { createOpenCutTransactionDocumentAdapter } from "../../../../packages/editor-classic/src/editor/transactions/opencut/adapter";
import {
	storeFixture,
	TEST_PROJECT_ID,
} from "../../../../packages/editor-classic/src/editor/transactions/opencut/__tests__/fixture";
import { trackId } from "@opencut/editor-contracts";
import { createMotionTextCues } from "../motion-text-create-cues";
import { core, fixture } from "./structured-cues-fixture";

test("actual editor-plane codec adds exact motion-text editing defaults while preserving the full sequence", async () => {
	const stored = await storeFixture();
	async function open() {
		const initialRecord = await stored.store.load({ id: TEST_PROJECT_ID });
		if (!initialRecord) throw Error("Missing controlled project record");
		const adapter = createOpenCutTransactionDocumentAdapter({
			initialRecord,
			initialAssets: [],
		});
		return createAutomation({
			store: stored.store,
			projectId: TEST_PROJECT_ID,
			documentAdapter: adapter,
		});
	}
	const automation = await open();
	await automation.apply({
		operations: [
			{
				kind: "create-track",
				track: {
					id: trackId("graphic"),
					kind: "graphic",
					name: "Lyrics",
					hidden: false,
				},
			},
		],
	});
	const { input } = await fixture();
	const preview = await createMotionTextCues({
		automation,
		input,
		preview: true,
		core,
	});
	await createMotionTextCues({
		automation,
		input: { ...input, candidateHash: preview.candidateHash },
		core,
	});
	expect((await automation.clips()) as unknown).toEqual([
		{
			id: preview.clipId,
			trackId: input.trackId,
			startTime: input.timelineStartTicks,
			duration: input.durationTicks,
			trimStart: 0,
			trimEnd: 0,
			content: { kind: "motion-text", sequenceId: preview.sequenceId },
		},
	]);
	const reopened = await open();
	const clips = await reopened.clips();
	expect(clips as unknown).toEqual([
		{
			id: preview.clipId,
			trackId: input.trackId,
			startTime: input.timelineStartTicks,
			duration: input.durationTicks,
			trimStart: 0,
			trimEnd: 0,
			editing: {
				type: "motion-text",
				name: preview.clipId,
				params: {},
				hidden: false,
			},
			content: { kind: "motion-text", sequenceId: preview.sequenceId },
		},
	]);
	expect((await reopened.motionTextSequences!()) as unknown).toEqual([
		preview.sequence,
	]);
	expect(clips[0]).not.toHaveProperty("assetId");
	expect(clips[0]).not.toHaveProperty("sourceComponent");
});
