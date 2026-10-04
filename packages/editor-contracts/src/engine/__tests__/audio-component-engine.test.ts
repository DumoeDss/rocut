import { describe, expect, test } from "bun:test";
import {
	assetId,
	clipId,
	mediaTime,
	projectId,
	revisionOf,
	trackId,
	type TransactionOperation,
} from "../..";
import type { TransactionEngineDocument } from "../types";
import { evaluateTransactionBatch } from "../evaluator";

function document(): TransactionEngineDocument {
	return {
		project: {
			id: projectId("audio-component"),
			name: "Audio component",
			canvasWidth: 640,
			canvasHeight: 360,
			frameRate: { numerator: 30, denominator: 1 },
		},
		revision: revisionOf(0),
		idempotency: [],
		markers: [],
		tracks: [
			{ id: trackId("video"), name: "Video", kind: "video", hidden: false },
			{ id: trackId("audio"), name: "Audio", kind: "audio", hidden: false },
		],
		assets: [
			{
				id: assetId("source"),
				name: "Source",
				kind: "video",
				duration: mediaTime({ ticks: 600000 }),
				hasAudio: true,
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
const extraction: TransactionOperation = {
	kind: "update-clip",
	clipId: clipId("clip"),
	patch: { trackId: trackId("audio"), sourceComponent: "audio" },
};
describe("video audio-component contract", () => {
	test("keeps the original video asset and clears the component across JSON transport", async () => {
		const base = document();
		const first = await evaluateTransactionBatch({
			document: base,
			batch: { operations: [extraction] },
		});
		if (!first.accepted) throw new Error(JSON.stringify(first.issues));
		expect(first.document.assets).toEqual(base.assets);
		expect(first.document.clips[0]).toMatchObject({
			assetId: "source",
			sourceComponent: "audio",
			trackId: "audio",
		});
		const operations: TransactionOperation[] = JSON.parse(
			JSON.stringify([
				{
					kind: "update-clip",
					clipId: "clip",
					patch: { trackId: "video", sourceComponent: null },
				},
			]),
		);
		const cleared = await evaluateTransactionBatch({
			document: first.document,
			batch: { operations },
		});
		if (!cleared.accepted) throw new Error(JSON.stringify(cleared.issues));
		expect(cleared.document.clips).toEqual(base.clips);
		expect(Object.hasOwn(cleared.document.clips[0], "sourceComponent")).toBe(
			false,
		);
	});
	test("unknown legacy audio availability remains compatible", async () => {
		const base = document();
		const result = await evaluateTransactionBatch({
			document: {
				...base,
				assets: [{ ...base.assets[0], hasAudio: undefined }],
			},
			batch: { operations: [extraction] },
		});
		expect(result.accepted).toBe(true);
	});
	test("rejects picture assets, confirmed silent sources, and malformed discriminators atomically", async () => {
		for (const asset of [
			{ ...document().assets[0], kind: "image" as const },
			{ ...document().assets[0], kind: "audio" as const },
			{ ...document().assets[0], hasAudio: false },
		]) {
			const base = { ...document(), assets: [asset] };
			const before = structuredClone(base);
			const result = await evaluateTransactionBatch({
				document: base,
				batch: { operations: [extraction] },
			});
			expect(result.accepted).toBe(false);
			expect(base).toEqual(before);
		}
		for (const sourceComponent of ["video", "", 1, false, {}]) {
			const operations: TransactionOperation[] = JSON.parse(
				JSON.stringify([
					{ ...extraction, patch: { trackId: "audio", sourceComponent } },
				]),
			);
			const result = await evaluateTransactionBatch({
				document: document(),
				batch: { operations },
			});
			expect(result.accepted).toBe(false);
		}
	});
	test("does not bypass lane, timing, or picture-only restrictions", async () => {
		for (const patch of [
			{ sourceComponent: "audio" },
			{ trackId: "audio" },
			{ trackId: "audio", sourceComponent: "audio", freezeFrame: 0 },
			{
				trackId: "audio",
				sourceComponent: "audio",
				transitionIn: {
					kind: "cross-dissolve",
					outgoingClipId: "clip",
					durationFrames: 3,
				},
			},
			{ trackId: "audio", sourceComponent: "audio", duration: 720000 },
			{ trackId: "audio", sourceComponent: "audio", trimStart: 1 },
		]) {
			const operations: TransactionOperation[] = JSON.parse(
				JSON.stringify([{ ...extraction, patch }]),
			);
			const result = await evaluateTransactionBatch({
				document: document(),
				batch: { operations },
			});
			expect(result.accepted).toBe(false);
		}
	});
});
