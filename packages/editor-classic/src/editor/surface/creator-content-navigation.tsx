"use client";

import { createContext, useContext, type ReactNode } from "react";

export type CreatorContentView = {
	type: "document" | "asset" | "generate" | "unavailable";
	id: string;
	versionId?: string;
	sha256?: string;
};

type CreatorContentNavigation = {
	view: CreatorContentView | null;
	activate: (view: CreatorContentView) => void;
	busy: boolean;
};

const CreatorContentNavigationContext =
	createContext<CreatorContentNavigation | null>(null);

export function CreatorContentNavigationProvider({
	value,
	children,
}: {
	value: CreatorContentNavigation;
	children: ReactNode;
}) {
	return (
		<CreatorContentNavigationContext.Provider value={value}>
			{children}
		</CreatorContentNavigationContext.Provider>
	);
}

export function useCreatorContentNavigation() {
	const value = useContext(CreatorContentNavigationContext);
	if (!value)
		throw new Error(
			"Creator content navigation is only available inside a connected Creator workspace.",
		);
	return value;
}
