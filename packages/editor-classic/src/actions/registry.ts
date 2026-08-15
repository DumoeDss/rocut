import type {
	TAction,
	TActionFunc,
	TActionWithArgs,
	TActionWithOptionalArgs,
	TActionArgsMap,
	TArgOfAction,
	TInvocationTrigger,
} from "./types";

type ActionHandler = (arg: unknown, trigger?: TInvocationTrigger) => void;
type ActionBindings = Partial<Record<TAction, ActionHandler[]>>;

/**
 * An opaque dispatch boundary owned by one editor runtime (a Surface uses its
 * EditorSession as the owner). The scope object, rather than the owner itself,
 * is the registry key so callers cannot accidentally dispatch by a lookalike
 * session identifier.
 */
export interface ActionScope {
	readonly owner: object;
	readonly token: symbol;
}

export function createActionScope({ owner }: { owner: object }): ActionScope {
	return Object.freeze({ owner, token: Symbol("action-scope") });
}

const unscopedActions: ActionBindings = {};
const scopedActions = new WeakMap<ActionScope, ActionBindings>();

// Action handlers are synchronous. Holding the active scope for the duration
// of a handler makes a nested invokeAction inherit its caller's owner without
// widening every handler signature or leaking the scope into action payloads.
let inheritedScope: ActionScope | undefined;

function bindingsForScope({
	scope,
	create,
}: {
	scope: ActionScope | undefined;
	create: boolean;
}): ActionBindings | undefined {
	if (!scope) return unscopedActions;
	const existing = scopedActions.get(scope);
	if (existing || !create) return existing;
	const bindings: ActionBindings = {};
	scopedActions.set(scope, bindings);
	return bindings;
}

// eslint-disable-next-line opencut/prefer-object-params -- action registries read best as (action, handler).
export function bindAction<A extends TAction>(
	action: A,
	handler: TActionFunc<A>,
	scope?: ActionScope,
) {
	const bindings = bindingsForScope({ scope, create: true });
	if (!bindings) return;
	const handlers = bindings[action];
	// The action key retains the generic relationship at the public boundary;
	// storage erases it so heterogeneous actions can share one registry bucket.
	// eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
	const typedHandler = handler as ActionHandler;
	if (handlers) {
		handlers.push(typedHandler);
	} else {
		bindings[action] = [typedHandler];
	}
}

// eslint-disable-next-line opencut/prefer-object-params -- action registries read best as (action, handler).
export function unbindAction<A extends TAction>(
	action: A,
	handler: TActionFunc<A>,
	scope?: ActionScope,
) {
	const bindings = bindingsForScope({ scope, create: false });
	const handlers = bindings?.[action];
	if (!handlers) return;

	// See bindAction: identity comparison needs the same deliberate erasure.
	// eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
	const typedHandler = handler as ActionHandler;
	bindings[action] = handlers.filter((h) => h !== typedHandler);

	if (bindings[action]?.length === 0) {
		delete bindings[action];
	}
}

export type InvokeActionFunc = {
	(
		action: TActionWithOptionalArgs,
		args?: undefined,
		trigger?: TInvocationTrigger,
		scope?: ActionScope,
	): void;
	<A extends TActionWithArgs>(
		action: A,
		args: TActionArgsMap[A],
		trigger?: TInvocationTrigger,
		scope?: ActionScope,
	): void;
};

export function invokeActionInScope({
	action,
	args,
	trigger,
	scope,
}: {
	action: TAction;
	args?: unknown;
	trigger?: TInvocationTrigger;
	scope?: ActionScope;
}): void {
	const dispatchScope = scope ?? inheritedScope;
	const handlers = bindingsForScope({
		scope: dispatchScope,
		create: false,
	})?.[action];
	if (!handlers) return;

	// Snapshot the bucket so handler cleanup during dispatch cannot skip the
	// remaining handlers selected for this invocation.
	for (const handler of [...handlers]) {
		const previousScope = inheritedScope;
		inheritedScope = dispatchScope;
		try {
			handler(args, trigger);
		} finally {
			inheritedScope = previousScope;
		}
	}
}

// eslint-disable-next-line opencut/prefer-object-params -- dispatchers conventionally separate action, payload, and trigger.
export const invokeAction: InvokeActionFunc = <A extends TAction>(
	action: A,
	args?: TArgOfAction<A>,
	trigger?: TInvocationTrigger,
	scope?: ActionScope,
) => {
	invokeActionInScope({ action, args, trigger, scope });
};
