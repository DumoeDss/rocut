"use client";

import { createContext, useContext } from "react";

import type { SurfaceCommitBinding } from "./types";

const SurfaceCommitContext = createContext<SurfaceCommitBinding | null>(null);

export function SurfaceCommitProvider({
	binding,
	children,
}: {
	binding: SurfaceCommitBinding | null;
	children: React.ReactNode;
}) {
	return (
		<SurfaceCommitContext.Provider value={binding}>
			{children}
		</SurfaceCommitContext.Provider>
	);
}

/** Internal to the Surface tree; T0 and provider-private types stay hidden. */
export function useSurfaceCommitBinding(): SurfaceCommitBinding | null {
	return useContext(SurfaceCommitContext);
}
