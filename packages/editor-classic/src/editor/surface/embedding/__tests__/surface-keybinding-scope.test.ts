/* eslint-disable @typescript-eslint/no-unsafe-type-assertion, opencut/prefer-object-params */
import { describe, expect, test } from "bun:test";

import {
	installScopedKeydownListener,
	resolveKeybindingEventTarget,
} from "../../../../actions/keybinding-target";

class FakeTarget {
	readonly listeners = new Set<(event: KeyboardEvent) => void>();
	adds = 0;
	removes = 0;
	lastOptions: unknown;

	addEventListener(
		type: string,
		listener: (event: KeyboardEvent) => void,
		options?: unknown,
	): void {
		expect(type).toBe("keydown");
		this.adds += 1;
		this.lastOptions = options;
		this.listeners.add(listener);
	}

	removeEventListener(
		type: string,
		listener: (event: KeyboardEvent) => void,
		options?: unknown,
	): void {
		expect(type).toBe("keydown");
		expect(options).toEqual(this.lastOptions);
		this.removes += 1;
		this.listeners.delete(listener);
	}
}

describe("Surface keybinding target", () => {
	test("uses the narrow legacy fallback only when no explicit ref exists", () => {
		const fallback = new FakeTarget();
		const root = new FakeTarget();
		expect(
			resolveKeybindingEventTarget({
				targetRef: undefined,
				fallbackDocument: fallback as unknown as Document,
			}),
		).toBe(fallback as unknown as Document);
		expect(
			resolveKeybindingEventTarget({
				targetRef: { current: root as unknown as HTMLElement },
				fallbackDocument: fallback as unknown as Document,
			}),
		).toBe(root as unknown as HTMLElement);
		expect(
			resolveKeybindingEventTarget({
				targetRef: { current: null },
				fallbackDocument: fallback as unknown as Document,
			}),
		).toBeNull();
	});

	test("registers and removes one capture listener on the supplied root", () => {
		const root = new FakeTarget();
		const cleanup = installScopedKeydownListener({
			target: root,
			listener: () => {},
		});
		expect(root.adds).toBe(1);
		expect(root.listeners.size).toBe(1);
		expect(root.lastOptions).toEqual({ capture: true });
		cleanup();
		cleanup();
		expect(root.removes).toBe(1);
		expect(root.listeners.size).toBe(0);
	});
});
