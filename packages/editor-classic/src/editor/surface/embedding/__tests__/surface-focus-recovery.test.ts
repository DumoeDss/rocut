/* eslint-disable @typescript-eslint/no-unsafe-type-assertion -- Minimal deterministic DOM/observer fixture; no global DOM mutation. */
import { describe, expect, test } from "bun:test";
import { installSurfaceFocusRecovery } from "../surface-focus-recovery";

function fixture() {
	class Element {
		isConnected = true;
	}
	let flush = () => {};
	let disconnected = false;
	const listeners = new Map<
		string,
		(event: { target: Element; relatedTarget?: Element | null }) => void
	>();
	const body = new Element();
	const child = new Element();
	let focused = true;
	const document = {
		activeElement: child,
		body,
		documentElement: new Element(),
		hasFocus: () => focused,
		defaultView: {
			Element,
			Node: Element,
			MutationObserver: class {
				constructor(callback: () => void) {
					flush = callback;
				}
				observe() {}
				disconnect() {
					disconnected = true;
				}
			},
		},
	};
	let focusCalls = 0;
	const root = Object.assign(new Element(), {
		ownerDocument: document,
		contains: (node: unknown) =>
			node === root || (node === child && child.isConnected),
		focus: (options: { preventScroll: boolean }) => {
			expect(options).toEqual({ preventScroll: true });
			focusCalls++;
			document.activeElement = root;
		},
		addEventListener: (
			type: string,
			callback: (event: {
				target: Element;
				relatedTarget?: Element | null;
			}) => void,
		) => listeners.set(type, callback),
		removeEventListener: (type: string) => listeners.delete(type),
	});
	const cleanup = installSurfaceFocusRecovery(root as unknown as HTMLElement);
	return {
		document,
		root,
		child,
		body,
		cleanup,
		flush: () => flush(),
		listeners,
		remove: () => {
			child.isConnected = false;
			document.activeElement = body;
		},
		blurWindow: () => {
			focused = false;
		},
		focusCalls: () => focusCalls,
		disconnected: () => disconnected,
	};
}

describe("removed focused surface control recovery", () => {
	test("returns focus to the owning root once without document-wide shortcuts", () => {
		const h = fixture();
		h.remove();
		h.flush();
		h.flush();
		expect(h.focusCalls()).toBe(1);
		expect(h.document.activeElement).toBe(h.root);
	});
	test("does not steal focus from a live outside control or another editor", () => {
		const h = fixture();
		h.remove();
		h.document.activeElement = h.document.documentElement;
		h.listeners.get("focusout")?.({
			target: h.child,
			relatedTarget: h.document.documentElement,
		});
		h.flush();
		expect(h.focusCalls()).toBe(0);
	});
	test("respects an explicit blur even if the old control is removed later", async () => {
		const h = fixture();
		h.listeners.get("focusout")?.({ target: h.child, relatedTarget: null });
		await Promise.resolve();
		h.remove();
		h.flush();
		expect(h.focusCalls()).toBe(0);
	});
	test("handles Chromium focusout before the control is disconnected", async () => {
		const h = fixture();
		h.listeners.get("focusout")?.({ target: h.child, relatedTarget: null });
		h.remove();
		await Promise.resolve();
		h.flush();
		expect(h.focusCalls()).toBe(1);
	});
	test("does not focus a blurred window or disconnected surface", () => {
		const blurred = fixture();
		blurred.blurWindow();
		blurred.remove();
		blurred.flush();
		expect(blurred.focusCalls()).toBe(0);
		const removed = fixture();
		removed.root.isConnected = false;
		removed.remove();
		removed.flush();
		expect(removed.focusCalls()).toBe(0);
	});
	test("cleanup disconnects the observer, listeners and retained element", () => {
		const h = fixture();
		h.cleanup();
		h.remove();
		h.flush();
		expect(h.disconnected()).toBe(true);
		expect(h.listeners.size).toBe(0);
		expect(h.focusCalls()).toBe(0);
	});
});
