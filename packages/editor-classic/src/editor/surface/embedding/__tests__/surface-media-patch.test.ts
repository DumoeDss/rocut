import { describe, expect, test } from "bun:test";
import type { TransactionBatch } from "@opencut/editor-contracts";
import { createSurfaceCommitBinding } from "../surface-transaction-binding";

describe("surface media patch boundary", () => {
	test("accepts complete retime/transition patches and JSON-safe clears unchanged", async () => {
		const applied: TransactionBatch[] = [];
		const errors: Error[] = [];
		const binding = createSurfaceCommitBinding({
			apply: {
				apply: async (batch) => {
					applied.push(batch);
					throw Error("downstream sentinel");
				},
			},
			onError: (error) => errors.push(error),
		});
		const patches = [
			{
				transitionIn: {
					kind: "cross-dissolve",
					outgoingClipId: "left",
					durationFrames: 30,
				},
				retime: { rate: 0.5, maintainPitch: true },
			},
			{ transitionIn: null, retime: null, freezeFrame: null },
		];
		for (const patch of patches)
			binding.commit({
				edit: { operations: [{ kind: "update-clip", clipId: "right", patch }] },
			});
		await Promise.resolve();
		await Promise.resolve();
		expect(applied.map((batch) => batch.operations[0])).toEqual(
			patches.map((patch) => ({ kind: "update-clip", clipId: "right", patch })),
		);
		expect(errors.map((error) => error.message)).toEqual([
			"downstream sentinel",
			"downstream sentinel",
		]);
	});
	test("rejects malformed and unknown nested fields before calling the transaction engine", async () => {
		let applies = 0;
		const errors: Error[] = [];
		const binding = createSurfaceCommitBinding({
			apply: {
				apply: async () => {
					applies++;
					throw Error("must not reach engine");
				},
			},
			onError: (error) => errors.push(error),
		});
		const link = {
			kind: "cross-dissolve",
			outgoingClipId: "left",
			durationFrames: 30,
		};
		const patches = [
			{ transitionIn: { ...link, durationFrames: 2.5 } },
			{ transitionIn: { ...link, durationFrames: 1 } },
			{ transitionIn: { ...link, outgoingClipId: "" } },
			{ transitionIn: { ...link, typo: true } },
			{ transitionIn: { ...link, kind: "wipe" } },
			{ retime: { rate: NaN } },
			{ retime: { rate: Infinity } },
			{ retime: { rate: 0 } },
			{ retime: { rate: 6 } },
			{ retime: { rate: 1, maintainPitch: "yes" } },
			{ retime: { rate: 1, typo: true } },
		];
		for (const patch of patches)
			binding.commit({
				edit: { operations: [{ kind: "update-clip", clipId: "right", patch }] },
			});
		await Promise.resolve();
		expect(applies).toBe(0);
		expect(errors).toHaveLength(patches.length);
	});
});
