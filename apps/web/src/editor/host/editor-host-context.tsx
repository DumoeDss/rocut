"use client";

import { createContext, useContext } from "react";
import type { EditorHost, EditorHostBase } from "@/editor/host/editor-host";

const EditorHostContext = createContext<EditorHost | null>(null);

export function EditorHostProvider({
	host,
	children,
}: {
	host: EditorHost;
	children: React.ReactNode;
}) {
	return (
		<EditorHostContext.Provider value={host}>
			{children}
		</EditorHostContext.Provider>
	);
}

/**
 * Read the host contract. Consumers sit three levels below the root (page →
 * provider → header), which is why this is a context rather than props.
 *
 * Returns the shell-facing subset deliberately. Runtime ports remain available
 * from the owning session's complete Host, so presentation components do not
 * acquire a second dependency path through React context.
 */
export function useEditorHost(): EditorHostBase {
	const host = useContext(EditorHostContext);
	if (!host) {
		throw new Error(
			"useEditorHost() was called outside an <EditorHostProvider>. The editor " +
				"requires a host to supply its project id, navigation callbacks and " +
				"service endpoints — see apps/web/src/editor/host/editor-host.ts.",
		);
	}
	return host;
}

/** Navigation callbacks only, for components that do not need the rest. */
export function useEditorHostNavigation() {
	return useEditorHost().navigation;
}

/** Configured server endpoints only. */
export function useEditorHostServices() {
	return useEditorHost().services;
}

/** Host-supplied branding only. */
export function useEditorHostBranding() {
	return useEditorHost().branding;
}

/** Host-supplied external links only. */
export function useEditorHostLinks() {
	return useEditorHost().links;
}
