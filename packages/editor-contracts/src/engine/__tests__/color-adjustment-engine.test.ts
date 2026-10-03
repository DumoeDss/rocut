import { expect, test } from "bun:test";
import {
	clipId,
	mediaTime,
	motionTextSequenceId,
	projectId,
	revisionOf,
	trackId,
} from "../..";
import type { Clip } from "../..";
import { evaluateTransactionBatch } from "../evaluator";
import { isValidClip } from "../invariant";
import type { TransactionEngineDocument } from "../types";

const neutral = {
	exposure: 0,
	contrast: 0,
	saturation: 0,
	temperature: 0,
	tint: 0,
};
function fixture(): TransactionEngineDocument {
	return {
		project: {
			id: projectId("adjustment"),
			name: "Adjustment",
			canvasWidth: 640,
			canvasHeight: 360,
			frameRate: { numerator: 30, denominator: 1 },
		},
		revision: revisionOf(0),
		idempotency: [],
		assets: [],
		markers: [],
		tracks: [
			{ id: trackId("fx"), name: "Colors", kind: "effect", hidden: false },
		],
		clips: [
			{
				id: clipId("colors"),
				trackId: trackId("fx"),
				startTime: mediaTime({ ticks: 0 }),
				duration: mediaTime({ ticks: 240000 }),
				trimStart: mediaTime({ ticks: 0 }),
				trimEnd: mediaTime({ ticks: 0 }),
				adjustment: neutral,
			},
		],
	};
}
test("adjustment updates survive JSON transport and preserve range", async () => {
	const before = fixture();
	const adjusted = { ...neutral, exposure: 1, saturation: -100 };
	const result = await evaluateTransactionBatch({
		document: before,
		batch: {
			operations: [
				{
					kind: "update-clip",
					clipId: clipId("colors"),
					patch: JSON.parse(JSON.stringify({ adjustment: adjusted })),
				},
			],
		},
	});
	if (!result.accepted) throw new Error(JSON.stringify(result.issues));
	expect(result.document.clips[0]).toEqual({
		...before.clips[0],
		adjustment: adjusted,
	});
	expect(before.clips[0].adjustment).toEqual(neutral);
});
test("malformed parameters are rejected instead of silently dropping fields", () => {
	const base = fixture().clips[0];
	for (const adjustment of [
		null,
		{},
		{ ...neutral, exposure: Infinity },
		{ ...neutral, tint: "20" },
		{ ...neutral, unknown: 1 },
	])
		expect(isValidClip({ ...base, adjustment })).toBe(false);
});
test("adjustment cannot be moved to a non-effect track or attached to content", async () => {
	const base = fixture();
	const content: Clip["content"] = {
		kind: "motion-text",
		sequenceId: motionTextSequenceId("unknown"),
	};
	for (const patch of [{ trackId: trackId("video") }, { content }]) {
		const result = await evaluateTransactionBatch({
			document: {
				...base,
				tracks: [
					...base.tracks,
					{
						id: trackId("video"),
						kind: "video",
						name: "Picture",
						hidden: false,
					},
				],
			},
			batch: {
				operations: [{ kind: "update-clip", clipId: clipId("colors"), patch }],
			},
		});
		expect(result.accepted).toBe(false);
	}
});
