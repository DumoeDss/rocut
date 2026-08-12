"use client";

import {
	createContext,
	type PropsWithChildren,
	useContext,
	useEffect,
	useLayoutEffect,
	useMemo,
} from "react";

type MouseDrag = {
	kind: "mouse";
	move: (event: MouseEvent) => void;
	finish: (event: MouseEvent) => void;
	cancel?: () => void;
};

type PointerDrag = {
	kind: "pointer";
	pointerId: number;
	move: (event: PointerEvent) => void;
	finish: (event: PointerEvent) => void;
	cancel?: () => void;
};

type NativeDrag = {
	kind: "native";
	move: (event: DragEvent) => void;
	finish?: (event: DragEvent) => void;
	cancel?: () => void;
};

type DragRegistration = MouseDrag | PointerDrag | NativeDrag;
type ActiveDrag = DragRegistration & { owner: symbol };

interface SurfaceDragCoordinator {
	start: (registration: DragRegistration) => () => void;
	cancel: () => void;
	inspect: () => { active: boolean; listenerCount: number };
}

class SurfaceDragCoordinatorImpl implements SurfaceDragCoordinator {
	private readonly owner = Symbol("surface-drag-owner");
	private active: ActiveDrag | null = null;

	start = (registration: DragRegistration) => {
		this.cancel();
		const active = { ...registration, owner: this.owner } as ActiveDrag;
		this.active = active;
		this.addListeners(active);
		return () => this.clear({ active, notifyCancel: false });
	};

	cancel = () => {
		if (this.active?.owner === this.owner)
			this.clear({ active: this.active, notifyCancel: true });
	};

	/**
	 * Mirrors what `addListeners` actually installs: `mouse` installs two
	 * (move/up), while `pointer` (move/up/cancel) and `native`
	 * (dragover/dragend/drop) each install three. This is the oracle the dual-Host
	 * drag evidence reads through `data-listeners`, so an under-count here would
	 * misreport live ownership; `surface-drag-coordinator.test.ts` pins all three
	 * kinds so the two cannot drift apart silently.
	 */
	inspect = () => ({
		active: this.active?.owner === this.owner,
		listenerCount: this.active ? (this.active.kind === "mouse" ? 2 : 3) : 0,
	});

	private addListeners(active: ActiveDrag) {
		if (active.kind === "mouse") {
			document.addEventListener("mousemove", this.handleMouseMove);
			document.addEventListener("mouseup", this.handleMouseUp);
		} else if (active.kind === "pointer") {
			document.addEventListener("pointermove", this.handlePointerMove);
			document.addEventListener("pointerup", this.handlePointerUp);
			document.addEventListener("pointercancel", this.handlePointerCancel);
		} else {
			document.addEventListener("dragover", this.handleDragOver);
			document.addEventListener("dragend", this.handleDragEnd);
			document.addEventListener("drop", this.handleDragEnd);
		}
	}

	private removeListeners(active: ActiveDrag) {
		if (active.kind === "mouse") {
			document.removeEventListener("mousemove", this.handleMouseMove);
			document.removeEventListener("mouseup", this.handleMouseUp);
		} else if (active.kind === "pointer") {
			document.removeEventListener("pointermove", this.handlePointerMove);
			document.removeEventListener("pointerup", this.handlePointerUp);
			document.removeEventListener("pointercancel", this.handlePointerCancel);
		} else {
			document.removeEventListener("dragover", this.handleDragOver);
			document.removeEventListener("dragend", this.handleDragEnd);
			document.removeEventListener("drop", this.handleDragEnd);
		}
	}

	private clear({
		active,
		notifyCancel,
	}: {
		active: ActiveDrag;
		notifyCancel: boolean;
	}) {
		if (this.active !== active || active.owner !== this.owner) return;
		this.active = null;
		this.removeListeners(active);
		if (notifyCancel) active.cancel?.();
	}

	private handleMouseMove = (event: MouseEvent) => {
		const active = this.active;
		if (active?.owner === this.owner && active.kind === "mouse") {
			active.move(event);
		}
	};

	private handleMouseUp = (event: MouseEvent) => {
		const active = this.active;
		if (active?.owner !== this.owner || active.kind !== "mouse") return;
		this.clear({ active, notifyCancel: false });
		active.finish(event);
	};

	private handlePointerMove = (event: PointerEvent) => {
		const active = this.active;
		if (
			active?.owner === this.owner &&
			active.kind === "pointer" &&
			active.pointerId === event.pointerId
		) {
			active.move(event);
		}
	};

	private handlePointerUp = (event: PointerEvent) => {
		const active = this.active;
		if (
			active?.owner !== this.owner ||
			active.kind !== "pointer" ||
			active.pointerId !== event.pointerId
		) {
			return;
		}
		this.clear({ active, notifyCancel: false });
		active.finish(event);
	};

	private handlePointerCancel = (event: PointerEvent) => {
		const active = this.active;
		if (
			active?.owner !== this.owner ||
			active.kind !== "pointer" ||
			active.pointerId !== event.pointerId
		) {
			return;
		}
		this.clear({ active, notifyCancel: false });
		active.cancel?.();
	};

	private handleDragOver = (event: DragEvent) => {
		const active = this.active;
		if (active?.owner === this.owner && active.kind === "native") {
			active.move(event);
		}
	};

	private handleDragEnd = (event: DragEvent) => {
		const active = this.active;
		if (active?.owner !== this.owner || active.kind !== "native") return;
		this.clear({ active, notifyCancel: false });
		active.finish?.(event);
	};
}

export function createSurfaceDragCoordinator(): SurfaceDragCoordinator {
	return new SurfaceDragCoordinatorImpl();
}

const SurfaceDragContext = createContext<SurfaceDragCoordinator | null>(null);

/**
 * Layout effects destroy synchronously during the commit that removes the tree;
 * passive (`useEffect`) destroys are flushed after paint. That difference is
 * load-bearing: with a passive cleanup, a `mouseup` delivered in the window
 * between the unmount commit and the flush **would** reach the retired
 * registration and fire its `finish`, because the document listeners are still
 * installed while the tree is already gone.
 *
 * This is spec-driven, not failure-driven — no observed run produced that stale
 * delivery. The spec requires listeners to be "synchronously removed on … Surface
 * unmount", and `useEffect` cannot satisfy that for the unmount case as a matter
 * of what the hook is, not of timing luck. Do not "simplify" this back.
 *
 * Aliased for SSR, where React warns that layout effects do nothing. The ternary
 * resolves once at module scope on a value that is constant within an
 * environment, so it is not a conditional hook call.
 */
const useIsomorphicLayoutEffect =
	typeof window === "undefined" ? useEffect : useLayoutEffect;

export function SurfaceDragProvider({ children }: PropsWithChildren) {
	const coordinator = useMemo(() => createSurfaceDragCoordinator(), []);
	useIsomorphicLayoutEffect(() => coordinator.cancel, [coordinator]);
	return (
		<SurfaceDragContext.Provider value={coordinator}>
			{children}
		</SurfaceDragContext.Provider>
	);
}

export function useSurfaceDragCoordinator() {
	const coordinator = useContext(SurfaceDragContext);
	if (!coordinator) {
		throw new Error(
			"Surface drag coordination requires an EditorSurface owner.",
		);
	}
	return coordinator;
}

export function useOptionalSurfaceDragCoordinator() {
	return useContext(SurfaceDragContext);
}
