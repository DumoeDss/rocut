/* eslint-disable @typescript-eslint/no-unsafe-type-assertion -- The generic hook deliberately preserves conditional per-action signatures across a stable ref wrapper. */
import { useCallback, useEffect, useRef } from "react";
import type {
	TAction,
	TActionFunc,
	TActionHandlerOptions,
	TArgOfAction,
	TInvocationTrigger,
} from "@/actions";
import { bindAction, unbindAction } from "@/actions";
import { useActionScope } from "@/actions/action-scope";

// eslint-disable-next-line opencut/prefer-object-params -- action subscriptions read best as (action, handler, isActive).
export function useActionHandler<A extends TAction>(
	action: A,
	handler: TActionFunc<A>,
	isActive: TActionHandlerOptions,
) {
	const scope = useActionScope();
	const handlerRef = useRef<TActionFunc<A>>(handler);
	const isBoundRef = useRef(false);

	useEffect(() => {
		handlerRef.current = handler;
	}, [handler]);

	const stableHandler = useCallback(
		(...parameters: [TArgOfAction<A>, TInvocationTrigger?]) => {
			(
				handlerRef.current as (
					...handlerParameters: [TArgOfAction<A>, TInvocationTrigger?]
				) => void
			)(...parameters);
		},
		[],
	) as TActionFunc<A>;

	useEffect(() => {
		const shouldBind =
			isActive === undefined ||
			(typeof isActive === "boolean" ? isActive : isActive.current);

		if (shouldBind && !isBoundRef.current) {
			bindAction(action, stableHandler, scope);
			isBoundRef.current = true;
		} else if (!shouldBind && isBoundRef.current) {
			unbindAction(action, stableHandler, scope);
			isBoundRef.current = false;
		}

		return () => {
			unbindAction(action, stableHandler, scope);
			isBoundRef.current = false;
		};
	}, [action, stableHandler, isActive, scope]);
}
