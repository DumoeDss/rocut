import type { FocusMode } from "./types";
import { installSurfaceFocusRecovery } from "./surface-focus-recovery";

export const FOCUS_MODE_MATRIX = {
	passive: {
		tabIndex: -1,
		keyboard: false,
		wheel: false,
		cycleTab: false,
	},
	focused: {
		tabIndex: 0,
		keyboard: true,
		wheel: true,
		cycleTab: false,
	},
	full: {
		tabIndex: 0,
		keyboard: true,
		wheel: true,
		cycleTab: true,
	},
} as const satisfies Readonly<
	Record<
		FocusMode,
		{
			readonly tabIndex: -1 | 0;
			readonly keyboard: boolean;
			readonly wheel: boolean;
			readonly cycleTab: boolean;
		}
	>
>;

const TAB_STOP_SELECTOR = [
	"a[href]",
	"area[href]",
	"button",
	"summary",
	"input",
	"select",
	"textarea",
	"iframe",
	"object",
	"embed",
	'[contenteditable]:not([contenteditable="false"])',
	"[tabindex]",
].join(",");

function hasHiddenOrInertAncestor(element: HTMLElement): boolean {
	return element.closest('[hidden], [inert], [aria-hidden="true"]') !== null;
}

function hasVisibleBox(element: HTMLElement): boolean {
	if (element.getClientRects().length === 0) return false;
	const view = element.ownerDocument?.defaultView;
	if (!view) return true;
	const style = view.getComputedStyle(element);
	return style.display !== "none" && style.visibility !== "hidden";
}

function isEligibleTabStop({
	root,
	element,
}: {
	root: HTMLElement;
	element: HTMLElement;
}): boolean {
	if (!element.isConnected || !root.contains(element)) return false;
	if (
		element.matches(":disabled") ||
		element.getAttribute("aria-disabled") === "true"
	) {
		return false;
	}
	if (hasHiddenOrInertAncestor(element)) return false;
	if (element.tabIndex < 0) return false;
	const declaredTabIndex = element.getAttribute("tabindex");
	if (declaredTabIndex !== null && Number(declaredTabIndex) < 0) return false;
	return hasVisibleBox(element);
}

/** Query on every key press so a live editor never cycles a stale focus list. */
export function getEligibleSurfaceTabStops(root: HTMLElement): HTMLElement[] {
	return [...root.querySelectorAll<HTMLElement>(TAB_STOP_SELECTOR)].filter(
		(element) => isEligibleTabStop({ root, element }),
	);
}

function focusWithoutScroll(element: HTMLElement): void {
	element.focus({ preventScroll: true });
}

function isPrimaryPointer(event: PointerEvent): boolean {
	return event.button === 0 && event.isPrimary !== false;
}

/** Keep native panel scrolling; only contain wheel gestures that would escape. */
function canScrollInside({
	root,
	event,
}: {
	root: HTMLElement;
	event: WheelEvent;
}): boolean {
	if (event.ctrlKey) return false;
	const view = root.ownerDocument.defaultView;
	if (!view) return false;
	let element = event.target instanceof view.Element ? event.target : null;
	const deltaX = event.deltaX || (event.shiftKey ? event.deltaY : 0);
	const deltaY = event.shiftKey ? 0 : event.deltaY;
	while (element && element !== root) {
		const style = view.getComputedStyle(element);
		if (
			/^(auto|scroll)$/.test(style.overflowY) &&
			((deltaY < 0 && element.scrollTop > 0) ||
				(deltaY > 0 &&
					element.scrollTop + element.clientHeight < element.scrollHeight))
		)
			return true;
		if (
			/^(auto|scroll)$/.test(style.overflowX) &&
			((deltaX < 0 && element.scrollLeft > 0) ||
				(deltaX > 0 &&
					element.scrollLeft + element.clientWidth < element.scrollWidth))
		)
			return true;
		element = element.parentElement;
	}
	return false;
}

export function installSurfaceFocusScope({
	root,
	mode,
	onFocusModeChange,
}: {
	root: HTMLElement;
	mode: FocusMode;
	onFocusModeChange?: (mode: FocusMode) => void;
}): () => void {
	const cleanups: Array<() => void> = [];
	if (FOCUS_MODE_MATRIX[mode].keyboard) {
		cleanups.push(installSurfaceFocusRecovery(root));
	}
	const onPointerDown = (event: PointerEvent) => {
		if (mode === "passive") {
			if (isPrimaryPointer(event)) onFocusModeChange?.("focused");
			return;
		}

		if (event.target === root && isPrimaryPointer(event)) {
			focusWithoutScroll(root);
			event.stopPropagation();
		}
	};
	root.addEventListener("pointerdown", onPointerDown);
	cleanups.push(() => root.removeEventListener("pointerdown", onPointerDown));

	if (FOCUS_MODE_MATRIX[mode].wheel) {
		const wheelOptions: AddEventListenerOptions = { passive: false };
		const onWheel = (event: WheelEvent) => {
			if (!canScrollInside({ root, event })) event.preventDefault();
			event.stopPropagation();
		};
		root.addEventListener("wheel", onWheel, wheelOptions);
		cleanups.push(() =>
			root.removeEventListener("wheel", onWheel, wheelOptions),
		);
	}

	if (FOCUS_MODE_MATRIX[mode].cycleTab) {
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key !== "Tab") return;
			const tabStops = getEligibleSurfaceTabStops(root);
			if (tabStops.length === 0) {
				event.preventDefault();
				event.stopPropagation();
				focusWithoutScroll(root);
				return;
			}

			const active = root.ownerDocument.activeElement;
			const first = tabStops[0]!;
			const last = tabStops[tabStops.length - 1]!;
			const next =
				active === root
					? event.shiftKey
						? last
						: first
					: event.shiftKey && active === first
						? last
						: !event.shiftKey && active === last
							? first
							: null;
			if (!next) return;
			event.preventDefault();
			event.stopPropagation();
			focusWithoutScroll(next);
		};
		root.addEventListener("keydown", onKeyDown);
		cleanups.push(() => root.removeEventListener("keydown", onKeyDown));
	}

	let active = true;
	return () => {
		if (!active) return;
		active = false;
		for (const cleanup of cleanups) cleanup();
	};
}
