import { createHash } from "node:crypto";
import { lstat, open, realpath } from "node:fs/promises";
import { join, resolve } from "node:path";

import {
	nativeExportManifestBytes,
	readNativeExportFile,
} from "./native-export-readback";

export interface UndoReceipt {
	schemaVersion: 1;
	status: "recorded";
	intentId: string;
	originalOperationId: string;
	executionHash: string;
	beforeRevision: number;
	revision: number;
}
export interface UndoIdentity {
	intentId: string;
	executionHash: string;
}
const name = (intentId: string) =>
	`.timeline-undo-${createHash("sha256").update(intentId).digest("hex")}.jsonl`;
async function location(directory: string, intentId: string) {
	const root = resolve(directory);
	if ((await realpath(root)) !== root || (await lstat(root)).isSymbolicLink())
		throw Error("undo-journal-directory-redirected");
	return { root, path: join(root, name(intentId)), stat: await lstat(root) };
}
const unknown = (identity: UndoIdentity, retainedIntent = true) => ({
	status: "reconciliation-required" as const,
	retainedIntent,
	...identity,
});
type Location = Awaited<ReturnType<typeof location>>;
async function unchanged(target: Location) {
	try {
		const current = await lstat(target.root);
		return (
			(await realpath(target.root)) === target.root &&
			!current.isSymbolicLink() &&
			current.dev === target.stat.dev &&
			current.ino === target.stat.ino
		);
	} catch {
		return false;
	}
}
export async function captureUndoDirectory(
	directory: string,
	identity: UndoIdentity,
) {
	const target = await location(directory, identity.intentId);
	return () => unchanged(target);
}
const exact = (v: unknown, fields: string[]): v is Record<string, unknown> =>
	!!v &&
	typeof v === "object" &&
	!Array.isArray(v) &&
	Object.keys(v).length === fields.length &&
	fields.every((k) => Object.hasOwn(v, k));
const validId = (v: unknown) =>
	typeof v === "string" &&
	v.length > 0 &&
	v.length <= 500 &&
	!/[\u0000-\u001f]/.test(v);
const validHash = (v: unknown) =>
	typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
const revision = (v: unknown) => Number.isSafeInteger(v) && Number(v) >= 0;
export const undoRequestDigest = (request: unknown) =>
	createHash("sha256").update(nativeExportManifestBytes(request)).digest("hex");
export async function readUndoReceipt(
	directory: string,
	identity: UndoIdentity,
	expectedRequestDigest?: string,
) {
	let target: Location;
	try {
		target = await location(directory, identity.intentId);
	} catch {
		return unknown(identity);
	}
	let bytes: Buffer;
	try {
		if (!(await unchanged(target))) return unknown(identity);
		bytes = await readNativeExportFile(target.path, 16384);
		if (!(await unchanged(target))) return unknown(identity);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT")
			return unknown(identity, !(await unchanged(target)));
		throw error;
	}
	try {
		const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
		if (!text.endsWith("\n")) return unknown(identity);
		const lines = text.trimEnd().split("\n");
		const reserved = JSON.parse(lines[0]);
		if (
			!exact(reserved, [
				"schemaVersion",
				"status",
				"intentId",
				"executionHash",
				"originalOperationId",
				"beforeRevision",
				"requestDigest",
			]) ||
			reserved.schemaVersion !== 1 ||
			reserved.status !== "reserved" ||
			!validId(reserved.intentId) ||
			!validId(reserved.originalOperationId) ||
			!validHash(reserved.executionHash) ||
			!validHash(reserved.requestDigest) ||
			!revision(reserved.beforeRevision)
		)
			return unknown(identity);
		if (
			reserved.status !== "reserved" ||
			reserved.intentId !== identity.intentId ||
			reserved.executionHash !== identity.executionHash ||
			(expectedRequestDigest &&
				reserved.requestDigest !== expectedRequestDigest)
		)
			throw Error("undo-journal-identity-conflict");
		if (lines.length !== 2) return unknown(identity);
		const receipt = JSON.parse(lines[1]);
		if (
			!exact(receipt, [
				"schemaVersion",
				"status",
				"intentId",
				"originalOperationId",
				"executionHash",
				"beforeRevision",
				"revision",
			]) ||
			receipt.schemaVersion !== 1 ||
			receipt.status !== "recorded" ||
			receipt.intentId !== identity.intentId ||
			receipt.executionHash !== identity.executionHash ||
			receipt.originalOperationId !== reserved.originalOperationId ||
			receipt.beforeRevision !== reserved.beforeRevision ||
			!revision(receipt.beforeRevision) ||
			!revision(receipt.revision) ||
			receipt.revision !== Number(receipt.beforeRevision) + 1
		)
			return unknown(identity);
		return receipt as unknown as UndoReceipt;
	} catch (error) {
		if ((error as Error).message === "undo-journal-identity-conflict")
			throw error;
		return unknown(identity);
	}
}

/** Exclusive durable reservation before apply; an incomplete record is never retried. */
export async function reserveUndo(
	directory: string,
	request: UndoIdentity & {
		originalOperationId: string;
		expectedRevision: number;
	},
) {
	const target = await location(directory, request.intentId);
	let file;
	try {
		file = await open(target.path, "wx", 0o600);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "EEXIST")
			return {
				existing: await readUndoReceipt(
					directory,
					request,
					undoRequestDigest(request),
				),
			};
		throw error;
	}
	try {
		if (!(await unchanged(target))) {
			await file.close();
			return { existing: unknown(request) };
		}
		await file.writeFile(
			JSON.stringify({
				schemaVersion: 1,
				status: "reserved",
				intentId: request.intentId,
				executionHash: request.executionHash,
				originalOperationId: request.originalOperationId,
				beforeRevision: request.expectedRevision,
				requestDigest: undoRequestDigest(request),
			}) + "\n",
			"utf8",
		);
		await file.sync();
	} catch (error) {
		await file.close();
		throw error;
	}
	return {
		unchanged: () => unchanged(target),
		async complete(receipt: UndoReceipt) {
			if (!(await unchanged(target)))
				throw Error("undo-journal-directory-redirected");
			if (
				!exact(receipt, [
					"schemaVersion",
					"status",
					"intentId",
					"originalOperationId",
					"executionHash",
					"beforeRevision",
					"revision",
				]) ||
				receipt.schemaVersion !== 1 ||
				receipt.status !== "recorded" ||
				receipt.intentId !== request.intentId ||
				receipt.executionHash !== request.executionHash ||
				receipt.originalOperationId !== request.originalOperationId ||
				receipt.beforeRevision !== request.expectedRevision ||
				!revision(receipt.beforeRevision) ||
				!revision(receipt.revision) ||
				receipt.revision !== request.expectedRevision + 1
			)
				throw Error("undo-journal-receipt-conflict");
			await file.writeFile(JSON.stringify(receipt) + "\n", "utf8");
			await file.sync();
		},
		close: () => file.close(),
	};
}
