import { useCallback, useMemo, useRef, useSyncExternalStore } from "react";
import type { EditorCore } from "@/core";
import { editorForSession } from "@/editor/runtime/session-core-owner";
import { useEditorSession } from "@/editor/session/editor-session-provider";

const SNAPSHOT_UNSET = Symbol("snapshotUnset");

function isShallowEqual({ a, b }: { a: unknown; b: unknown }): boolean {
	if (Object.is(a, b)) return true;
	if (!Array.isArray(a) || !Array.isArray(b)) return false;
	if (a.length !== b.length) return false;
	return a.every((item, i) => Object.is(item, b[i]));
}

export function useEditor<T>(selector: (editor: EditorCore) => T): T;
export function useEditor<T>(selector: (editor: EditorCore) => T): T {
	const session = useEditorSession();
	const editor = useMemo(() => editorForSession(session), [session]);
	const snapshotCacheRef = useRef<T | typeof SNAPSHOT_UNSET>(SNAPSHOT_UNSET);

	const subscribeAll = useCallback(
		(onChange: () => void) => {
			const unsubscribers = [
				editor.playback.subscribe(onChange),
				editor.timeline.subscribe(onChange),
				editor.scenes.subscribe(onChange),
				editor.project.subscribe(onChange),
				editor.media.subscribe(onChange),
				editor.renderer.subscribe(onChange),
				editor.selection.subscribe(onChange),
				editor.clipboard.subscribe(onChange),
				editor.diagnostics.subscribe(onChange),
			];
			return () => {
				unsubscribers.forEach((unsubscribe) => {
					unsubscribe();
				});
			};
		},
		[editor],
	);

	const getSnapshot = useCallback((): T => {
		const next = selector(editor);
		if (
			snapshotCacheRef.current !== SNAPSHOT_UNSET &&
			isShallowEqual({
				a: snapshotCacheRef.current,
				b: next,
			})
		) {
			return snapshotCacheRef.current;
		}

		snapshotCacheRef.current = next;
		return next;
	}, [editor, selector]);

	return useSyncExternalStore(subscribeAll, getSnapshot, getSnapshot);
}

/**
 * Explicit stable-core access for event handlers and construction plumbing.
 * It intentionally has no manager subscription.
 */
export function useEditorInstance(): EditorCore {
	const session = useEditorSession();
	return useMemo(() => editorForSession(session), [session]);
}
