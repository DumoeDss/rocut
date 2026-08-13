"use client";

import { createContext, useCallback, useContext, type ReactNode } from "react";

import {
	invokeActionInScope,
	type ActionScope,
	type InvokeActionFunc,
} from "./registry";
import type { TAction, TInvocationTrigger } from "./types";

const ActionScopeContext = createContext<ActionScope | undefined>(undefined);

export function ActionScopeProvider({
	scope,
	children,
}: {
	readonly scope: ActionScope;
	readonly children: ReactNode;
}) {
	return (
		<ActionScopeContext.Provider value={scope}>
			{children}
		</ActionScopeContext.Provider>
	);
}

export function useActionScope(): ActionScope | undefined {
	return useContext(ActionScopeContext);
}

/**
 * Returns a dispatcher bound to the nearest Surface action owner. Outside a
 * Surface provider it deliberately retains the legacy unscoped behavior.
 */
export function useActionInvoker(): InvokeActionFunc {
	const scope = useActionScope();
	return useCallback(
		(action: TAction, args?: unknown, trigger?: TInvocationTrigger) =>
			invokeActionInScope({ action, args, trigger, scope }),
		[scope],
	);
}
