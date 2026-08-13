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
