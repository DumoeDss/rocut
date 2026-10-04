import { expect, test } from "bun:test";
import { assetId, clipId, mediaTime, trackId } from "@opencut/editor-contracts";
import { openTransactionEngine } from "@opencut/editor-contracts/engine";
import { createOpenCutTransactionDocumentAdapter } from "..";
import { storeFixture, TEST_PROJECT_ID } from "./fixture";

test("public audio components reconstruct as audio and preserve the original asset on reopen", async () => {
	const fixture = await storeFixture();
	const initialRecord = await fixture.store.load({ id: TEST_PROJECT_ID });
	if (!initialRecord) throw new Error("Missing fixture");
	const adapter = createOpenCutTransactionDocumentAdapter({
		initialRecord,
		initialAssets: [
			{
				id: "source",
				name: "video.mp4",
				type: "video",
				duration: 5,
				hasAudio: true,
			},
		],
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
					id: trackId("audio"),
					name: "Audio",
					kind: "audio",
					hidden: false,
				},
			},
			{
				kind: "create-clip",
				clip: {
					id: clipId("component"),
					trackId: trackId("audio"),
					assetId: assetId("source"),
					sourceComponent: "audio",
					startTime: mediaTime({ ticks: 0 }),
					duration: mediaTime({ ticks: 240000 }),
					trimStart: mediaTime({ ticks: 0 }),
					trimEnd: mediaTime({ ticks: 0 }),
				},
			},
		],
	});
	const stored = await fixture.store.load({ id: TEST_PROJECT_ID });
	if (!stored) throw new Error("Missing saved project");
	const reopened = createOpenCutTransactionDocumentAdapter({
		initialRecord: stored,
		initialAssets: [],
	});
	const reopenedEngine = await openTransactionEngine({
		store: fixture.store,
		projectId: TEST_PROJECT_ID,
		documentAdapter: reopened,
	});
	expect((await reopenedEngine.clips())[0]).toMatchObject({
		sourceComponent: "audio",
		assetId: "source",
	});
	expect(
		reopened.currentDraft().project.scenes[0].tracks.audio[0].elements[0],
	).toMatchObject({ type: "audio", mediaId: "source", sourceType: "upload" });
	expect(reopened.currentDraft().assetCatalog).toEqual([
		{
			id: "source",
			name: "video.mp4",
			type: "video",
			duration: 5,
			hasAudio: true,
		},
	]);
	// A public component change must replace the donor element kind as well.
	await reopenedEngine.apply({
		operations: [
			{
				kind: "update-clip",
				clipId: clipId("component"),
				patch: { trackId: trackId("main-track"), sourceComponent: null },
			},
		],
	});
	const finalRecord = await fixture.store.load({ id: TEST_PROJECT_ID });
	if (!finalRecord) throw new Error("Missing final project");
	const finalAdapter = createOpenCutTransactionDocumentAdapter({
		initialRecord: finalRecord,
		initialAssets: [],
	});
	await openTransactionEngine({
		store: fixture.store,
		projectId: TEST_PROJECT_ID,
		documentAdapter: finalAdapter,
	});
	expect(
		finalAdapter.currentDraft().project.scenes[0].tracks.main.elements[0],
	).toMatchObject({ type: "video", mediaId: "source" });
});
