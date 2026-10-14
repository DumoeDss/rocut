import { createHash } from "node:crypto";
import {
	mkdir,
	mkdtemp,
	readFile,
	realpath,
	rename,
	rm,
	rmdir,
	writeFile,
} from "node:fs/promises";
import { basename, dirname, join } from "node:path";

import { expect, spyOn, test } from "bun:test";

import {
	commitTimelineUndo,
	timelineUndoProbe,
	timelineUndoReceipt,
} from "../timeline-undo";
import { reserveUndo } from "../timeline-undo-journal";
import * as undoJournal from "../timeline-undo-journal";

async function fixture(run: (root: string) => Promise<void>) {
	const base = await realpath(
		"E:/AI/ChatAI/Agents/VibeCodingProjects/elftia/_others/rocut",
	);
	const root = await mkdtemp(join(base, "rocut-undo-cpu-"));
	try {
		await run(root);
	} finally {
		const actual = await realpath(root);
		if (
			dirname(actual) !== base ||
			!basename(actual).startsWith("rocut-undo-cpu-")
		)
			throw Error("Unsafe fixture cleanup");
		await rm(actual, { recursive: true, force: true });
	}
}
const request = () => ({
	schemaVersion: 1,
	intentId: "undo-intent",
	originalOperationId: "original",
	executionHash: "a".repeat(64),
	idempotencyKey: `undo:undo-intent:${"a".repeat(64)}`,
	projectId: "project",
	sceneId: "scene",
	expectedRevision: 2,
	kind: "placement",
	clips: [
		{ clipId: "clip", afterDigest: "b".repeat(64), afterAssetId: "asset" },
	],
});
const identity = () => ({
	intentId: "undo-intent",
	executionHash: "a".repeat(64),
});
function harness(
	applyResult: () => Promise<{ revision: number }> = async () => ({
		revision: 3,
	}),
) {
	let calls = 0;
	const automation = {
		project: async () => ({}),
		revision: async () => 2,
		assets: async () => [],
		tracks: async () => [],
		clips: async () => [],
		apply: async () => {
			calls++;
			return applyResult();
		},
	};
	const kernel = (envelope: Uint8Array) => {
		const bytes = Buffer.from(envelope);
		const length = bytes.readUInt32LE();
		const header = JSON.parse(bytes.subarray(4, 4 + length).toString());
		return JSON.stringify({
			schemaVersion: 1,
			status: "admitted",
			intentId: header.request.intentId,
			originalOperationId: header.request.originalOperationId,
			executionHash: header.request.executionHash,
			beforeRevision: header.request.expectedRevision,
			batch: {
				expectedRevision: 2,
				operations: [{ kind: "delete-clip", clipId: "clip" }],
			},
		});
	};
	return { automation: automation as never, kernel, calls: () => calls };
}
test("probe and absent receipt are read-only and do not infer completion from native shape", () =>
	fixture(async (root) => {
		expect(timelineUndoProbe().clipDigest).toBe("rocut-json-f64be-v1");
		expect(await timelineUndoReceipt(root, identity())).toMatchObject({
			status: "reconciliation-required",
		});
	}));
test("commits exactly once and recovers its durable receipt without a current kernel or snapshot", () =>
	fixture(async (root) => {
		const h = harness();
		const args = {
			request: request(),
			projectDirectory: root,
			automation: h.automation,
		};
		expect(await commitTimelineUndo(args, h.kernel)).toMatchObject({
			status: "recorded",
			beforeRevision: 2,
			revision: 3,
			...identity(),
			originalOperationId: "original",
		});
		expect(h.calls()).toBe(1);
		expect(
			await commitTimelineUndo({ ...args, automation: {} as never }, undefined),
		).toMatchObject({ status: "recorded" });
		expect(await timelineUndoReceipt(root, identity())).toMatchObject({
			status: "recorded",
			revision: 3,
		});
		expect(h.calls()).toBe(1);
		await expect(
			commitTimelineUndo(
				{ ...args, request: { ...request(), expectedRevision: 3 } },
				h.kernel,
			),
		).rejects.toThrow("identity-conflict");
	}));
test("dispatch throw after reservation leaves unknown and never repeats apply", () =>
	fixture(async (root) => {
		const h = harness(async () => {
			throw Error("transport-lost-after-commit");
		});
		const args = {
			request: request(),
			projectDirectory: root,
			automation: h.automation,
		};
		expect(await commitTimelineUndo(args, h.kernel)).toMatchObject({
			status: "reconciliation-required",
		});
		expect(await commitTimelineUndo(args, h.kernel)).toMatchObject({
			status: "reconciliation-required",
		});
		expect(h.calls()).toBe(1);
		expect(await timelineUndoReceipt(root, identity())).toMatchObject({
			status: "reconciliation-required",
		});
	}));
test("claim-before-dispatch interruption remains unknown, not a fabricated receipt", () =>
	fixture(async (root) => {
		const r = { ...request(), restoreAssets: [] };
		const fence = await reserveUndo(root, r);
		if ("existing" in fence) throw Error("Unexpected replay");
		await fence.close();
		const h = harness();
		expect(
			await commitTimelineUndo(
				{ request: r, projectDirectory: root, automation: h.automation },
				h.kernel,
			),
		).toMatchObject({ status: "reconciliation-required" });
		expect(h.calls()).toBe(0);
	}));
test("bad fields, paths, stale admission and wrong receipt revisions never produce successful dispatch evidence", () =>
	fixture(async (root) => {
		const h = harness();
		for (const extra of [
			{ patch: {} },
			{ projectDirectory: "outside" },
			{ clips: [{ ...request().clips[0], snapshot: {} }] },
			{
				restoreAssets: [
					{ assetId: "../outside", byteLength: 1, sha256: "a".repeat(64) },
				],
			},
		])
			await expect(
				commitTimelineUndo(
					{
						request: { ...request(), ...extra },
						projectDirectory: root,
						automation: h.automation,
					},
					h.kernel,
				),
			).rejects.toThrow();
		await expect(
			commitTimelineUndo(
				{
					request: request(),
					projectDirectory: root,
					automation: h.automation,
				},
				() =>
					JSON.stringify({
						status: "rejected",
						error: { code: "undo-context-conflict" },
					}),
			),
		).rejects.toThrow("context-conflict");
		expect(h.calls()).toBe(0);
		const wrong = harness(async () => ({ revision: 9 }));
		expect(
			await commitTimelineUndo(
				{
					request: request(),
					projectDirectory: root,
					automation: wrong.automation,
				},
				wrong.kernel,
			),
		).toMatchObject({ status: "reconciliation-required" });
		expect(await timelineUndoReceipt(root, identity())).toMatchObject({
			status: "reconciliation-required",
		});
	}));
test("truncated completion cannot be mistaken for a recorded result", () =>
	fixture(async (root) => {
		const r = { ...request(), restoreAssets: [] };
		const fence = await reserveUndo(root, r);
		if ("existing" in fence) throw Error("Unexpected replay");
		await fence.close();
		const filename = `.timeline-undo-${createHash("sha256").update(r.intentId).digest("hex")}.jsonl`;
		await writeFile(
			join(root, filename),
			'broken-record\n{"status":"recorded"}\n',
		);
		expect(await timelineUndoReceipt(root, identity())).toMatchObject({
			status: "reconciliation-required",
		});
	}));
test("strict reservation and receipt schemas reject incomplete, extra and mismatched evidence", () =>
	fixture(async (root) => {
		const r = { ...request(), restoreAssets: [] };
		const fence = await reserveUndo(root, r);
		if ("existing" in fence) throw Error("Unexpected replay");
		await fence.close();
		const filename = join(
			root,
			`.timeline-undo-${createHash("sha256").update(r.intentId).digest("hex")}.jsonl`,
		);
		const reserved = JSON.parse((await readFile(filename, "utf8")).trim());
		const receipt = {
			schemaVersion: 1,
			status: "recorded",
			...identity(),
			originalOperationId: "original",
			beforeRevision: 2,
			revision: 3,
		};
		for (const bad of [
			{ ...reserved, schemaVersion: 2 },
			{ ...reserved, extra: true },
			{ ...reserved, beforeRevision: -1 },
			{ ...reserved, requestDigest: "invalid" },
		]) {
			await writeFile(
				filename,
				JSON.stringify(bad) + "\n" + JSON.stringify(receipt) + "\n",
			);
			expect(await timelineUndoReceipt(root, identity())).toMatchObject({
				status: "reconciliation-required",
			});
		}
		for (const bad of [
			{ ...receipt, extra: true },
			{ ...receipt, originalOperationId: "other" },
			{ ...receipt, revision: 4 },
		]) {
			await writeFile(
				filename,
				JSON.stringify(reserved) + "\n" + JSON.stringify(bad) + "\n",
			);
			expect(await timelineUndoReceipt(root, identity())).toMatchObject({
				status: "reconciliation-required",
			});
		}
	}));
test("captured directory replacement before dispatch fences apply", () =>
	fixture(async (root) => {
		const moved = root + "-moved";
		const h = harness();
		const automation = {
			...(h.automation as object),
			clips: async () => {
				await rename(root, moved);
				await mkdir(root);
				return [];
			},
		} as never;
		try {
			expect(
				await commitTimelineUndo(
					{ request: request(), projectDirectory: root, automation },
					h.kernel,
				),
			).toMatchObject({ status: "reconciliation-required" });
			expect(h.calls()).toBe(0);
		} finally {
			await rmdir(root);
			await rename(moved, root);
		}
	}));
test("directory replacement after reservation prevents completion evidence", () =>
	fixture(async (root) => {
		const r = { ...request(), restoreAssets: [] };
		const fence = await reserveUndo(root, r);
		if ("existing" in fence) throw Error("Unexpected replay");
		// Windows does not permit renaming a directory with this open file handle.
		// Close it to fault the captured locator; complete must fail before touching it.
		await fence.close();
		const moved = root + "-moved";
		try {
			await rename(root, moved);
			await mkdir(root);
			expect(await fence.unchanged()).toBe(false);
			await expect(
				fence.complete({
					schemaVersion: 1,
					status: "recorded",
					...identity(),
					originalOperationId: "original",
					beforeRevision: 2,
					revision: 3,
				}),
			).rejects.toThrow("redirected");
		} finally {
			await rmdir(root);
			await rename(moved, root);
		}
	}));
test("replayed receipt cannot escape the initial commit directory capture", () =>
	fixture(async (root) => {
		const h = harness(),
			args = {
				request: request(),
				projectDirectory: root,
				automation: h.automation,
			};
		await commitTimelineUndo(args, h.kernel);
		const filename = `.timeline-undo-${createHash("sha256").update(request().intentId).digest("hex")}.jsonl`,
			bytes = await readFile(join(root, filename)),
			moved = root + "-moved",
			capture = undoJournal.captureUndoDirectory;
		const spy = spyOn(undoJournal, "captureUndoDirectory").mockImplementation(
			async (...input) => {
				const guard = await capture(...input);
				await rename(root, moved);
				await mkdir(root);
				await writeFile(join(root, filename), bytes);
				return guard;
			},
		);
		try {
			expect(await commitTimelineUndo(args, h.kernel)).toMatchObject({
				status: "reconciliation-required",
			});
			expect(h.calls()).toBe(1);
		} finally {
			spy.mockRestore();
			await rm(join(root, filename));
			await rmdir(root);
			await rename(moved, root);
		}
	}));
