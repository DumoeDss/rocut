/* eslint-disable @typescript-eslint/no-unsafe-type-assertion -- Codec tests inspect and extend opaque persisted records deliberately. */
import { describe, expect, test } from "bun:test";

import { decodeProject, encodeProject } from "../project-codec";
import {
	motionTextSequenceFixture,
	projectFixture,
} from "../../transactions/opencut/__tests__/fixture";

type Raw = Record<string, unknown>;

describe("motion-text project codec", () => {
	test("legacy projects default the additive sequence collection to empty", () => {
		const encoded = encodeProject({ project: projectFixture(), retained: {} });
		const legacy = encoded as Raw;
		delete legacy.motionTextSequences;
		expect(decodeProject(legacy).motionTextSequences).toEqual([]);
	});

	test("sequences and timeline references survive encode and decode", () => {
		const project = projectFixture();
		const sequence = motionTextSequenceFixture();
		project.motionTextSequences.push(sequence);
		project.scenes[0].tracks.overlay.push({
			id: "motion-track",
			name: "Motion text",
			type: "graphic",
			hidden: false,
			elements: [
				{
					id: "motion-clip",
					name: "Motion title",
					type: "motion-text",
					sequenceId: sequence.id,
					startTime: 0 as never,
					duration: 120_000 as never,
					trimStart: 0 as never,
					trimEnd: 0 as never,
					params: {},
				},
			],
		});

		const decoded = decodeProject(encodeProject({ project, retained: {} }));
		expect(decoded.motionTextSequences).toEqual([sequence]);
		expect(decoded.scenes[0].tracks.overlay[0].elements[0]).toMatchObject({
			type: "motion-text",
			sequenceId: sequence.id,
		});
	});

	test("opaque sequence extensions survive a known-field rewrite", () => {
		const project = projectFixture();
		project.motionTextSequences.push(motionTextSequenceFixture());
		const retained = encodeProject({ project, retained: {} }) as Raw;
		const rawSequence = (retained.motionTextSequences as Raw[])[0];
		rawSequence.futureExtension = {
			provider: "keep",
			values: [1, { nested: true }],
		};

		const decoded = decodeProject(retained);
		decoded.metadata.name = "Known edit";
		const reencoded = encodeProject({ project: decoded, retained }) as Raw;
		expect((reencoded.motionTextSequences as Raw[])[0].futureExtension).toEqual(
			{
				provider: "keep",
				values: [1, { nested: true }],
			},
		);
	});

	test("full sequence replacement does not resurrect removed optional fields", () => {
		const project = projectFixture();
		project.motionTextSequences.push(
			motionTextSequenceFixture({ revision: 3 }),
		);
		const retained = encodeProject({ project, retained: {} }) as Raw;
		const retainedSequence = (retained.motionTextSequences as Raw[])[0];
		retainedSequence.futureExtension = { provider: "keep" };
		retainedSequence.resolvedPlan = {
			version: 1,
			sequenceRevision: 3,
			cuts: [],
		};

		const undoTarget = decodeProject(retained);
		const undoSequence = undoTarget.motionTextSequences[0] as unknown as Raw;
		undoSequence.revision = 2;
		delete undoSequence.resolvedPlan;

		const reencoded = encodeProject({
			project: undoTarget,
			retained,
		}) as Raw;
		const reencodedSequence = (reencoded.motionTextSequences as Raw[])[0];
		expect(Object.hasOwn(reencodedSequence, "resolvedPlan")).toBe(false);
		expect(reencodedSequence.futureExtension).toEqual({ provider: "keep" });
	});
});
