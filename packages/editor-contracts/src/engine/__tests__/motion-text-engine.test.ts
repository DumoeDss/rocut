/* eslint-disable @typescript-eslint/no-unsafe-type-assertion -- The legacy-document case removes one persisted field to exercise additive decoding. */
import { describe, expect, test } from "bun:test";

import {
	clipId,
	mediaTime,
	motionTextCueId,
	motionTextSequenceId,
	projectId,
	trackId,
	TransactionError,
	type MotionTextSequence,
} from "../..";
import { createInMemoryProjectStoreFixture } from "@opencut/editor-ports/in-memory";
import {
	createTransactionNativeDocumentAdapter,
	createTransactionNativeProjectSeed,
} from "../native-adapter";
import { openTransactionEngine } from "../engine";

const PROJECT_ID = projectId("motion-text-engine-project");

function sequence(args: {
	readonly revision: number;
	readonly text: string;
}): MotionTextSequence {
	return {
		id: motionTextSequenceId("sequence:title"),
		schemaVersion: 1,
		revision: args.revision,
		source: { format: "plain", text: args.text },
		language: "en",
		duration: mediaTime({ ticks: 120_000 }),
		compositionMode: "overlay",
		seed: 7,
		engine: {
			id: "jizura",
			version: "0.9.0",
			catalogHash: "fixture-catalog",
			plannerVersion: 1,
			tokenizerVersion: "unicode-v1",
		},
		fonts: [],
		defaults: {
			preset: {
				style: "base",
				layout: "center",
				enter: "fade",
				hold: "still",
				exit: "fade",
				decor: [],
				treat: "none",
				bg: "transparent",
				cam: "static",
				fx: [],
				trans: null,
			},
			colors: {},
			parameters: {},
		},
		cues: [
			{
				id: motionTextCueId("cue:title"),
				text: args.text,
				startTime: mediaTime({ ticks: 0 }),
				duration: mediaTime({ ticks: 120_000 }),
				interlude: false,
				gapBefore: false,
				impact: false,
				emphasis: [],
				segments: [args.text],
				locks: [],
				overrides: {},
			},
		],
	};
}

async function fixture() {
	const { store, control } = createInMemoryProjectStoreFixture();
	await store.save(
		createTransactionNativeProjectSeed({
			projectId: PROJECT_ID,
			project: {
				id: PROJECT_ID,
				name: "Motion text",
				frameRate: { numerator: 30, denominator: 1 },
				canvasWidth: 1920,
				canvasHeight: 1080,
			},
		}),
	);
	const adapter = createTransactionNativeDocumentAdapter();
	const engine = await openTransactionEngine({
		store,
		projectId: PROJECT_ID,
		documentAdapter: adapter,
	});
	return { store, control, adapter, engine };
}

describe("motion-text transaction entity", () => {
	test("creates a sequence and referencing clip atomically and preserves both on reopen", async () => {
		const { store, adapter, engine } = await fixture();
		const operations = [
			{
				kind: "create-track" as const,
				track: {
					id: trackId("track:titles"),
					kind: "graphic" as const,
					name: "Titles",
					hidden: false,
				},
			},
			{
				kind: "create-motion-text-sequence" as const,
				sequence: sequence({ revision: 0, text: "Hello" }),
			},
			{
				kind: "create-clip" as const,
				clip: {
					id: clipId("clip:title"),
					trackId: trackId("track:titles"),
					startTime: mediaTime({ ticks: 0 }),
					duration: mediaTime({ ticks: 120_000 }),
					trimStart: mediaTime({ ticks: 0 }),
					trimEnd: mediaTime({ ticks: 0 }),
					content: {
						kind: "motion-text" as const,
						sequenceId: motionTextSequenceId("sequence:title"),
					},
				},
			},
		];

		await engine.apply({ operations, idempotencyKey: "create-motion-title" });
		expect(await engine.motionTextSequences?.()).toEqual([
			sequence({ revision: 0, text: "Hello" }),
		]);

		const reopened = await openTransactionEngine({
			store,
			projectId: PROJECT_ID,
			documentAdapter: adapter,
		});
		expect(await reopened.clips()).toHaveLength(1);
		expect(await reopened.motionTextSequences?.()).toHaveLength(1);
		await expect(
			reopened.apply({
				operations: [
					{
						kind: "delete-motion-text-sequence",
						sequenceId: motionTextSequenceId("sequence:title"),
						expectedSequenceRevision: 0,
					},
				],
			}),
		).rejects.toBeInstanceOf(TransactionError);
		expect(await reopened.motionTextSequences?.()).toHaveLength(1);
		await reopened.apply({
			operations: [
				{ kind: "delete-clip", clipId: clipId("clip:title") },
				{
					kind: "delete-motion-text-sequence",
					sequenceId: motionTextSequenceId("sequence:title"),
					expectedSequenceRevision: 0,
				},
			],
		});
		expect(await reopened.motionTextSequences?.()).toEqual([]);
	});

	test("enforces entity revisions and keyed replay", async () => {
		const { engine } = await fixture();
		await engine.apply({
			operations: [
				{
					kind: "create-motion-text-sequence",
					sequence: sequence({ revision: 0, text: "Hello" }),
				},
			],
		});

		const update = {
			operations: [
				{
					kind: "update-motion-text-sequence" as const,
					sequenceId: motionTextSequenceId("sequence:title"),
					expectedSequenceRevision: 0,
					sequence: sequence({ revision: 1, text: "Updated" }),
				},
			],
			idempotencyKey: "update-motion-title",
		};
		const first = await engine.apply(update);
		expect(await engine.apply(update)).toEqual(first);
		await expect(
			engine.apply({
				operations: [
					{
						kind: "update-motion-text-sequence",
						sequenceId: motionTextSequenceId("sequence:title"),
						expectedSequenceRevision: 0,
						sequence: sequence({ revision: 2, text: "Stale" }),
					},
				],
			}),
		).rejects.toBeInstanceOf(TransactionError);
	});

	test("decodes pre-motion-text documents as an empty collection", async () => {
		const adapter = createTransactionNativeDocumentAdapter();
		const seed = createTransactionNativeProjectSeed({ projectId: PROJECT_ID });
		const legacy = structuredClone(seed.record);
		const data = legacy.data as Record<string, unknown>;
		const transactionEngine = data.transactionEngine as Record<string, unknown>;
		delete transactionEngine.motionTextSequences;

		const decoded = adapter.decode({ projectId: PROJECT_ID, record: legacy });
		expect(decoded.motionTextSequences).toEqual([]);
	});
});
