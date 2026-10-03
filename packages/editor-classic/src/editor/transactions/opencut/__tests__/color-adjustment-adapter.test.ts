import { expect, test } from "bun:test";
import { clipId, mediaTime, trackId } from "@opencut/editor-contracts";
import { openTransactionEngine } from "@opencut/editor-contracts/engine";
import { createOpenCutTransactionDocumentAdapter } from "..";
import { storeFixture, TEST_PROJECT_ID } from "./fixture";

const neutral = {
	exposure: 0,
	contrast: 0,
	saturation: 0,
	temperature: 0,
	tint: 0,
};
test("public adjustment creation and updates decode as real effect layers on reopen", async () => {
	const fixture = await storeFixture();
	const initialRecord = await fixture.store.load({ id: TEST_PROJECT_ID });
	if (!initialRecord) throw new Error("missing fixture");
	const adapter = createOpenCutTransactionDocumentAdapter({
		initialRecord,
		initialAssets: [],
	});
	const engine = await openTransactionEngine({
		store: fixture.store,
		projectId: TEST_PROJECT_ID,
		documentAdapter: adapter,
	});
	await engine.apply({
		operations: [
			{
				kind: "create-track",
				track: {
					id: trackId("colors"),
					name: "Colors",
					kind: "effect",
					hidden: false,
				},
			},
			{
				kind: "create-clip",
				clip: {
					id: clipId("adjustment"),
					trackId: trackId("colors"),
					startTime: mediaTime({ ticks: 0 }),
					duration: mediaTime({ ticks: 240000 }),
					trimStart: mediaTime({ ticks: 0 }),
					trimEnd: mediaTime({ ticks: 0 }),
					adjustment: neutral,
				},
			},
		],
	});
	await engine.apply({
		operations: [
			{
				kind: "update-clip",
				clipId: clipId("adjustment"),
				patch: { adjustment: { ...neutral, temperature: 35 } },
			},
		],
	});
	const stored = await fixture.store.load({ id: TEST_PROJECT_ID });
	if (!stored) throw new Error("missing saved project");
	const reopened = createOpenCutTransactionDocumentAdapter({
		initialRecord: stored,
		initialAssets: [],
	});
	const reopenedEngine = await openTransactionEngine({
		store: fixture.store,
		projectId: TEST_PROJECT_ID,
		documentAdapter: reopened,
	});
	expect((await reopenedEngine.clips())[0].adjustment).toEqual({
		...neutral,
		temperature: 35,
	});
	expect(
		reopened.currentDraft().project.scenes[0].tracks.overlay[0].elements[0],
	).toMatchObject({
		type: "effect",
		effectType: "color-adjustment",
		adjustment: { ...neutral, temperature: 35 },
	});
});
