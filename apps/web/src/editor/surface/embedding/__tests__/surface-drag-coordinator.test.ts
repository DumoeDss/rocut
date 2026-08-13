import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { createSurfaceDragCoordinator } from "../surface-drag-coordinator";

const originalDocument = globalThis.document;
let events: EventTarget;

function event({
	type,
	fields = {},
}: {
	type: string;
	fields?: Record<string, unknown>;
}) {
	const value = new Event(type);
	Object.assign(value, fields);
	return value;
}

beforeEach(() => {
	events = new EventTarget();
	Object.defineProperty(globalThis, "document", {
		configurable: true,
		value: events,
	});
});

afterEach(() => {
	Object.defineProperty(globalThis, "document", {
		configurable: true,
		value: originalDocument,
	});
});

describe("Surface drag coordinator", () => {
	test("finishes once and synchronously detaches before the callback", () => {
		const coordinator = createSurfaceDragCoordinator();
		const moves: number[] = [];
		let finishes = 0;
		coordinator.start({
			kind: "mouse",
			move: (value) => moves.push(value.clientX),
			finish: () => {
				finishes += 1;
				events.dispatchEvent(event({ type: "mousemove", fields: { clientX: 99 } }));
			},
		});
		expect(coordinator.inspect()).toEqual({ active: true, listenerCount: 2 });
		events.dispatchEvent(event({ type: "mousemove", fields: { clientX: 4 } }));
		events.dispatchEvent(event({ type: "mouseup" }));
		events.dispatchEvent(event({ type: "mouseup" }));
		expect(moves).toEqual([4]);
		expect(finishes).toBe(1);
		expect(coordinator.inspect()).toEqual({ active: false, listenerCount: 0 });
	});

	test("cancel, replacement, and returned cleanup never finish", () => {
		const coordinator = createSurfaceDragCoordinator();
		let firstCancels = 0;
		let secondCancels = 0;
		let finishes = 0;
		coordinator.start({
			kind: "mouse",
			move: () => {},
			finish: () => finishes++,
			cancel: () => firstCancels++,
		});
		const stop = coordinator.start({
			kind: "mouse",
			move: () => {},
			finish: () => finishes++,
			cancel: () => secondCancels++,
		});
		expect(firstCancels).toBe(1);
		stop();
		coordinator.cancel();
		events.dispatchEvent(event({ type: "mouseup" }));
		expect({ firstCancels, secondCancels, finishes }).toEqual({
			firstCancels: 1,
			secondCancels: 0,
			finishes: 0,
		});
	});

	test("provider-style cleanup cancels the active registration exactly once", () => {
		const coordinator = createSurfaceDragCoordinator();
		let cancels = 0;
		coordinator.start({
			kind: "native",
			move: () => {},
			cancel: () => cancels++,
		});
		coordinator.cancel();
		coordinator.cancel();
		expect(cancels).toBe(1);
	});

	test("discriminates pointer identity for move, finish, and cancel", () => {
		const coordinator = createSurfaceDragCoordinator();
		let moves = 0;
		let finishes = 0;
		let cancels = 0;
		coordinator.start({
			kind: "pointer",
			pointerId: 7,
			move: () => moves++,
			finish: () => finishes++,
			cancel: () => cancels++,
		});
		events.dispatchEvent(event({ type: "pointermove", fields: { pointerId: 8 } }));
		events.dispatchEvent(event({ type: "pointerup", fields: { pointerId: 8 } }));
		events.dispatchEvent(
			event({ type: "pointercancel", fields: { pointerId: 8 } }),
		);
		events.dispatchEvent(event({ type: "pointermove", fields: { pointerId: 7 } }));
		events.dispatchEvent(
			event({ type: "pointercancel", fields: { pointerId: 7 } }),
		);
		events.dispatchEvent(event({ type: "pointerup", fields: { pointerId: 7 } }));
		expect({ moves, finishes, cancels }).toEqual({
			moves: 1,
			finishes: 0,
			cancels: 1,
		});
	});

	test("inspect() matches the listeners addListeners really installs", () => {
		// Asserting `inspect()` against hard-coded numbers would only restate the
		// expression under test: if `addListeners` dropped an event, `inspect()`
		// would keep returning the old count and the test would still pass. So count
		// the registrations on the document stub and compare the two.
		const live = new Map<string, number>();
		const target = new EventTarget();
		const realAdd = target.addEventListener.bind(target);
		const realRemove = target.removeEventListener.bind(target);
		const bump = ({ type, delta }: { type: string; delta: number }) => {
			const next = (live.get(type) ?? 0) + delta;
			if (next === 0) live.delete(type);
			else live.set(type, next);
		};
		target.addEventListener = (
			...args: Parameters<EventTarget["addEventListener"]>
		) => {
			bump({ type: args[0], delta: 1 });
			realAdd(...args);
		};
		target.removeEventListener = (
			...args: Parameters<EventTarget["removeEventListener"]>
		) => {
			bump({ type: args[0], delta: -1 });
			realRemove(...args);
		};
		Object.defineProperty(globalThis, "document", {
			configurable: true,
			value: target,
		});

		const registrations = [
			{ kind: "mouse", move: () => {}, finish: () => {} },
			{ kind: "pointer", pointerId: 1, move: () => {}, finish: () => {} },
			{ kind: "native", move: () => {} },
		] as const;

		const observed: Record<string, { real: number; reported: number }> = {};
		for (const registration of registrations) {
			live.clear();
			const coordinator = createSurfaceDragCoordinator();
			coordinator.start(registration);
			const realCount = [...live.values()].reduce((a, b) => a + b, 0);
			observed[registration.kind] = {
				real: realCount,
				reported: coordinator.inspect().listenerCount,
			};
			coordinator.cancel();
			expect(live.size, `${registration.kind} drained every listener`).toBe(0);
			expect(coordinator.inspect()).toEqual({
				active: false,
				listenerCount: 0,
			});
		}

		// mouse: mousemove + mouseup. pointer: + pointercancel.
		// native: dragover + dragend + drop.
		expect(observed).toEqual({
			mouse: { real: 2, reported: 2 },
			pointer: { real: 3, reported: 3 },
			native: { real: 3, reported: 3 },
		});
	});

	test("keeps two Surface owners independent", () => {
		const first = createSurfaceDragCoordinator();
		const second = createSurfaceDragCoordinator();
		let firstMoves = 0;
		let secondMoves = 0;
		first.start({
			kind: "pointer",
			pointerId: 1,
			move: () => firstMoves++,
			finish: () => {},
		});
		second.start({
			kind: "pointer",
			pointerId: 2,
			move: () => secondMoves++,
			finish: () => {},
		});
		events.dispatchEvent(event({ type: "pointermove", fields: { pointerId: 1 } }));
		events.dispatchEvent(event({ type: "pointermove", fields: { pointerId: 2 } }));
		first.cancel();
		events.dispatchEvent(event({ type: "pointermove", fields: { pointerId: 2 } }));
		expect({ firstMoves, secondMoves }).toEqual({
			firstMoves: 1,
			secondMoves: 2,
		});
	});
});
