/** Keep scoped shortcuts reachable when a focused timeline/property control unmounts.
 * Never reclaim focus from another surface, a portal control, or a blurred window.
 */
export function installSurfaceFocusRecovery(root: HTMLElement): () => void {
	const document = root.ownerDocument;
	const view = document.defaultView;
	if (!view?.MutationObserver) return () => undefined;
	let focused: Element | null = root.contains(document.activeElement)
		? document.activeElement
		: null;
	const onFocusIn = (event: FocusEvent) => {
		focused = event.target instanceof view.Element ? event.target : null;
	};
	const onFocusOut = (event: FocusEvent) => {
		// Native removal may not fire focusout; an explicit move to another
		// control does. Clear ownership even if it happens in the same DOM batch.
		if (
			event.relatedTarget instanceof view.Node &&
			!root.contains(event.relatedTarget)
		) {
			focused = null;
		} else if (
			event.relatedTarget === null &&
			event.target instanceof view.Element
		) {
			// Chromium emits focusout while a soon-to-be-removed button is still
			// connected. Wait until this DOM commit finishes before treating it as
			// an intentional blur of a surviving control.
			const leaving = event.target;
			queueMicrotask(() => {
				if (focused === leaving && leaving.isConnected) focused = null;
			});
		}
	};
	const observer = new view.MutationObserver(() => {
		if (!focused) return;
		if (focused.isConnected) {
			if (!root.contains(focused)) focused = null;
			return;
		}
		focused = null;
		const active = document.activeElement;
		if (
			root.isConnected &&
			document.hasFocus() &&
			(active === document.body || active === document.documentElement)
		) {
			root.focus({ preventScroll: true });
		}
	});
	root.addEventListener("focusin", onFocusIn);
	root.addEventListener("focusout", onFocusOut);
	observer.observe(root, { childList: true, subtree: true });
	return () => {
		focused = null;
		observer.disconnect();
		root.removeEventListener("focusin", onFocusIn);
		root.removeEventListener("focusout", onFocusOut);
	};
}
