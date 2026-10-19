"use client";

import {
	createContext,
	useContext,
	useMemo,
	useSyncExternalStore,
	type ReactNode,
} from "react";
import type { CreatorWorkspaceBridge } from "./creator-workspace-types";
import { createCreatorWorkspaceStore } from "./creator-workspace-store";

const emptyStore = createCreatorWorkspaceStore(null);
const BridgeContext = createContext({
	bridge: null as CreatorWorkspaceBridge | null,
	store: emptyStore,
});

export function CreatorWorkspaceProvider({
	bridge,
	children,
}: {
	bridge?: CreatorWorkspaceBridge | null;
	children: ReactNode;
}) {
	const value = useMemo(
		() => ({
			bridge: bridge ?? null,
			store: createCreatorWorkspaceStore(bridge ?? null),
		}),
		[bridge],
	);
	return (
		<BridgeContext.Provider value={value}>{children}</BridgeContext.Provider>
	);
}

export function useCreatorWorkspaceBridge() {
	return useContext(BridgeContext).bridge;
}

export function useCreatorWorkspace() {
	const { bridge, store } = useContext(BridgeContext);
	const { snapshot, error } = useSyncExternalStore(
		store.subscribe,
		store.getState,
		store.getState,
	);
	return { bridge, snapshot, setSnapshot: store.setSnapshot, error };
}
