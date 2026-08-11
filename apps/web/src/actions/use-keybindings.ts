import { useEffect, type RefObject } from "react";
import { useActionInvoker } from "@/actions/action-scope";
import { useEditorInstance } from "@/editor/use-editor";
import { useKeybindingsStore } from "@/editor/use-session-store";
import { isTypableDOMElement } from "@/utils/browser";
import {
	installScopedKeydownListener,
	resolveKeybindingEventTarget,
} from "./keybinding-target";

/**
 * a composable that hooks to the caller component's
 * lifecycle and hooks to the keyboard events to fire
 * the appropriate actions based on keybindings
 */
export interface KeybindingsListenerOptions {
	/** An explicit Surface ref never falls back to document while it is null. */
	readonly targetRef?: RefObject<HTMLElement | null>;
	readonly enabled?: boolean;
}

export function useKeybindingsListener({
	targetRef,
	enabled = true,
}: KeybindingsListenerOptions = {}) {
	const invokeAction = useActionInvoker();
	const editor = useEditorInstance();
	const {
		keybindings,
		getKeybindingString,
		overlayDepth,
		isLoadingProject,
		isRecording,
	} = useKeybindingsStore();

	useEffect(() => {
		if (!enabled) return;
		const target = resolveKeybindingEventTarget({
			targetRef,
			fallbackDocument: document,
		});
		if (!target) return;
		const handleKeyDown = (ev: KeyboardEvent) => {
			const normalizedKey = (ev.key ?? "").toLowerCase();

			if (overlayDepth > 0 || isLoadingProject || isRecording) {
				return;
			}

			const binding = getKeybindingString(ev);
			const activeElement =
				target instanceof HTMLElement
					? target.ownerDocument.activeElement
					: target.activeElement;
			const isTextInput =
				activeElement instanceof HTMLElement &&
				isTypableDOMElement({ element: activeElement });
			const boundAction = binding ? keybindings.get(binding) : undefined;

			if (normalizedKey === "escape" && isTextInput) {
				activeElement.blur();
				return;
			}

			if (!binding) return;
			if (!boundAction) return;

			if (isTextInput) return;
			if (boundAction === "paste-copied") {
				if (!editor.clipboard.hasEntry()) return;
				ev.preventDefault();
				invokeAction("paste-copied", undefined, "keypress");
				return;
			}

			ev.preventDefault();

			switch (boundAction) {
				case "seek-forward":
					invokeAction("seek-forward", { seconds: 1 }, "keypress");
					break;
				case "seek-backward":
					invokeAction("seek-backward", { seconds: 1 }, "keypress");
					break;
				case "jump-forward":
					invokeAction("jump-forward", { seconds: 5 }, "keypress");
					break;
				case "jump-backward":
					invokeAction("jump-backward", { seconds: 5 }, "keypress");
					break;
				default:
					invokeAction(boundAction, undefined, "keypress");
			}
		};

		return installScopedKeydownListener({ target, listener: handleKeyDown });
	}, [
		enabled,
		targetRef,
		keybindings,
		getKeybindingString,
		overlayDepth,
		isLoadingProject,
		isRecording,
		editor,
		invokeAction,
	]);
}
