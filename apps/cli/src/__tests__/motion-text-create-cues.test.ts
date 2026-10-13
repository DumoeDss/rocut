import { describe, expect, spyOn, test } from "bun:test";
import { projectId, revisionOf } from "@opencut/editor-contracts";
import {
	createMotionTextCues,
	structuredCuesCapability,
} from "../motion-text-create-cues";
import { core, fixture } from "./structured-cues-fixture";

describe("structured cues atomic transport", () => {
	test("preview does not apply; reviewed candidate commits sequence and clip in one batch and reads back exactly", async () => {
		const f = await fixture();
		const apply = spyOn(f.automation, "apply");
		const preview = await createMotionTextCues({
			automation: f.automation,
			input: f.input,
			preview: true,
			core,
		});
		expect(apply).not.toHaveBeenCalled();
		expect(preview.candidateHash).toMatch(/^[a-f0-9]{64}$/);
		const input = { ...f.input, candidateHash: preview.candidateHash };
		const result = await createMotionTextCues({
			automation: f.automation,
			input,
			core,
		});
		expect(apply).toHaveBeenCalledTimes(1);
		expect(apply.mock.calls[0][0].operations.map((op) => op.kind)).toEqual([
			"create-motion-text-sequence",
			"create-clip",
		]);
		expect(result).toMatchObject({
			applied: true,
			projectRevision: 2,
			lineMappings: preview.lineMappings,
		});
		const reopened = await f.open();
		const sequence = (await reopened.motionTextSequences!())[0];
		expect(sequence.source.text).toBe(f.input.source);
		expect(
			sequence.cues.map((cue) => ({
				text: cue.text,
				sourceLine: cue.sourceLine,
				startTicks: Number(cue.startTime),
				endTicks: Number(cue.startTime) + Number(cue.duration),
			})),
		).toEqual(
			f.input.cues.map(({ text, sourceLine, startTicks, endTicks }) => ({
				text,
				sourceLine,
				startTicks,
				endTicks,
			})),
		);
		expect((await reopened.clips())[0]).toMatchObject({
			content: { kind: "motion-text", sequenceId: sequence.id },
			startTime: 24000,
			duration: 300000,
		});
		const replay = await createMotionTextCues({
			automation: reopened,
			input,
			core,
		});
		expect(replay).toMatchObject({
			projectRevision: 2,
			sequenceId: preview.sequenceId,
		});
		expect(await reopened.clips()).toHaveLength(1);
		expect(await reopened.motionTextSequences!()).toHaveLength(1);
	});

	test("wrong hash, missing hash, wrong revision, track, and candidate drift do not commit", async () => {
		const f = await fixture();
		const apply = spyOn(f.automation, "apply");
		const preview = await createMotionTextCues({
			automation: f.automation,
			input: f.input,
			preview: true,
			core,
		});
		await expect(
			createMotionTextCues({ automation: f.automation, input: f.input, core }),
		).rejects.toThrow("candidateHash");
		await expect(
			createMotionTextCues({
				automation: f.automation,
				input: { ...f.input, candidateHash: "0".repeat(64) },
				core,
			}),
		).rejects.toThrow("differs");
		await expect(
			createMotionTextCues({
				automation: f.automation,
				input: { ...f.input, trackId: "missing" },
				preview: true,
				core,
			}),
		).rejects.toThrow("graphic");
		await expect(
			createMotionTextCues({
				automation: f.automation,
				input: { ...f.input, expectedRevision: 0 },
				preview: true,
				core,
			}),
		).rejects.toThrow("revision");
		await expect(
			createMotionTextCues({
				automation: f.automation,
				input: {
					...f.input,
					source: f.input.source + "\n",
					candidateHash: preview.candidateHash,
				},
				core,
			}),
		).rejects.toThrow("differs");
		expect(apply).not.toHaveBeenCalled();
		await f.automation.apply({
			operations: [
				{
					kind: "update-project",
					projectId: projectId("structured-project"),
					patch: { name: "changed" },
				},
			],
			expectedRevision: revisionOf(1),
		});
		await expect(
			createMotionTextCues({
				automation: f.automation,
				input: { ...f.input, candidateHash: preview.candidateHash },
				core,
			}),
		).rejects.toThrow("Expected revision");
		expect(await f.automation.clips()).toHaveLength(0);
	});

	test("unsafe/fractional ticks and unknown fields are rejected before factory or apply", async () => {
		const f = await fixture();
		const apply = spyOn(f.automation, "apply");
		for (const value of [NaN, Infinity, -1, 0.5, Number.MAX_SAFE_INTEGER + 1]) {
			await expect(
				createMotionTextCues({
					automation: f.automation,
					input: { ...f.input, durationTicks: value },
					preview: true,
					core,
				}),
			).rejects.toThrow();
		}
		await expect(
			createMotionTextCues({
				automation: f.automation,
				input: { ...f.input, sequence: {} },
				preview: true,
				core,
			}),
		).rejects.toThrow("unsupported");
		await expect(
			createMotionTextCues({
				automation: f.automation,
				input: { ...f.input, timelineStartTicks: 23 },
				preview: true,
				core,
			}),
		).rejects.toThrow("aligned");
		expect(apply).not.toHaveBeenCalled();
	});

	test("missing installed constructor is unavailable without parser fallback", async () => {
		const f = await fixture();
		const apply = spyOn(f.automation, "apply");
		expect(structuredCuesCapability(core)).toMatchObject({
			available: true,
			ticksPerSecond: 120000,
		});
		if (!structuredCuesCapability().available) {
			await expect(
				createMotionTextCues({
					automation: f.automation,
					input: f.input,
					preview: true,
				}),
			).rejects.toThrow("unavailable");
		}
		expect(apply).not.toHaveBeenCalled();
	});

	test("wrapper rejects changed exact source or line mapping from a factory response", async () => {
		const f = await fixture();
		const apply = spyOn(f.automation, "apply");
		await expect(
			createMotionTextCues({
				automation: f.automation,
				input: f.input,
				preview: true,
				core: (input) => core({ ...input, source: input.source + "\n" }),
			}),
		).rejects.toThrow("inconsistent");
		await expect(
			createMotionTextCues({
				automation: f.automation,
				input: f.input,
				preview: true,
				core: (input) =>
					core({
						...input,
						cues: input.cues.map((cue) => ({
							...cue,
							lineId: cue.lineId + "changed",
						})),
					}),
			}),
		).rejects.toThrow("fixed cue");
		expect(apply).not.toHaveBeenCalled();
	});
});
