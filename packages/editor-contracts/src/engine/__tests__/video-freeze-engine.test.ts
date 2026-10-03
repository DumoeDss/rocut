import { describe, expect, test } from "bun:test";
import {
	assetId,
	clipId,
	mediaTime,
	projectId,
	revisionOf,
	trackId,
} from "../..";
import type { TransactionOperation } from "../..";
import type { TransactionEngineDocument } from "../types";
import { evaluateTransactionBatch } from "../evaluator";

function document(): TransactionEngineDocument {
	return {
		project: {
			id: projectId("freeze-test"),
			name: "Freeze test",
			canvasWidth: 640,
			canvasHeight: 360,
			frameRate: { numerator: 30, denominator: 1 },
		},
		revision: revisionOf(0),
		idempotency: [],
		markers: [],
		tracks: [
			{ id: trackId("video"), name: "Video", kind: "video", hidden: false },
		],
		assets: [
			{
				id: assetId("source"),
				name: "Source",
				kind: "video",
				duration: mediaTime({ ticks: 600000 }),
			},
		],
		clips: [
			{
				id: clipId("clip"),
				trackId: trackId("video"),
				assetId: assetId("source"),
				startTime: mediaTime({ ticks: 0 }),
				duration: mediaTime({ ticks: 240000 }),
				trimStart: mediaTime({ ticks: 0 }),
				trimEnd: mediaTime({ ticks: 0 }),
			},
		],
	};
}
function update(freezeFrame: number | null): TransactionOperation {
	return {
		kind: "update-clip",
		clipId: clipId("clip"),
		patch: {
			freezeFrame:
				freezeFrame === null ? null : mediaTime({ ticks: freezeFrame }),
		},
	};
}
describe("video frame hold transaction contract", () => {
	test("holds frame zero and clears it after JSON transport", async () => {
		const first = await evaluateTransactionBatch({
			document: document(),
			batch: { operations: [update(0)] },
		});
		if (!first.accepted) throw new Error(JSON.stringify(first.issues));
		expect(first.document.clips[0].freezeFrame).toBe(0);
		const operations: TransactionOperation[] = JSON.parse(
			JSON.stringify([update(null)]),
		);
		const cleared = await evaluateTransactionBatch({
			document: first.document,
			batch: { operations },
		});
		if (!cleared.accepted) throw new Error(JSON.stringify(cleared.issues));
		expect(Object.hasOwn(cleared.document.clips[0], "freezeFrame")).toBe(false);
		expect(cleared.document.clips).toEqual(document().clips);
	});
	test("rejects end-of-source, unsafe ticks and non-video assets atomically", async () => {
		for (const frame of [600000, 9007199254740992]) {
			const base = document();
			const result = await evaluateTransactionBatch({
				document: base,
				batch: { operations: [update(frame)] },
			});
			expect(result.accepted).toBe(false);
			expect(base.clips[0].freezeFrame).toBeUndefined();
		}
		const base = document();
		const result = await evaluateTransactionBatch({
			document: { ...base, assets: [{ ...base.assets[0], kind: "image" }] },
			batch: { operations: [update(0)] },
		});
		expect(result.accepted).toBe(false);
	});
});
