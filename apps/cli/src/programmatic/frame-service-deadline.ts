import { isProgrammaticSource } from "@opencut/editor-contracts";

export interface FrameRouteClock {
	now(): number;
	schedule(callback: () => void, delayMs: number): () => void;
}
const clock: FrameRouteClock = {
	now: () => performance.now(),
	schedule(callback, delayMs) {
		const timer = setTimeout(callback, delayMs);
		return () => clearTimeout(timer);
	},
};

function isParticleFrame(input: unknown): boolean {
	if (!input || typeof input !== "object" || Array.isArray(input)) return false;
	const value = input as Record<string, unknown>;
	if (
		!["clipStart", "clipDuration", "trimStart", "timelineTime"].every((key) =>
			Number.isSafeInteger(value[key]),
		) ||
		!isProgrammaticSource(value.source)
	)
		return false;
	const source = value.source;
	return (
		source.runtime === "html-document" &&
		source.build?.engine === "three" &&
		source.build.capabilities?.length === 1 &&
		source.build.capabilities[0] === "particle-surface-v1"
	);
}

/** Body admission is always 15s. The Electron particle budget is a parent
 * cancellation deadline, not a promise that all child phases can use their
 * maximum time. The route still awaits resource cleanup after cancellation. */
export function createProgrammaticFrameDeadline(options: {
	controller: AbortController;
	startedAt?: number;
	clock?: FrameRouteClock;
}) {
	const time = options.clock ?? clock;
	const startedAt = options.startedAt ?? time.now();
	let budgetMs = 15_000;
	let promoted = false;
	let disposed = false;
	let cancelTimer: (() => void) | undefined;
	const cancel = () => {
		cancelTimer?.();
		cancelTimer = undefined;
	};
	const expire = () => {
		cancel();
		if (disposed || options.controller.signal.aborted) return;
		const remaining = startedAt + budgetMs - time.now();
		if (remaining <= 0) options.controller.abort();
		else cancelTimer = time.schedule(expire, remaining);
	};
	options.controller.signal.addEventListener("abort", cancel, { once: true });
	expire();
	return {
		acceptParsed(input: unknown, electronConnection: boolean): void {
			if (disposed || options.controller.signal.aborted) return;
			// Parsing may occupy the event loop after the read deadline, before
			// its timer callback gets a chance to run. It must not revive a frame.
			if (time.now() >= startedAt + budgetMs) {
				expire();
				return;
			}
			if (!promoted && electronConnection && isParticleFrame(input)) {
				promoted = true;
				budgetMs = 45_000;
				expire();
			}
		},
		dispose(): void {
			disposed = true;
			cancel();
			options.controller.signal.removeEventListener("abort", cancel);
		},
	};
}
