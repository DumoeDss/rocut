"use client";

import { createContext, useContext } from "react";

import type { EditorSession } from "./session-types";

const EditorSessionContext = createContext<EditorSession | null>(null);

export function EditorSessionProvider({
	session,
	children,
}: {
	session: EditorSession;
	children?: React.ReactNode;
}) {
	return (
		<EditorSessionContext.Provider value={session}>
			{children}
		</EditorSessionContext.Provider>
	);
}

export function useEditorSession(): EditorSession {
	const session = useOptionalEditorSession();
	if (!session) {
		throw new Error(
			"useEditorSession() was called outside an <EditorSessionProvider>. " +
				"Each editor tree must be rooted in one explicit live session.",
		);
	}
	return session;
}

/** Generic UI primitives may exist outside an editor tree and simply skip editor tracking. */
export function useOptionalEditorSession(): EditorSession | null {
	return useContext(EditorSessionContext);
}
