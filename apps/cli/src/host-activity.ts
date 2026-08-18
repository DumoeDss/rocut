/**
 * Daemon-side activity tracking (S08 R / D4) — the idle-vs-in-use signal the
 * landed host supervisor's D6 review asked for.
 *
 * `lastActivityAt` is the epoch-ms of the last authenticated request start
 * and of each revision-stream event emission. `/health` probes are
 * infrastructure traffic — they would fake activity — so they track a
 * separate `lastProbeAt`, exposed but never used for idle decisions.
 *
 * Known limit, stated honestly: a silent viewer pane (SSE connected, no
 * revisions, no saves) reads as idle; a pane heartbeat is a pane-side
 * follow-up, not a daemon invention.
 */
import type { TargetRegistry } from "./target-registry";

/** One registry rewrite per daemon at most this often (injectable for tests). */
export const ACTIVITY_SYNC_INTERVAL_MS = 60_000;

export interface ActivitySnapshot {
	readonly id: string;
	readonly startedAt: number;
	readonly lastActivityAt: number | null;
	readonly lastProbeAt: number | null;
}

export interface ActivityTracker {
	/** An authenticated request started / a revision-stream event was emitted. */
	note(): void;
	/** A `/health` probe arrived — recorded, but never as activity. */
	noteProbe(): void;
	snapshot(): ActivitySnapshot;
}

export function createActivityTracker(args: {
	readonly id: string;
	readonly startedAt: number;
	readonly now?: () => number;
}): ActivityTracker {
	const now = args.now ?? (() => Date.now());
	let lastActivityAt: number | null = null;
	let lastProbeAt: number | null = null;
	return {
		note() {
			lastActivityAt = now();
		},
		noteProbe() {
			lastProbeAt = now();
		},
		snapshot() {
			return {
				id: args.id,
				startedAt: args.startedAt,
				lastActivityAt,
				lastProbeAt,
			};
		},
	};
}

/**
 * Throttled in-place registry sync: the daemon patches its own index entry's
 * `lastActivityAt` at most once per interval, without reordering the index
 * (`patchEntry`, never re-register). Probes never trigger a write.
 */
export interface ActivitySync {
	/** Called on activity; patches when the throttle window has elapsed. */
	note(): Promise<void>;
	/** Unconditional best-effort patch (unused by close today — the entry is
	 * removed there anyway — kept for explicit flush callers). */
	flush(): Promise<void>;
}

export function createRegistryActivitySync(args: {
	readonly registry: TargetRegistry;
	readonly targetId: string;
	readonly snapshot: () => ActivitySnapshot;
	readonly intervalMs?: number;
	readonly now?: () => number;
}): ActivitySync {
	const intervalMs = args.intervalMs ?? ACTIVITY_SYNC_INTERVAL_MS;
	const now = args.now ?? (() => Date.now());
	let lastWrite = Number.NEGATIVE_INFINITY;
	const patch = async (): Promise<void> => {
		const lastActivityAt = args.snapshot().lastActivityAt;
		if (lastActivityAt === null) return;
		await args.registry
			.patchEntry(args.targetId, { lastActivityAt })
			.catch(() => undefined);
	};
	return {
		// The throttle gate reads and stamps `lastWrite` synchronously before
		// the first await, so overlapping note() calls cannot double-write.
		async note() {
			if (now() - lastWrite < intervalMs) return;
			lastWrite = now();
			await patch();
		},
		async flush() {
			lastWrite = now();
			await patch();
		},
	};
}
