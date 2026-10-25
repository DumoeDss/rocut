import { readFile } from "node:fs/promises";
import { request } from "./host-request";
import type { ResolvedTarget } from "./target-registry";

/** Read-only protocol mapping. apply-status observes a prior batch through native dryRun. */
export async function runNativeReadCli(
	command: "record" | "apply-status" | "programmatic-validate",
	positional: readonly string[],
	resolved: Pick<ResolvedTarget, "secret">,
	io: {
		request?: typeof request;
		readSpec?: (file: string) => Promise<Uint8Array>;
	} = {},
): Promise<unknown> {
	const invoke = io.request ?? request;
	if (command === "programmatic-validate") {
		if (positional.length !== 1)
			throw new Error("usage: rocut programmatic-validate <source.json>");
		const bytes = await (io.readSpec ?? readFile)(positional[0]!);
		if (bytes.byteLength > 4 * 1024 ** 2)
			throw new Error("Programmatic source exceeds the JSON limit");
		const source: unknown = JSON.parse(
			new TextDecoder("utf-8", { fatal: true }).decode(bytes),
		);
		return invoke(resolved.secret, "POST", "programmatic/validate", source);
	}
	if (command === "record") {
		if (positional.length) throw new Error("usage: rocut record");
		return invoke(resolved.secret, "GET", "record");
	}
	if (command !== "apply-status" || positional.length !== 1)
		throw new Error("usage: rocut apply-status <original-batch.json>");
	const bytes = await (io.readSpec ?? readFile)(positional[0]!);
	if (bytes.byteLength > 32 * 1024 ** 2)
		throw new Error("Native status batch exceeds the JSON limit");
	const value: unknown = JSON.parse(
		new TextDecoder("utf-8", { fatal: true }).decode(bytes),
	);
	if (!value || typeof value !== "object" || Array.isArray(value))
		throw new Error("Native status requires the original batch");
	const batch = value as Record<string, unknown>;
	if (
		Object.keys(batch).some(
			(key) =>
				!["expectedRevision", "idempotencyKey", "operations"].includes(key),
		) ||
		typeof batch.expectedRevision !== "number" ||
		!Number.isSafeInteger(batch.expectedRevision) ||
		batch.expectedRevision < 0 ||
		typeof batch.idempotencyKey !== "string" ||
		!batch.idempotencyKey ||
		batch.idempotencyKey.length > 500 ||
		/[\x00-\x1f]/.test(batch.idempotencyKey) ||
		!Array.isArray(batch.operations) ||
		batch.operations.length > 10000 ||
		batch.operations.some(
			(operation) =>
				!operation || typeof operation !== "object" || Array.isArray(operation),
		)
	)
		throw new Error(
			"Native status requires the exact original revision, key and operations",
		);
	// Do not route through apply, change keys/revision, or project away unknown operation fields.
	return invoke(resolved.secret, "POST", "apply-status", value);
}
