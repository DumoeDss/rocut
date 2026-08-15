export interface IndependentPlatformCounts {
	created: number;
	released: number;
}

export interface IndependentTimerLedger {
	readonly counts: IndependentPlatformCounts;
	snapshot(): IndependentPlatformCounts;
	restore(): void;
}

export interface IndependentTimerScope {
	setTimeout: Window["setTimeout"];
	clearTimeout: Window["clearTimeout"];
	setInterval: Window["setInterval"];
	clearInterval: Window["clearInterval"];
	requestAnimationFrame: Window["requestAnimationFrame"];
	cancelAnimationFrame: Window["cancelAnimationFrame"];
}

/* eslint-disable @typescript-eslint/no-unsafe-type-assertion, @typescript-eslint/no-explicit-any, opencut/prefer-object-params, prefer-const -- the browser ledger intentionally wraps overloaded global timer APIs. */
export function installIndependentTimerLedger({
	scope = window,
}: {
	scope?: IndependentTimerScope;
} = {}): IndependentTimerLedger {
	const counts = { created: 0, released: 0 };
	const activeTimers = new Set<unknown>();
	const activeAnimationFrames = new Set<number>();
	const originalSetTimeout = scope.setTimeout;
	const originalClearTimeout = scope.clearTimeout;
	const originalSetInterval = scope.setInterval;
	const originalClearInterval = scope.clearInterval;
	const originalRequestAnimationFrame = scope.requestAnimationFrame;
	const originalCancelAnimationFrame = scope.cancelAnimationFrame;

	const wrappedSetTimeout = ((
		handler: TimerHandler,
		timeout?: number,
		...args: any[]
	) => {
		counts.created += 1;
		let token: unknown;
		const wrappedHandler = (...callbackArgs: any[]) => {
			if (activeTimers.delete(token)) counts.released += 1;
			if (typeof handler === "function") handler(...callbackArgs);
		};
		token = originalSetTimeout(wrappedHandler, timeout, ...args);
		activeTimers.add(token);
		return token;
	}) as typeof scope.setTimeout;
	const wrappedClearTimeout = ((
		token: Parameters<Window["clearTimeout"]>[0],
	) => {
		if (activeTimers.delete(token)) counts.released += 1;
		return originalClearTimeout(token);
	}) as typeof scope.clearTimeout;
	const wrappedSetInterval = ((
		handler: TimerHandler,
		timeout?: number,
		...args: any[]
	) => {
		counts.created += 1;
		const token = originalSetInterval(handler, timeout, ...args);
		activeTimers.add(token);
		return token;
	}) as typeof scope.setInterval;
	const wrappedClearInterval = ((
		token: Parameters<Window["clearInterval"]>[0],
	) => {
		if (activeTimers.delete(token)) counts.released += 1;
		return originalClearInterval(token);
	}) as typeof scope.clearInterval;

	scope.setTimeout = wrappedSetTimeout;
	scope.clearTimeout = wrappedClearTimeout;
	scope.setInterval = wrappedSetInterval;
	scope.clearInterval = wrappedClearInterval;

	if (typeof originalRequestAnimationFrame === "function") {
		scope.requestAnimationFrame = ((handler: FrameRequestCallback) => {
			counts.created += 1;
			let token: number;
			token = originalRequestAnimationFrame((time) => {
				if (activeAnimationFrames.delete(token)) counts.released += 1;
				handler(time);
			});
			activeAnimationFrames.add(token);
			return token;
		}) as typeof scope.requestAnimationFrame;
		scope.cancelAnimationFrame = ((token: number) => {
			if (activeAnimationFrames.delete(token)) counts.released += 1;
			return originalCancelAnimationFrame(token);
		}) as typeof scope.cancelAnimationFrame;
	}

	return {
		counts,
		snapshot: () => ({ ...counts }),
		restore: () => {
			scope.setTimeout = originalSetTimeout;
			scope.clearTimeout = originalClearTimeout;
			scope.setInterval = originalSetInterval;
			scope.clearInterval = originalClearInterval;
			if (originalRequestAnimationFrame) {
				scope.requestAnimationFrame = originalRequestAnimationFrame;
				scope.cancelAnimationFrame = originalCancelAnimationFrame;
			}
		},
	};
}
/* eslint-enable @typescript-eslint/no-unsafe-type-assertion, @typescript-eslint/no-explicit-any, opencut/prefer-object-params, prefer-const */
