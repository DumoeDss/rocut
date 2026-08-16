/**
 * Fault and scheduling control for the alien store (S05 P3, design E7).
 *
 * The conformance suite's fixture seam needs a store that can be told to fail
 * or stall its next mutation, and to report a synthetic storage inspection.
 * This is adapter plumbing over the alien store's own backing map -- the
 * editor never sees it. It mirrors the structural contract of the reference
 * control without sharing its implementation: the queue here gates the store's
 * single serialized commit path rather than per-map locks.
 */
import type {
	ProjectStoreErrorCode,
	ProjectStoreErrorScope,
	ProjectStoreInspection,
	ProjectStoreOperation,
} from "@opencut/editor-ports";
import { ProjectStoreError } from "@opencut/editor-ports";

export interface AlienMutationPause {
	readonly entered: Promise<void>;
	release(): void;
}

interface PendingPause {
	readonly operation: ProjectStoreOperation;
	readonly markEntered: () => void;
	readonly wait: Promise<void>;
}

const cloneInspection = (
	inspection: ProjectStoreInspection,
): ProjectStoreInspection =>
	JSON.parse(JSON.stringify(inspection)) as ProjectStoreInspection;

export class AlienStoreControl {
	private inspection: ProjectStoreInspection = {
		availability: "available",
		capacity: null,
	};
	private readonly failures: Array<{
		operation: ProjectStoreOperation;
		code: ProjectStoreErrorCode;
	}> = [];
	private readonly pauses: PendingPause[] = [];

	setInspection(inspection: ProjectStoreInspection): void {
		this.inspection = cloneInspection(inspection);
	}

	readInspection(): ProjectStoreInspection {
		return cloneInspection(this.inspection);
	}

	failNext(args: {
		operation: ProjectStoreOperation;
		code: ProjectStoreErrorCode;
	}): void {
		this.failures.push(args);
	}

	pauseNext(args: { operation: ProjectStoreOperation }): AlienMutationPause {
		let markEntered!: () => void;
		const entered = new Promise<void>((resolve) => {
			markEntered = resolve;
		});
		let release!: () => void;
		const wait = new Promise<void>((resolve) => {
			release = resolve;
		});
		this.pauses.push({ operation: args.operation, markEntered, wait });
		return { entered, release };
	}

	/**
	 * The single pre-commit gate: abort check, then the queued typed failure,
	 * then the queued pause. Called by the store inside its serialized commit
	 * section, so a paused mutation holds the store's ordering for its identity
	 * class exactly as a slow real backend would.
	 */
	async beforeCommit(args: {
		operation: ProjectStoreOperation;
		scope: ProjectStoreErrorScope;
		signal?: AbortSignal;
	}): Promise<void> {
		if (args.signal?.aborted) {
			throw aborted(args.operation, args.scope);
		}
		const failureIndex = this.failures.findIndex(
			(item) => item.operation === args.operation,
		);
		if (failureIndex >= 0) {
			const [failure] = this.failures.splice(failureIndex, 1);
			throw new ProjectStoreError({
				code: failure.code,
				operation: args.operation,
				scope: args.scope,
			});
		}
		const pauseIndex = this.pauses.findIndex(
			(item) => item.operation === args.operation,
		);
		if (pauseIndex >= 0) {
			const [pause] = this.pauses.splice(pauseIndex, 1);
			pause.markEntered();
			await pause.wait;
			if (args.signal?.aborted) {
				throw aborted(args.operation, args.scope);
			}
		}
	}
}

function aborted(
	operation: ProjectStoreOperation,
	scope: ProjectStoreErrorScope,
): ProjectStoreError {
	return new ProjectStoreError({
		code: "aborted",
		operation,
		scope,
	});
}
