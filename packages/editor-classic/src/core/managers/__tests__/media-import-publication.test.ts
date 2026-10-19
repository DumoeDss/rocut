import { expect, test } from "bun:test";
import { assetId, mediaTime } from "@opencut/editor-contracts";
import { commandHarness } from "./command-test-harness";
import { TEST_PROJECT_ID } from "../../../editor/transactions/opencut/__tests__/fixture";

await import("../../../editor/session/__tests__/wasm-test-mock");
const { MediaManager } = await import("../media-manager");

async function harness() {
	const target = await commandHarness();
	const media = new MediaManager({ editor: target.editor });
	Object.assign(target.editor, { media });
	Object.assign(target.editor.project, {
		ratchetFpsForImportedMedia: async () => null,
	});
	return { ...target, media };
}

function video() {
	return {
		name: "same.mp4",
		type: "video" as const,
		file: new File([Uint8Array.of(1, 2, 3)], "same.mp4", { type: "video/mp4" }),
		width: 160,
		height: 90,
		duration: 1,
		fps: 6,
		hasAudio: false,
	};
}

test("manual low-fps import publishes durable graph without a settings edit and preserves CLI assets", async () => {
	const target = await harness();
	// A previously persisted UI-only attachment can be hydrated without having
	// entered the author catalog. A later import repairs that catalog entry too.
	const legacy = { ...video(), id: "previous-manual-import" };
	const { savePersistedMediaAsset } =
		await import("../../../media/persistence");
	await savePersistedMediaAsset({
		persistence: target.editor.persistence,
		projectId: TEST_PROJECT_ID,
		asset: legacy,
	});
	target.media.setAssets({ assets: [legacy] });
	await target.transactions.apply({
		operations: [
			{
				kind: "create-asset",
				asset: {
					id: assetId("cli-asset"),
					kind: "video",
					name: "same.mp4",
					duration: mediaTime({ ticks: 120000 }),
					width: 160,
					height: 90,
				},
			},
		],
		idempotencyKey: "cli-first",
	});
	const clips = await target.transactions.clips();
	const before = Number(await target.transactions.revision());
	const added = await target.media.addMediaAsset({
		projectId: TEST_PROJECT_ID,
		asset: video(),
	});
	expect(added).not.toBeNull();
	expect(Number(await target.transactions.revision())).toBe(before + 1);
	expect(target.getProject().settings.fps).toEqual({
		numerator: 30,
		denominator: 1,
	});
	expect(await target.transactions.clips()).toEqual(clips);
	expect(
		(await target.transactions.assets())
			.map((asset) => String(asset.id))
			.sort(),
	).toEqual(["cli-asset", legacy.id, added!.id].sort());
	expect(
		await target.fixture.store.loadAttachment({
			projectId: TEST_PROJECT_ID,
			key: added!.id,
		}),
	).not.toBeNull();
	await target.transactions.retire();
	await target.transactions.open({ projectId: TEST_PROJECT_ID, assets: [] });
	expect(
		(await target.transactions.assets())
			.map((asset) => String(asset.id))
			.sort(),
	).toEqual(["cli-asset", legacy.id, added!.id].sort());
	expect(
		(await target.transactions.assets()).find(
			(asset) => asset.id === added!.id,
		),
	).toMatchObject({
		width: 160,
		height: 90,
		duration: 120000,
		hasAudio: false,
	});
});

test("graph persistence failure preserves source and never publishes UI success", async () => {
	const target = await harness();
	target.fixture.control.failNext({
		operation: "save-project",
		code: "quota-exceeded",
	});
	const added = await target.media.addMediaAsset({
		projectId: TEST_PROJECT_ID,
		asset: video(),
	});
	expect(added).toBeNull();
	expect(target.media.getAssets()).toEqual([]);
	expect(await target.transactions.assets()).toEqual([]);
	expect(
		await target.fixture.store.listAttachments({ projectId: TEST_PROJECT_ID }),
	).toHaveLength(1);
	expect(target.failures.length).toBeGreaterThan(0);
});

test("cancelled import removes its attachment without changing the author graph", async () => {
	const target = await harness();
	let checks = 0;
	const added = await target.media.addMediaAsset({
		projectId: TEST_PROJECT_ID,
		asset: video(),
		canPublish: () => ++checks < 2,
	});
	expect(added).toBeNull();
	expect(await target.transactions.assets()).toEqual([]);
	expect(
		await target.fixture.store.listAttachments({ projectId: TEST_PROJECT_ID }),
	).toEqual([]);
});

test("an uncertain acknowledgement never deletes source bytes referenced by the durable graph", async () => {
	const target = await harness();
	const commit = target.transactions.commitUi.bind(target.transactions);
	target.transactions.commitUi = async (...args: Parameters<typeof commit>) => {
		await commit(...args);
		throw new Error("acknowledgement lost");
	};
	expect(
		await target.media.addMediaAsset({
			projectId: TEST_PROJECT_ID,
			asset: video(),
		}),
	).toBeNull();
	expect(target.media.getAssets()).toEqual([]);
	const assets = await target.transactions.assets();
	expect(assets).toHaveLength(1);
	expect(
		await target.fixture.store.loadAttachment({
			projectId: TEST_PROJECT_ID,
			key: assets[0]!.id,
		}),
	).not.toBeNull();
	expect(target.failures.length).toBeGreaterThan(0);
});
