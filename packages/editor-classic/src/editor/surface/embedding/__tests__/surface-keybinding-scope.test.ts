/* eslint-disable @typescript-eslint/no-unsafe-type-assertion, opencut/prefer-object-params */
import { describe, expect, test } from "bun:test";

import {
	installScopedKeydownListener,
	isControlNavigation,
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
	test("resize handles own navigation but not unrelated editor shortcuts", () => {
		const element = { tagName: "DIV", getAttribute: (name: string) => name === "data-panel-resize-handle-id" ? "pane" : null };
		for (const key of ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"]) {
			expect(isControlNavigation({ element, key })).toBe(true);
			expect(isControlNavigation({ element: null, key })).toBe(false);
			expect(isControlNavigation({ element: { tagName: "DIV", getAttribute: () => null }, key })).toBe(false);
		}
		for (const key of ["z", "Delete", " ", "Escape"]) {
			expect(isControlNavigation({ element, key })).toBe(false);
		}
	});
	test("combobox, slider and button keyboard input is not a timeline action", () => {
		const combo = { tagName: "BUTTON", getAttribute: (name: string) => name === "role" ? "combobox" : null };
		const button = { tagName: "BUTTON", getAttribute: () => null };
		const slider = { tagName: "SPAN", getAttribute: (name: string) => name === "role" ? "slider" : null };
		for (const key of [" ", "Enter", "ArrowDown", "Home", "End"]) {
			expect(isControlNavigation({ element: combo, key })).toBe(true);
		}
		expect(isControlNavigation({ element: button, key: " " })).toBe(true);
		expect(isControlNavigation({ element: button, key: "ArrowRight" })).toBe(false);
		expect(isControlNavigation({ element: slider, key: "ArrowRight" })).toBe(true);
		expect(isControlNavigation({ element: combo, key: "z" })).toBe(false);
		for (const role of ["option", "listbox"]) {
			const element = { tagName: "DIV", getAttribute: (name: string) => name === "role" ? role : null };
			for (const key of ["Home", "End", "ArrowDown", " ", "Enter"]) {
				expect(isControlNavigation({ element, key })).toBe(true);
			}
		}
	});

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
