import { EditorCore } from "../../core";
import type { EditorSession } from "../session/session-types";
import { ensureEditorProcessBootstrap } from "./process-bootstrap";

const editorsBySession = new WeakMap<EditorSession, EditorCore>();

/**
 * The sole construction route for a session-owned editor core.
 *
 * This module sits outside the frozen ports/session contract graph: the
 * session lifecycle delegates ownership here without importing editor
 * internals into C1's Host contract.
 */
export function createOwnedSessionEditor({
	session,
}: {
	session: EditorSession;
}): EditorCore {
	ensureEditorProcessBootstrap();
	const editor = EditorCore.createSessionOwned({ session });
	editorsBySession.set(session, editor);
	return editor;
}

/**
 * Resolve the editor owned by one explicit live session.
 *
 * There is deliberately no default/current-session route.
 */
export function editorForSession(session: EditorSession): EditorCore {
	const editor = editorsBySession.get(session);
	if (!editor || session.state === "disposed") {
		throw new Error(
			`No live editor is owned by session ${session.id}. ` +
				"The session is unknown or disposed; create and provide a live session.",
		);
	}
	return editor;
}

export function releaseEditorForSession(session: EditorSession): void {
	editorsBySession.delete(session);
}
