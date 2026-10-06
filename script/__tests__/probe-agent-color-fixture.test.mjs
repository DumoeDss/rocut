import { expect, test } from "bun:test";
import {
	createMotionTextSequence,
	mutateMotionTextSequence,
} from "../../rust/wasm/pkg/opencut_wasm_sync.js";
import { MOTION_TEXT_RENDERER_SUPPORT } from "../../packages/editor-classic/src/services/renderer/motion-text/support-manifest.ts";
import { makeAgentDraftMutation } from "../probe-agent-draft-fixture.mjs";

test("green-pixel proposal explicitly selects foreground-drawing typography after a tunnel variation", () => {
	const created = createMotionTextSequence({
		sequenceId: "agent-color-fixture",
		source: "First unchanged\nSecond locked\nThird proposal",
		sourceFormat: "plain",
		language: "en",
		duration: 720000,
		seed: 66944085,
		starterPreset: "clean-caption",
		rendererSupport: MOTION_TEXT_RENDERER_SUPPORT,
	});
	expect(created.sequenceJson).toBeString();
	const sequence = JSON.parse(created.sequenceJson);
	sequence.cues[1].locks = [{ scope: "preset-group", key: "layout" }];
	sequence.cues[2].overrides.preset = {
		...sequence.defaults.preset,
		style: "specimen",
		layout: "tunnel",
	};
	for (const cut of sequence.resolvedPlan.cuts) {
		if (cut.cueId === sequence.cues[2].id)
			cut.preset = { ...sequence.cues[2].overrides.preset };
	}
	const before = structuredClone(sequence);
	const input = makeAgentDraftMutation(sequence, "Approved proposal");
	const result = mutateMotionTextSequence({
		sequenceJson: JSON.stringify(sequence),
		mutationJson: JSON.stringify(input.mutation),
		rendererSupport: MOTION_TEXT_RENDERER_SUPPORT,
	});
	expect(result.sequenceJson).toBeString();
	const candidate = JSON.parse(result.sequenceJson);
	const cuts = candidate.resolvedPlan.cuts.filter(
		(cut) => cut.cueId === sequence.cues[2].id,
	);
	expect(cuts.length).toBeGreaterThan(0);
	for (const cut of cuts) {
		expect(cut.preset.layout).toBe("center");
		expect(cut.preset.treat).toBe("none");
		expect(cut.preset.cam).toBe("static");
	}
	expect(candidate.cues.slice(0, 2)).toEqual(before.cues.slice(0, 2));
	expect(candidate.defaults).toEqual(before.defaults);
	expect(candidate.cues[2].overrides.colors).toEqual({
		foreground: "#00FF00",
		accent: "#FF0000",
	});
	expect(sequence).toEqual(before);
});
