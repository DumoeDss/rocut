"use client";

import { createContext, type PropsWithChildren, useContext, useState } from "react";

const SurfacePortalContext = createContext<HTMLElement | null>(null);

export function SurfacePortalProvider({
	children,
	namespace,
}: PropsWithChildren<{ namespace: string }>) {
	const [owner, setOwner] = useState<HTMLDivElement | null>(null);

	return (
		<SurfacePortalContext.Provider value={owner}>
			<div
				ref={setOwner}
				data-editor-surface={namespace}
				data-editor-surface-portal=""
			/>
			{owner ? children : null}
		</SurfacePortalContext.Provider>
	);
}

export function useSurfacePortalOwner() {
	return useContext(SurfacePortalContext);
}

export function resolveSurfacePortalContainer({
	owner,
	explicit,
}: {
	owner: HTMLElement | null;
	explicit?: Element | DocumentFragment | null;
}) {
	return owner ?? explicit ?? undefined;
}

export function useSurfacePortalContainer(
	explicit?: Element | DocumentFragment | null,
) {
	return resolveSurfacePortalContainer({
		owner: useSurfacePortalOwner(),
		explicit,
	});
}
