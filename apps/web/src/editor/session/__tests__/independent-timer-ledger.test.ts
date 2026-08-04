import { describe, expect, test } from "bun:test";

import {
	installIndependentTimerLedger,
	type IndependentTimerScope,
} from "../independent-timer-ledger";

function createCollidingTimerScope() {
	let nextTimerId = 1;
	let nextAnimationFrameId = 1;
	const timers = new Map<
		number,
		{ handler: TimerHandler; args: readonly unknown[] }
	>();
	const animationFrames = new Map<number, FrameRequestCallback>();
	const scope: IndependentTimerScope = {
		// eslint-disable-next-line opencut/prefer-object-params -- the fake preserves the browser timer's positional API.
		setTimeout: (handler, _timeout, ...args) => {
			const id = nextTimerId;
			nextTimerId += 1;
			timers.set(id, { handler, args });
			return id;
		},
		clearTimeout: (id) => {
			timers.delete(Number(id));
		},
		// eslint-disable-next-line opencut/prefer-object-params -- the fake preserves the browser timer's positional API.
		setInterval: (handler, _timeout, ...args) => {
			const id = nextTimerId;
			nextTimerId += 1;
			timers.set(id, { handler, args });
			return id;
		},
		clearInterval: (id) => {
			timers.delete(Number(id));
		},
		requestAnimationFrame: (handler) => {
			const id = nextAnimationFrameId;
			nextAnimationFrameId += 1;
			animationFrames.set(id, handler);
			return id;
		},
		cancelAnimationFrame: (id) => {
			animationFrames.delete(id);
		},
	};

	return {
		scope,
		fireAnimationFrame: (id: number) => {
			const handler = animationFrames.get(id);
			animationFrames.delete(id);
			handler?.(performance.now());
		},
	};
}

describe("independent timer ledger", () => {
	test("counts timer and animation-frame handles independently when numeric IDs collide", () => {
		const fixture = createCollidingTimerScope();
		const ledger = installIndependentTimerLedger({ scope: fixture.scope });

		try {
			const interval = fixture.scope.setInterval(() => {}, 5);
			const timeout = fixture.scope.setTimeout(() => {}, 800);
			const firstFrame = fixture.scope.requestAnimationFrame(() => {});
			const secondFrame = fixture.scope.requestAnimationFrame(() => {});

			expect(interval).toBe(firstFrame);
			expect(timeout).toBe(secondFrame);

			fixture.fireAnimationFrame(firstFrame);
			fixture.fireAnimationFrame(secondFrame);
			fixture.scope.clearInterval(interval);
			fixture.scope.clearTimeout(timeout);

			expect(ledger.snapshot()).toEqual({ created: 4, released: 4 });
		} finally {
			ledger.restore();
		}
	});
});
