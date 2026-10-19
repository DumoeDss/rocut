"use client";

import { createContext, useContext } from "react";
import type { EditorHost, EditorHostBase } from "@opencut/editor-ports/host";
import { getEditorMessages } from "./editor-messages";

const EditorHostContext = createContext<EditorHost | null>(null);
const EditorLocaleContext = createContext<string | undefined>(undefined);

/** Live presentation preference independent of the session's stable Host. */
export function EditorLocaleProvider({
	locale,
	children,
}: {
	locale?: string;
	children: React.ReactNode;
}) {
	return (
		<EditorLocaleContext.Provider value={locale}>
			{children}
		</EditorLocaleContext.Provider>
	);
}

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
				"service endpoints — see packages/editor-ports/src/host/index.ts.",
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

export function useEditorMessages() {
	const locale = useContext(EditorLocaleContext);
	const host = useEditorHost();
	return getEditorMessages(locale ?? host.locale);
}
