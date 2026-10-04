import type { SessionResourceRef } from "./resources";

const RELEASE_HISTORY_LIMIT = 1024;

/** Live ownership and bounded diagnostics have different lifetimes. */
export class ResourceLedger<T extends SessionResourceRef> {
	private readonly acquired = new Set<T>();
	private readonly history: SessionResourceRef[] = [];
	private releasedCount = 0;

	track(entry: T): void {
		this.acquired.add(entry);
	}

	retire(entry: T): void {
		// GPU tombstones still participate in independent runtime reconciliation.
		if (entry.resourceClass !== "gpuResource") this.acquired.delete(entry);
		this.history[this.releasedCount % RELEASE_HISTORY_LIMIT] = {
			resourceId: entry.resourceId,
			resourceClass: entry.resourceClass,
		};
		this.releasedCount += 1;
	}

	entries(): T[] {
		return [...this.acquired];
	}

	releaseHistory(): {
		releaseOrder: SessionResourceRef[];
		releaseOrderOmitted: number;
	} {
		const offset =
			this.releasedCount > RELEASE_HISTORY_LIMIT
				? this.releasedCount % RELEASE_HISTORY_LIMIT
				: 0;
		return {
			releaseOrder: [
				...this.history.slice(offset),
				...this.history.slice(0, offset),
			],
			releaseOrderOmitted: Math.max(
				0,
				this.releasedCount - RELEASE_HISTORY_LIMIT,
			),
		};
	}
}
