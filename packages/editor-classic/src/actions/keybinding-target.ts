import type { RefObject } from "react";

export interface KeydownListenerTarget {
	addEventListener(
		type: "keydown",
		listener: (event: KeyboardEvent) => void,
		options?: AddEventListenerOptions,
	): void;
	removeEventListener(
		type: "keydown",
		listener: (event: KeyboardEvent) => void,
		options?: AddEventListenerOptions,
	): void;
}

export function resolveKeybindingEventTarget({
	targetRef,
	fallbackDocument,
}: {
	targetRef: RefObject<HTMLElement | null> | undefined;
	fallbackDocument: Document;
}): HTMLElement | Document | null {
	return targetRef === undefined ? fallbackDocument : targetRef.current;
}

/** Focused controls own their native keys before editor capture shortcuts run. */
export function isControlNavigation({
	element,
	key,
}: {
	element: Pick<Element, "getAttribute" | "tagName"> | null;
	key: string;
}): boolean {
	if (!element) return false;
	const navigation = ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"];
	if (element.getAttribute("data-panel-resize-handle-id") != null) {
		return navigation.includes(key);
	}
	const role = element.getAttribute("role");
	if (role === "combobox" || role === "listbox" || role === "option") {
		return [...navigation, " ", "Enter"].includes(key);
	}
	if (role === "slider") return navigation.includes(key);
	if (element.tagName === "BUTTON" || element.tagName === "SUMMARY" || role === "button") {
		return key === " " || key === "Enter";
	}
	return false;
}

export function installScopedKeydownListener({
	target,
	listener,
}: {
	target: KeydownListenerTarget;
	listener: (event: KeyboardEvent) => void;
}): () => void {
	const eventOptions: AddEventListenerOptions = { capture: true };
	target.addEventListener("keydown", listener, eventOptions);
	let active = true;
	return () => {
		if (!active) return;
		active = false;
		target.removeEventListener("keydown", listener, eventOptions);
	};
}
