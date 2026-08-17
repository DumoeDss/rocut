import { cloneTransactionValue } from "./clone";
import type { TransactionEngine, TransactionEngineDocument } from "./types";

/**
 * Construction-owned committed-state capture registry (pure module).
 *
 * Extracted from `engine/engine.ts` (which is ports-coupled persistence
 * orchestration) so the read-only binder is importable by the pure `draft/`
 * subsystem without dragging the ports-coupled module into a vendor tree.
 * `engine.ts` owns registration at construction time and re-exports the
 * binder for compatibility.
 */

export interface NativeCommittedTransactionStateCapture {
	readonly capture: () => Promise<TransactionEngineDocument>;
}

const nativeCommittedStateCaptures = new WeakMap<
	TransactionEngine,
	() => TransactionEngineDocument | Promise<TransactionEngineDocument>
>();

export function registerNativeCommittedStateCapture(args: {
	readonly engine: TransactionEngine;
	readonly capture: () =>
		| TransactionEngineDocument
		| Promise<TransactionEngineDocument>;
}): void {
	if (nativeCommittedStateCaptures.has(args.engine)) {
		throw new TypeError("Native committed-state capture is already registered");
	}
	nativeCommittedStateCaptures.set(args.engine, args.capture);
}

/**
 * Bind the construction-owned native capture into a detached, read-only port.
 *
 * The registry writer stays private to this module. This read-only binder
 * cannot register, replace, or copy a capability onto a wrapper: a wrapper is
 * a distinct object and must pass an explicit provider port directly to the
 * Draft manager.
 */
export function bindNativeCommittedTransactionStateCapture(
	engine: TransactionEngine,
): NativeCommittedTransactionStateCapture | undefined {
	const capture = nativeCommittedStateCaptures.get(engine);
	if (capture === undefined) return undefined;
	return Object.freeze({
		async capture(): Promise<TransactionEngineDocument> {
			return cloneTransactionValue(await capture());
		},
	});
}
