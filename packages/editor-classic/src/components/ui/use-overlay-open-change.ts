"use client";

import { useCallback, useEffect, useId, useRef } from "react";
import { storesForSession } from "../../editor/runtime/session-stores";
import { useOptionalEditorSession } from "../../editor/session/editor-session-provider";

export function useOverlayOpenChange({
	open,
	onOpenChange,
}: {
	open?: boolean;
	onOpenChange?: (open: boolean) => void;
}) {
	const session = useOptionalEditorSession();
	const keybindings = session ? storesForSession(session).keybindings : null;
	const openOverlay = useCallback(
		(overlayId: string) => keybindings?.getState().openOverlay(overlayId),
		[keybindings],
	);
	const closeOverlay = useCallback(
		(overlayId: string) => keybindings?.getState().closeOverlay(overlayId),
		[keybindings],
	);
	const isTrackedRef = useRef(false);
	const isControlled = typeof open === "boolean";
	const overlayId = useId();

	useEffect(() => {
		if (!isControlled) return;

		if (open && !isTrackedRef.current) {
			openOverlay(overlayId);
			isTrackedRef.current = true;
			return;
		}

		if (!open && isTrackedRef.current) {
			closeOverlay(overlayId);
			isTrackedRef.current = false;
		}
	}, [closeOverlay, isControlled, open, openOverlay, overlayId]);

	useEffect(() => {
		return () => {
			if (!isTrackedRef.current) return;
			closeOverlay(overlayId);
			isTrackedRef.current = false;
		};
	}, [closeOverlay, overlayId]);

	return useCallback(
		(nextOpen: boolean) => {
			if (!isControlled) {
				if (nextOpen && !isTrackedRef.current) {
					openOverlay(overlayId);
					isTrackedRef.current = true;
				} else if (!nextOpen && isTrackedRef.current) {
					closeOverlay(overlayId);
					isTrackedRef.current = false;
				}
			}

			onOpenChange?.(nextOpen);
		},
		[closeOverlay, isControlled, onOpenChange, openOverlay, overlayId],
	);
}
