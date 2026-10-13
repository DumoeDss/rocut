import type { AutomationApi } from "@opencut/editor-automation";
import * as wasm from "opencut-wasm";

import {
	readReplacementMedia,
	readReplacementRequest,
} from "./timeline-replacement";
import {
	captureUndoDirectory,
	readUndoReceipt,
	reserveUndo,
	type UndoReceipt,
	undoRequestDigest,
} from "./timeline-undo-journal";

const binding = () =>
	(
		wasm as unknown as {
			resolveTimelineUndoBytes?: (input: Uint8Array) => string;
		}
	).resolveTimelineUndoBytes;
const object = (v: unknown): Record<string, unknown> => {
	if (!v || typeof v !== "object" || Array.isArray(v))
		throw Error("undo-object-invalid");
	return v as Record<string, unknown>;
};
function keys(v: Record<string, unknown>, allowed: string[]) {
	if (Object.keys(v).some((key) => !allowed.includes(key)))
		throw Error("undo-field-invalid");
}
function id(v: unknown): asserts v is string {
	if (
		typeof v !== "string" ||
		!v ||
		v.length > 500 ||
		/[\u0000-\u001f]/.test(v)
	)
		throw Error("undo-id-invalid");
}
function digest(v: unknown): asserts v is string {
	if (typeof v !== "string" || !/^[a-f0-9]{64}$/.test(v))
		throw Error("undo-hash-invalid");
}
export function undoIdentity(value: unknown) {
	const v = object(value);
	keys(v, ["intentId", "executionHash"]);
	id(v.intentId);
	digest(v.executionHash);
	return { intentId: v.intentId, executionHash: v.executionHash };
}
function request(value: unknown) {
	const v = object(value);
	keys(v, [
		"schemaVersion",
		"intentId",
		"originalOperationId",
		"executionHash",
		"idempotencyKey",
		"projectId",
		"sceneId",
		"expectedRevision",
		"kind",
		"clips",
		"restoreAssets",
	]);
	for (const field of [
		"intentId",
		"originalOperationId",
		"idempotencyKey",
		"projectId",
		"sceneId",
	])
		id(v[field]);
	digest(v.executionHash);
	if (
		v.schemaVersion !== 1 ||
		!Number.isSafeInteger(v.expectedRevision) ||
		Number(v.expectedRevision) < 0 ||
		!["placement", "replacement"].includes(String(v.kind)) ||
		!Array.isArray(v.clips) ||
		!v.clips.length ||
		v.clips.length > 10000
	)
		throw Error("undo-request-invalid");
	for (const clip of v.clips) {
		const c = object(clip);
		keys(c, ["clipId", "afterDigest", "afterAssetId", "beforeAssetId"]);
		id(c.clipId);
		id(c.afterAssetId);
		digest(c.afterDigest);
		if (c.beforeAssetId !== undefined) id(c.beforeAssetId);
	}
	if (
		v.restoreAssets !== undefined &&
		(!Array.isArray(v.restoreAssets) || v.restoreAssets.length > 10000)
	)
		throw Error("undo-restore-invalid");
	const restores = (v.restoreAssets ?? []) as unknown[];
	let total = 0;
	const restoreAssets = restores.map((item) => {
		const a = object(item);
		keys(a, ["assetId", "byteLength", "sha256"]);
		id(a.assetId);
		digest(a.sha256);
		if (
			!/^[A-Za-z0-9][A-Za-z0-9._-]{0,499}$/.test(a.assetId) ||
			!Number.isSafeInteger(a.byteLength) ||
			Number(a.byteLength) <= 0
		)
			throw Error("undo-restore-invalid");
		total += Number(a.byteLength);
		if (total > 1024 ** 3) throw Error("undo-media-limit");
		return {
			assetId: a.assetId,
			byteLength: Number(a.byteLength),
			sha256: a.sha256,
		};
	});
	return {
		...v,
		intentId: v.intentId as string,
		originalOperationId: v.originalOperationId as string,
		executionHash: v.executionHash,
		expectedRevision: Number(v.expectedRevision),
		restoreAssets,
	};
}
export const timelineUndoProbe = () => ({
	schemaVersion: 1,
	protocol: 1,
	guardedCommit: typeof binding() === "function",
	receipt: "timeline-undos/receipt",
	clipDigest: "rocut-json-f64be-v1",
	authorization: "trusted-caller-required",
});
export const readUndoRequest = readReplacementRequest;
export async function timelineUndoReceipt(
	projectDirectory: string,
	value: unknown,
) {
	return readUndoReceipt(projectDirectory, undoIdentity(value));
}

/** Caller must hold HostPlane.enqueue. No inferred authorization or fallback patch path. */
export async function commitTimelineUndo(
	args: {
		request: unknown;
		projectDirectory: string;
		automation: AutomationApi;
	},
	kernel = binding(),
) {
	const r = request(args.request);
	const directoryUnchanged = await captureUndoDirectory(
		args.projectDirectory,
		r,
	);
	// A retained receipt/fence must be observed even when the current kernel is unavailable.
	const existing = await readUndoReceipt(
		args.projectDirectory,
		r,
		undoRequestDigest(r),
	);
	if (existing.status === "recorded" || existing.retainedIntent)
		return existing;
	if (!kernel) throw Error("undo-kernel-unavailable");
	const chunks: Buffer[] = [];
	const attachments = [];
	for (const asset of r.restoreAssets) {
		const media = await readReplacementMedia(
			args.projectDirectory,
			asset.assetId,
		);
		if (media.bytes.length !== asset.byteLength)
			throw Error("undo-media-length-conflict");
		chunks.push(media.bytes);
		attachments.push({
			assetId: asset.assetId,
			metadata: media.metadata,
			byteLength: media.bytes.length,
		});
	}
	const [project, revision, assets, tracks, clips] = await Promise.all([
		args.automation.project(),
		args.automation.revision(),
		args.automation.assets(),
		args.automation.tracks(),
		args.automation.clips(),
	]);
	const header = Buffer.from(
		JSON.stringify({
			request: r,
			project,
			revision,
			assets,
			tracks,
			clips,
			attachments,
		}),
	);
	if (header.length > 4 * 1024 * 1024) throw Error("undo-input-limit");
	const length = Buffer.alloc(4);
	length.writeUInt32LE(header.length);
	const admitted = JSON.parse(
		kernel(Buffer.concat([length, header, ...chunks])),
	);
	if (admitted.status !== "admitted")
		throw Error(admitted.error?.code ?? "undo-rejected");
	if (
		admitted.intentId !== r.intentId ||
		admitted.executionHash !== r.executionHash ||
		admitted.originalOperationId !== r.originalOperationId ||
		admitted.beforeRevision !== r.expectedRevision
	)
		throw Error("undo-admission-identity-conflict");
	if (!(await directoryUnchanged()))
		return {
			status: "reconciliation-required" as const,
			...undoIdentity({ intentId: r.intentId, executionHash: r.executionHash }),
		};
	const fence = await reserveUndo(args.projectDirectory, r);
	if ("existing" in fence) return fence.existing;
	try {
		if (!(await directoryUnchanged()) || !(await fence.unchanged()))
			throw Error("undo-journal-directory-redirected");
		const result = await args.automation.apply(admitted.batch);
		if (result.revision !== r.expectedRevision + 1)
			throw Error("undo-commit-revision-conflict");
		const receipt: UndoReceipt = {
			schemaVersion: 1,
			status: "recorded",
			intentId: r.intentId,
			originalOperationId: r.originalOperationId,
			executionHash: r.executionHash,
			beforeRevision: r.expectedRevision,
			revision: result.revision,
		};
		await fence.complete(receipt);
		return receipt;
	} catch {
		return {
			status: "reconciliation-required" as const,
			intentId: r.intentId,
			executionHash: r.executionHash,
		};
	} finally {
		await fence.close();
	}
}
