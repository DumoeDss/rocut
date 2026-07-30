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
 * **Returns `EditorHostBase` — the five long-standing members — deliberately not
 * `EditorHost`.** The port roles are optional on `EditorHost` so a host can be
 * wired one role at a time, and surfacing that optionality here would type every
 * component in the editor into `host.store?.` with nothing guarding the branch.
 * Narrowing the return makes the unresolved form **unreachable from context**:
 * the ports are not merely discouraged here, they are not visible.
 *
 * Ports do not arrive through this context at all. They arrive through the
 * session (`createEditorSession` resolves them, or throws naming what is
 * missing), which is where later children wire them. A `useEditorPorts()` hook
 * was written and then removed: nothing calls it, and because it needs the role
 * register at runtime it pulled `editor/ports/**` into the production module
 * graph — costing this change its "zero contract modules in the bundle"
 * evidence to add a hook with no consumer.
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
