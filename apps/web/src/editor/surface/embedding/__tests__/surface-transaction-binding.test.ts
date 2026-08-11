/* eslint-disable @typescript-eslint/no-unsafe-type-assertion */
import { describe, expect, test } from "bun:test";

import {
	OPERATION_KINDS,
	type TransactionApply,
	type TransactionBatch,
	type TransactionResult,
} from "@/editor/contracts";

import {
	SurfaceCommitAdapterError,
	createSurfaceCommitBinding,
} from "../surface-transaction-binding";

const batch = {
	operations: [{ kind: "delete-track", trackId: "track-1" }],
} as unknown as TransactionBatch;

const result = {
	revision: 1,
	createdIds: [],
	changedIds: ["track-1"],
} as unknown as TransactionResult;

const malformedPresentOperations = {
	"create-track": [
		{
			kind: "create-track",
			track: { id: "", kind: "caption", name: 7, hidden: "false" },
		},
		{
			kind: "create-track",
			track: {
				id: "track-1",
				kind: { toString: () => "video" },
				name: "Track",
				hidden: false,
			},
		},
	],
	"update-track": [
		{ kind: "update-track", trackId: "track-1", patch: { kind: "caption" } },
		{
			kind: "update-track",
			trackId: "track-1",
			patch: { kind: { toString: () => "video" } },
		},
		{ kind: "update-track", trackId: "track-1", patch: { unsupported: true } },
	],
	"delete-track": [{ kind: "delete-track", trackId: 7 }],
	"create-clip": [
		{
			kind: "create-clip",
			clip: {
				id: "",
				trackId: 7,
				startTime: -1,
				duration: 1.5,
				trimStart: Number.NaN,
				trimEnd: Number.POSITIVE_INFINITY,
				assetId: 7,
			},
		},
	],
	"update-clip": [
		{ kind: "update-clip", clipId: "clip-1", patch: { duration: -1 } },
		{ kind: "update-clip", clipId: "clip-1", patch: { unsupported: true } },
	],
	"delete-clip": [{ kind: "delete-clip", clipId: 7 }],
	"create-asset": [
		{
			kind: "create-asset",
			asset: {
				id: "",
				kind: "document",
				name: 7,
				duration: -1,
				width: 0,
				height: Number.POSITIVE_INFINITY,
			},
		},
		{
			kind: "create-asset",
			asset: {
				id: "asset-1",
				kind: { toString: () => "video" },
				name: "Asset",
			},
		},
	],
	"delete-asset": [{ kind: "delete-asset", assetId: 7 }],
	"create-marker": [
		{
			kind: "create-marker",
			marker: { id: "", time: -1, note: 7, color: false },
		},
	],
	"update-marker": [
		{ kind: "update-marker", markerId: "marker-1", patch: { time: 1.5 } },
		{
			kind: "update-marker",
			markerId: "marker-1",
			patch: { unsupported: true },
		},
	],
	"delete-marker": [{ kind: "delete-marker", markerId: 7 }],
	"update-project": [
		{ kind: "update-project", projectId: "project-1", patch: {} },
		{
			kind: "update-project",
			projectId: "project-1",
			patch: { frameRate: { numerator: 90, denominator: 1 } },
		},
		{
			kind: "update-project",
			projectId: "project-1",
			patch: { unsupported: true },
		},
	],
} satisfies Record<(typeof OPERATION_KINDS)[number], readonly object[]>;

async function flush(): Promise<void> {
	await Promise.resolve();
	await Promise.resolve();
}

describe("Surface transaction binding", () => {
	test("keeps the public void shape and forwards one valid batch exactly once", async () => {
		const applied: TransactionBatch[] = [];
		const apply: TransactionApply = {
			apply: async (value) => {
				applied.push(value);
				return result;
			},
		};
		const errors: Error[] = [];
		const binding = createSurfaceCommitBinding({
			apply,
			onError: (error) => errors.push(error),
		});

		const returned: void = binding.commit({ edit: batch });
		expect(returned).toBeUndefined();
		await flush();
		expect(applied).toEqual([batch]);
		expect(errors).toEqual([]);
	});

	test("rejects malformed unknown values before apply", async () => {
		let applies = 0;
		const errors: Error[] = [];
		const binding = createSurfaceCommitBinding({
			apply: {
				apply: async () => {
					applies += 1;
					return result;
				},
			},
			onError: (error) => errors.push(error),
		});

		const malformed = [
			null,
			42,
			{},
			{ operations: [] },
			{ operations: [null] },
			{ operations: [{ kind: "" }] },
			{ operations: [{ kind: "not-a-t0-operation" }] },
			...OPERATION_KINDS.map((kind) => ({ operations: [{ kind }] })),
		];
		for (const edit of malformed) {
			binding.commit({ edit });
		}
		await flush();
		expect(applies).toBe(0);
		expect(errors).toHaveLength(malformed.length);
		expect(
			errors.every(
				(error) =>
					error instanceof SurfaceCommitAdapterError &&
					error.code === "invalid-transaction-batch",
			),
		).toBe(true);
	});

	test("rejects malformed present payload and patch shapes for every operation kind", async () => {
		let applies = 0;
		const errors: Error[] = [];
		const binding = createSurfaceCommitBinding({
			apply: {
				apply: async () => {
					applies += 1;
					return result;
				},
			},
			onError: (error) => errors.push(error),
		});
		const malformed = OPERATION_KINDS.flatMap((kind) =>
			malformedPresentOperations[kind].map((operation) => ({
				operations: [operation],
			})),
		);

		for (const edit of malformed) binding.commit({ edit });
		await flush();
		expect(applies).toBe(0);
		expect(errors).toHaveLength(malformed.length);
		expect(
			errors.every(
				(error) =>
					error instanceof SurfaceCommitAdapterError &&
					error.code === "invalid-transaction-batch",
			),
		).toBe(true);
	});

	test("accepts the authoritative minimal payload shapes for all operation kinds", async () => {
		const operations = [
			{
				kind: "create-track",
				track: {
					id: "track-1",
					kind: "video",
					name: "Track",
					hidden: false,
				},
			},
			{ kind: "update-track", trackId: "track-1", patch: {} },
			{ kind: "delete-track", trackId: "track-1" },
			{
				kind: "create-clip",
				clip: {
					id: "clip-1",
					trackId: "track-1",
					startTime: 0,
					duration: 1,
					trimStart: 0,
					trimEnd: 0,
				},
			},
			{ kind: "update-clip", clipId: "clip-1", patch: {} },
			{ kind: "delete-clip", clipId: "clip-1" },
			{
				kind: "create-asset",
				asset: { id: "asset-1", kind: "image", name: "Asset" },
			},
			{ kind: "delete-asset", assetId: "asset-1" },
			{
				kind: "create-marker",
				marker: { id: "marker-1", time: 0 },
			},
			{ kind: "update-marker", markerId: "marker-1", patch: {} },
			{ kind: "delete-marker", markerId: "marker-1" },
			{
				kind: "update-project",
				projectId: "project-1",
				patch: { frameRate: { numerator: 30, denominator: 1 } },
			},
		];
		const applied: unknown[] = [];
		const errors: Error[] = [];
		const binding = createSurfaceCommitBinding({
			apply: {
				apply: async (edit) => {
					applied.push(edit);
					return result;
				},
			},
			onError: (error) => errors.push(error),
		});
		const edit = { operations };

		binding.commit({ edit });
		await flush();
		expect(applied).toEqual([edit]);
		expect(errors).toEqual([]);
	});

	test("routes one asynchronous apply failure exactly once without fallback", async () => {
		let applies = 0;
		const errors: Error[] = [];
		const failure = new Error("apply failed");
		const binding = createSurfaceCommitBinding({
			apply: {
				apply: async () => {
					applies += 1;
					throw failure;
				},
			},
			onError: (error) => errors.push(error),
		});

		binding.commit({ edit: batch });
		await flush();
		expect(applies).toBe(1);
		expect(errors).toEqual([failure]);
	});
});
