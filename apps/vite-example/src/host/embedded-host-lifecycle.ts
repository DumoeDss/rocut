/** Optional embedding protocol. Carries no project data, URL, or credentials. */
export function bindEmbeddedHostLifecycle(prepare: () => Promise<void>) {
	if (window.parent === window) return () => {};
	let disposed = false;
	let busy = false;
	const send = ({ message, origin = "*" }: { message: object; origin?: string }) => {
		window.parent.postMessage(message, origin === "null" ? "*" : origin);
	};
	const ready = (origin?: string) => send({ message: {
		type: "elftia:tool-host-lifecycle-ready", version: 1,
	}, origin });
	const onMessage = (event: MessageEvent) => {
		// no-referrer embedding has no known parent origin; only the actual
		// parent WindowProxy may request a flush. Replies target its origin.
		if (event.source !== window.parent || event.data?.version !== 1) return;
		if (event.data.type === "elftia:tool-host-lifecycle-discover") {
			ready(event.origin);
			return;
		}
		const { type, requestId } = event.data;
		if (type !== "elftia:tool-host-prepare-close" ||
			typeof requestId !== "string" || requestId.length > 128 || busy) return;
		busy = true;
		void (async () => {
			let ok = false;
			try { await prepare(); ok = true; } catch { /* Keep the pane open. */ }
			finally { busy = false; }
			if (!disposed) send({ message: {
				type: "elftia:tool-host-close-ready", version: 1, requestId, ok,
			}, origin: event.origin });
		})();
	};
	window.addEventListener("message", onMessage);
	ready();
	return () => { disposed = true; window.removeEventListener("message", onMessage); };
}
