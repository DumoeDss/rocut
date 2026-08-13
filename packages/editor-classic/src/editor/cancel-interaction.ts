type CancelFn = () => void;

import type { EditorSession } from "./session/session-types";

const cancellersBySession = new WeakMap<EditorSession, Set<CancelFn>>();

function cancellersFor(session: EditorSession): Set<CancelFn> {
	let cancellers = cancellersBySession.get(session);
	if (!cancellers) {
		cancellers = new Set();
		cancellersBySession.set(session, cancellers);
	}
	return cancellers;
}

export function registerCanceller({
	session,
	fn,
}: {
	session: EditorSession;
	fn: CancelFn;
}): () => void {
	const cancellers = cancellersFor(session);
	cancellers.add(fn);

	return () => {
		cancellers.delete(fn);
	};
}

export function cancelInteraction({
	session,
}: {
	session: EditorSession;
}): boolean {
	const cancellers = cancellersBySession.get(session);
	if (!cancellers) return false;
	if (cancellers.size === 0) return false;

	const activeCancellers = Array.from(cancellers);
	cancellers.clear();

	for (const cancel of activeCancellers) {
		cancel();
	}

	return true;
}

export function releaseInteractionCancellers(session: EditorSession): void {
	const cancellers = cancellersBySession.get(session);
	if (!cancellers) return;
	cancellers.clear();
	cancellersBySession.delete(session);
}
