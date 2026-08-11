/* eslint-disable @typescript-eslint/no-unsafe-type-assertion, opencut/prefer-object-params */
import { describe, expect, test } from "bun:test";

import {
	FOCUS_MODE_MATRIX,
	getEligibleSurfaceTabStops,
	installSurfaceFocusScope,
} from "../surface-focus";

type Listener = (event: FakeEvent) => void;

class FakeElement {
	readonly attributes = new Map<string, string>();
	isConnected = true;
	disabled = false;
	hiddenByTree = false;
	inertByTree = false;
	visible = true;
	tabIndex = 0;
	focusCount = 0;

	constructor(
		readonly ownerDocument: { activeElement: FakeElement | null },
		readonly name: string,
	) {}

	getAttribute(name: string): string | null {
		return this.attributes.get(name) ?? null;
	}

	matches(selector: string): boolean {
		return selector === ":disabled" && this.disabled;
	}

	closest(selector: string): FakeElement | null {
		if (selector.includes("[hidden]") && this.hiddenByTree) return this;
		if (selector.includes("[inert]") && this.inertByTree) return this;
		return null;
	}

	getClientRects(): Array<Record<string, never>> {
		return this.visible ? [{}] : [];
	}

	focus(): void {
		this.focusCount += 1;
		this.ownerDocument.activeElement = this;
	}
}

class FakeRoot extends FakeElement {
	readonly candidates: FakeElement[] = [];
	readonly listeners = new Map<string, Set<Listener>>();
	readonly registrations: Array<{
		type: string;
		operation: "add" | "remove";
		options: unknown;
	}> = [];

	addEventListener(type: string, listener: Listener, options?: unknown): void {
		const current = this.listeners.get(type) ?? new Set<Listener>();
		current.add(listener);
		this.listeners.set(type, current);
		this.registrations.push({ type, operation: "add", options });
	}

	removeEventListener(
		type: string,
		listener: Listener,
		options?: unknown,
	): void {
		this.listeners.get(type)?.delete(listener);
		this.registrations.push({ type, operation: "remove", options });
	}

	querySelectorAll(): FakeElement[] {
		return [...this.candidates];
	}

	contains(node: unknown): boolean {
		return node === this || this.candidates.includes(node as FakeElement);
	}

	dispatch(type: string, event: FakeEvent): void {
		for (const listener of this.listeners.get(type) ?? []) listener(event);
	}
}

class FakeEvent {
	defaultPrevented = false;
	propagationStopped = false;
	button = 0;
	isPrimary = true;
	key = "";
	shiftKey = false;

	constructor(readonly target: FakeElement) {}

	preventDefault(): void {
		this.defaultPrevented = true;
	}

	stopPropagation(): void {
		this.propagationStopped = true;
	}
}

function asRoot(root: FakeRoot): HTMLElement {
	return root as unknown as HTMLElement;
}

describe("Surface focus scope", () => {
	test("publishes the exact passive/focused/full policy", () => {
		expect(FOCUS_MODE_MATRIX).toEqual({
			passive: { tabIndex: -1, keyboard: false, wheel: false, cycleTab: false },
			focused: { tabIndex: 0, keyboard: true, wheel: true, cycleTab: false },
			full: { tabIndex: 0, keyboard: true, wheel: true, cycleTab: true },
		});
	});

	test("filters dynamic tab stops without caching stale descendants", () => {
		const document = { activeElement: null as FakeElement | null };
		const root = new FakeRoot(document, "root");
		const eligible = new FakeElement(document, "eligible");
		const disabled = new FakeElement(document, "disabled");
		disabled.disabled = true;
		const hidden = new FakeElement(document, "hidden");
		hidden.visible = false;
		const inert = new FakeElement(document, "inert");
		inert.inertByTree = true;
		const disconnected = new FakeElement(document, "disconnected");
		disconnected.isConnected = false;
		const negative = new FakeElement(document, "negative");
		negative.tabIndex = -1;
		negative.attributes.set("tabindex", "-1");
		root.candidates.push(
			eligible,
			disabled,
			hidden,
			inert,
			disconnected,
			negative,
		);

		expect(getEligibleSurfaceTabStops(asRoot(root))).toEqual([
			eligible as unknown as HTMLElement,
		]);
		const dynamic = new FakeElement(document, "dynamic");
		root.candidates.push(dynamic);
		expect(getEligibleSurfaceTabStops(asRoot(root))).toHaveLength(2);
	});

	test("passive pointer is advisory and leaves pointer and wheel unclaimed", () => {
		const document = { activeElement: null as FakeElement | null };
		const root = new FakeRoot(document, "root");
		const requests: string[] = [];
		const cleanup = installSurfaceFocusScope({
			root: asRoot(root),
			mode: "passive",
			onFocusModeChange: (mode) => requests.push(mode),
		});
		const pointer = new FakeEvent(root);
		root.dispatch("pointerdown", pointer);
		const wheel = new FakeEvent(root);
		root.dispatch("wheel", wheel);

		expect(requests).toEqual(["focused"]);
		expect(pointer.defaultPrevented).toBe(false);
		expect(pointer.propagationStopped).toBe(false);
		expect(wheel.defaultPrevented).toBe(false);
		expect(wheel.propagationStopped).toBe(false);
		expect(root.focusCount).toBe(0);
		cleanup();
	});

	test("focused pointer and non-passive wheel stay inside their root", () => {
		const document = { activeElement: null as FakeElement | null };
		const root = new FakeRoot(document, "root");
		const child = new FakeElement(document, "child");
		root.candidates.push(child);
		const cleanup = installSurfaceFocusScope({
			root: asRoot(root),
			mode: "focused",
		});

		const childPointer = new FakeEvent(child);
		root.dispatch("pointerdown", childPointer);
		expect(childPointer.propagationStopped).toBe(true);
		expect(root.focusCount).toBe(0);

		const backgroundPointer = new FakeEvent(root);
		root.dispatch("pointerdown", backgroundPointer);
		expect(backgroundPointer.propagationStopped).toBe(true);
		expect(root.focusCount).toBe(1);

		const wheel = new FakeEvent(child);
		root.dispatch("wheel", wheel);
		expect(wheel.defaultPrevented).toBe(true);
		expect(wheel.propagationStopped).toBe(true);
		expect(root.registrations).toContainEqual({
			type: "wheel",
			operation: "add",
			options: { passive: false },
		});
		cleanup();
	});

	test("full mode cycles current dynamic boundaries and falls back to the root", () => {
		const document = { activeElement: null as FakeElement | null };
		const root = new FakeRoot(document, "root");
		const first = new FakeElement(document, "first");
		const last = new FakeElement(document, "last");
		root.candidates.push(first, last);
		const cleanup = installSurfaceFocusScope({
			root: asRoot(root),
			mode: "full",
		});

		document.activeElement = last;
		const forward = new FakeEvent(last);
		forward.key = "Tab";
		root.dispatch("keydown", forward);
		expect(document.activeElement).toBe(first);
		expect(forward.defaultPrevented).toBe(true);

		const dynamicLast = new FakeElement(document, "dynamic-last");
		root.candidates.push(dynamicLast);
		document.activeElement = first;
		const backward = new FakeEvent(first);
		backward.key = "Tab";
		backward.shiftKey = true;
		root.dispatch("keydown", backward);
		expect(document.activeElement).toBe(dynamicLast);

		root.candidates.length = 0;
		document.activeElement = root;
		const fallback = new FakeEvent(root);
		fallback.key = "Tab";
		root.dispatch("keydown", fallback);
		expect(root.focusCount).toBe(1);
		cleanup();
	});

	test("mode replacement, independent roots, and unmount remove exact listeners", () => {
		const document = { activeElement: null as FakeElement | null };
		const first = new FakeRoot(document, "first");
		const second = new FakeRoot(document, "second");
		const passiveCleanup = installSurfaceFocusScope({
			root: asRoot(first),
			mode: "passive",
		});
		passiveCleanup();
		const focusedCleanup = installSurfaceFocusScope({
			root: asRoot(first),
			mode: "focused",
		});
		const fullCleanup = installSurfaceFocusScope({
			root: asRoot(second),
			mode: "full",
		});

		expect(first.listeners.get("pointerdown")?.size).toBe(1);
		expect(first.listeners.get("wheel")?.size).toBe(1);
		expect(first.listeners.get("keydown")?.size ?? 0).toBe(0);
		expect(second.listeners.get("pointerdown")?.size).toBe(1);
		expect(second.listeners.get("wheel")?.size).toBe(1);
		expect(second.listeners.get("keydown")?.size).toBe(1);

		focusedCleanup();
		expect(first.listeners.get("pointerdown")?.size).toBe(0);
		expect(first.listeners.get("wheel")?.size).toBe(0);
		expect(second.listeners.get("keydown")?.size).toBe(1);
		fullCleanup();
		expect(second.listeners.get("pointerdown")?.size).toBe(0);
		expect(second.listeners.get("wheel")?.size).toBe(0);
		expect(second.listeners.get("keydown")?.size).toBe(0);

		for (const root of [first, second]) {
			const adds = root.registrations.filter(
				(entry) => entry.operation === "add",
			);
			const removes = root.registrations.filter(
				(entry) => entry.operation === "remove",
			);
			expect(removes).toHaveLength(adds.length);
		}
	});
});
