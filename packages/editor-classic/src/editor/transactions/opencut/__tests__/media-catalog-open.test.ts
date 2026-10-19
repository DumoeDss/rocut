import { expect, test } from "bun:test";
import { assetId } from "@opencut/editor-contracts";
import { commandHarness } from "../../../../core/managers/__tests__/command-test-harness";
import { TEST_PROJECT_ID } from "./fixture";
import { savePersistedMediaAsset } from "../../../../media/persistence";

function media(id: string) {
	return {
		id,
		name: "attachment.mp4",
		type: "video" as const,
		file: new File([Uint8Array.of(1, 2, 3)], "attachment.mp4"),
		width: 160,
		height: 90,
		duration: 1,
		fps: 6,
	};
}

async function fixture() {
	const target = await commandHarness();
	await target.transactions.apply({
		operations: [
			{
				kind: "create-asset",
				asset: {
					id: assetId("cli"),
					kind: "video",
					name: "Author title",
					width: 320,
					height: 180,
				},
			},
		],
		idempotencyKey: "existing-cli",
	});
	const assets = [media("cli"), media("missing-manual")];
	for (const asset of assets)
		await savePersistedMediaAsset({
			persistence: target.editor.persistence,
			projectId: TEST_PROJECT_ID,
			asset,
		});
	await target.transactions.retire();
	return { ...target, assets };
}

test("open additively repairs persisted manual media without replacing same-id author fields and is idempotent", async () => {
	const target = await fixture();
	const beforeSaves = target.fixture.getSaveCount();
	await target.transactions.open({
		projectId: TEST_PROJECT_ID,
		assets: target.assets,
	});
	expect(Number(await target.transactions.revision())).toBe(2);
	expect(await target.transactions.assets()).toHaveLength(2);
	expect(
		(await target.transactions.assets()).find((asset) => asset.id === "cli"),
	).toMatchObject({ name: "Author title", width: 320, height: 180 });
	expect(target.fixture.getSaveCount()).toBe(beforeSaves + 1);
	await target.transactions.open({
		projectId: TEST_PROJECT_ID,
		assets: target.assets,
	});
	expect(Number(await target.transactions.revision())).toBe(2);
	expect(target.fixture.getSaveCount()).toBe(beforeSaves + 1);
	expect(
		await target.fixture.store.listAttachments({ projectId: TEST_PROJECT_ID }),
	).toHaveLength(2);
});

test("failed open repair rejects without deleting source or pretending the router is open, then retries", async () => {
	const target = await fixture();
	target.fixture.control.failNext({
		operation: "save-project",
		code: "quota-exceeded",
	});
	await expect(
		target.transactions.open({
			projectId: TEST_PROJECT_ID,
			assets: target.assets,
		}),
	).rejects.toThrow();
	expect(target.transactions.isOpenFor(TEST_PROJECT_ID)).toBe(false);
	expect(
		await target.fixture.store.listAttachments({ projectId: TEST_PROJECT_ID }),
	).toHaveLength(2);
	await target.transactions.open({
		projectId: TEST_PROJECT_ID,
		assets: target.assets,
	});
	expect(await target.transactions.assets()).toHaveLength(2);
	expect(Number(await target.transactions.revision())).toBe(2);
});

test("store commit followed by lost acknowledgement keeps sources and reopens without duplicating repair", async () => {
	const target = await fixture();
	const save = target.fixture.store.save.bind(target.fixture.store);
	let loseAcknowledgement = true;
	target.fixture.store.save = async (args) => {
		await save(args);
		if (loseAcknowledgement) {
			loseAcknowledgement = false;
			throw new Error("durable write acknowledgement lost");
		}
	};
	await expect(
		target.transactions.open({
			projectId: TEST_PROJECT_ID,
			assets: target.assets,
		}),
	).rejects.toThrow();
	expect(target.transactions.isOpenFor(TEST_PROJECT_ID)).toBe(false);
	expect(
		await target.fixture.store.listAttachments({ projectId: TEST_PROJECT_ID }),
	).toHaveLength(2);
	const saves = target.fixture.getSaveCount();
	await target.transactions.open({
		projectId: TEST_PROJECT_ID,
		assets: target.assets,
	});
	expect(Number(await target.transactions.revision())).toBe(2);
	expect(await target.transactions.assets()).toHaveLength(2);
	expect(target.fixture.getSaveCount()).toBe(saves);
});
