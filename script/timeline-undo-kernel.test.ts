import { readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, describe, expect, test } from "bun:test";
import {
	commitTimelineUndo,
	timelineUndoReceipt,
} from "../apps/cli/src/timeline-undo";
import { reserveUndo } from "../apps/cli/src/timeline-undo-journal";
const runtime =
	process.env.TIMELINE_UNDO_RUN_ROOT && process.env.TIMELINE_UNDO_WASM_PKG
		? await import("./timeline-undo-kernel-fixture")
		: undefined;
const fixture =
	runtime?.fixture ??
	(async () => {
		throw Error("Private WASM environment required");
	});
const kernel = runtime?.kernel;
const observations: unknown[] = [];
afterAll(async () => {
	if (runtime)
		await writeFile(
			join(runtime.runRoot, "kernel-results.json"),
			JSON.stringify(
				{ schemaVersion: 1, actualWasmKernel: true, observations },
				null,
				2,
			) + "\n",
		);
});
async function journal(root: string) {
	const files = (await readdir(root)).filter((name) =>
		name.startsWith(".timeline-undo-"),
	);
	return Promise.all(
		files.map(async (name) => ({
			name,
			content: await readFile(join(root, name), "utf8"),
		})),
	);
}

describe.skipIf(!runtime)(
	"isolated real WASM undo admission + real transaction engine + durable receipt",
	() => {
		test("placement removes only its exact clip, preserves imported assets, records revision once and replays receipt", async () => {
			const f = await fixture("placement");
			try {
				const receipt = await commitTimelineUndo(
					{
						request: f.request,
						projectDirectory: f.root,
						automation: f.automation,
					},
					kernel,
				);
				expect(receipt).toEqual({
					schemaVersion: 1,
					status: "recorded",
					intentId: f.request.intentId,
					originalOperationId: f.request.originalOperationId,
					executionHash: f.request.executionHash,
					beforeRevision: f.revision,
					revision: f.revision + 1,
				});
				expect(await f.automation.clips()).toEqual([]);
				expect(
					(await f.automation.assets()).map((asset) => asset.id).sort(),
				).toEqual(["new", "old"]);
				expect(
					await timelineUndoReceipt(f.root, {
						intentId: f.request.intentId,
						executionHash: f.request.executionHash,
					}),
				).toEqual(receipt);
				expect(
					await commitTimelineUndo(
						{
							request: f.request,
							projectDirectory: f.root,
							automation: f.automation,
						},
						kernel,
					),
				).toEqual(receipt);
				expect(Number(await f.automation.revision())).toBe(f.revision + 1);
				await expect(
					timelineUndoReceipt(f.root, {
						intentId: f.request.intentId,
						executionHash: "f".repeat(64),
					}),
				).rejects.toThrow("undo-journal-identity-conflict");
				observations.push({
					kind: "placement",
					receipt,
					revision: Number(await f.automation.revision()),
					clips: await f.automation.clips(),
					assets: await f.automation.assets(),
					journal: await journal(f.root),
				});
			} finally {
				await f.cleanup();
			}
		});
		test("replacement restores only the exact previous asset and preserves trim, timing and retained media bytes", async () => {
			const f = await fixture("replacement");
			try {
				const oldBytes = await readFile(join(f.mediaDirectory, "body.bin"));
				const receipt = await commitTimelineUndo(
					{
						request: f.request,
						projectDirectory: f.root,
						automation: f.automation,
					},
					kernel,
				);
				expect(receipt.status).toBe("recorded");
				expect(await f.automation.clips()).toEqual([
					{ ...f.before, assetId: "old" },
				]);
				expect(await readFile(join(f.mediaDirectory, "body.bin"))).toEqual(
					oldBytes,
				);
				expect(Number(await f.automation.revision())).toBe(f.revision + 1);
				expect((await f.automation.assets()).length).toBe(2);
				observations.push({
					kind: "replacement",
					receipt,
					before: f.before,
					clips: await f.automation.clips(),
					revision: Number(await f.automation.revision()),
					journal: await journal(f.root),
				});
			} finally {
				await f.cleanup();
			}
		});
		test("actual subsequent editing is rejected by the WASM revision guard before mutation or receipt", async () => {
			const f = await fixture("placement");
			try {
				await f.automation.apply({
					operations: [
						{
							kind: "update-clip",
							clipId: f.before.id,
							patch: { startTime: 4000 as never },
						},
					],
				});
				const current = await f.automation.clips();
				await expect(
					commitTimelineUndo(
						{
							request: f.request,
							projectDirectory: f.root,
							automation: f.automation,
						},
						kernel,
					),
				).rejects.toThrow("undo-context-conflict");
				expect(await f.automation.clips()).toEqual(current);
				expect(Number(await f.automation.revision())).toBe(f.revision + 1);
				expect(
					(
						await timelineUndoReceipt(f.root, {
							intentId: f.request.intentId,
							executionHash: f.request.executionHash,
						})
					).status,
				).toBe("reconciliation-required");
				observations.push({
					kind: "subsequent-edit-rejected",
					revision: Number(await f.automation.revision()),
					clips: current,
				});
			} finally {
				await f.cleanup();
			}
		});
		test("real WASM rejects forged after digest and changed restore bytes without mutation", async () => {
			const f = await fixture("replacement");
			try {
				const forged = structuredClone(f.request);
				forged.clips[0].afterDigest = "b".repeat(64);
				await expect(
					commitTimelineUndo(
						{
							request: forged,
							projectDirectory: f.root,
							automation: f.automation,
						},
						kernel,
					),
				).rejects.toThrow("undo-current-after-conflict");
				const bytes = await readFile(join(f.mediaDirectory, "body.bin"));
				bytes[0] ^= 1;
				await writeFile(join(f.mediaDirectory, "body.bin"), bytes);
				await expect(
					commitTimelineUndo(
						{
							request: f.request,
							projectDirectory: f.root,
							automation: f.automation,
						},
						kernel,
					),
				).rejects.toThrow("undo-media-conflict");
				expect(await f.automation.clips()).toEqual([f.before]);
				expect(Number(await f.automation.revision())).toBe(f.revision);
				observations.push({
					kind: "digest-and-media-tampering-rejected",
					revision: Number(await f.automation.revision()),
					clips: await f.automation.clips(),
				});
			} finally {
				await f.cleanup();
			}
		});
		test("an actual unresolved reservation remains read-only and is never dispatched again", async () => {
			const f = await fixture("placement");
			try {
				const fence = await reserveUndo(f.root, f.request);
				if ("existing" in fence)
					throw Error("Fresh fixture unexpectedly reserved");
				await fence.close();
				const result = await commitTimelineUndo(
					{
						request: f.request,
						projectDirectory: f.root,
						automation: f.automation,
					},
					kernel,
				);
				expect(result.status).toBe("reconciliation-required");
				expect(await f.automation.clips()).toEqual([f.before]);
				expect(Number(await f.automation.revision())).toBe(f.revision);
				observations.push({
					kind: "unresolved-reservation-no-dispatch",
					result,
					revision: Number(await f.automation.revision()),
					journal: await journal(f.root),
				});
			} finally {
				await f.cleanup();
			}
		});
	},
);
