"use client";

import { useEffect, useMemo, useRef } from "react";

import { ActionScopeProvider, createActionScope } from "@/actions";
import { EditorProvider } from "@/components/providers/editor-provider";
import { EditorHostProvider } from "@/editor/host/editor-host-context";
import { EditorSessionProvider } from "@/editor/session";
import { EditorRoot } from "@/editor/surface/editor-root";
import { cn } from "@/utils/ui";

import { SurfaceCommitProvider } from "./surface-commit-context";
import { SurfaceDragProvider } from "./surface-drag-coordinator";
import { SurfaceErrorBoundary } from "./surface-error-boundary";
import { SurfaceEvidenceSeams } from "./surface-evidence-seams";
import { FOCUS_MODE_MATRIX, installSurfaceFocusScope } from "./surface-focus";
import { createSurfaceLifecycleController } from "./surface-lifecycle";
import { SurfacePortalProvider } from "./surface-portal";
import type { EditorSurfaceProps, FocusMode } from "./types";

export function EditorSurface({
	session,
	focusMode = "passive",
	onFocusModeChange,
	visibility = "visible",
	cssNamespace = "default",
	commitBinding,
	onReady,
	onError,
	className,
}: EditorSurfaceProps) {
	const rootRef = useRef<HTMLDivElement>(null);
	const onReadyRef = useRef(onReady);
	const onErrorRef = useRef(onError);
	const onFocusModeChangeRef = useRef(onFocusModeChange);
	const lifecycleRef = useRef<ReturnType<
		typeof createSurfaceLifecycleController
	> | null>(null);
	const actionScope = useMemo(
		() => createActionScope({ owner: session }),
		[session],
	);

	useEffect(() => {
		onReadyRef.current = onReady;
		onErrorRef.current = onError;
		onFocusModeChangeRef.current = onFocusModeChange;
	}, [onError, onFocusModeChange, onReady]);

	useEffect(() => {
		const root = rootRef.current;
		if (!root) return;
		const lifecycle = createSurfaceLifecycleController({
			onReady: () => onReadyRef.current?.(),
			onError: (error) => onErrorRef.current?.(error),
		});
		lifecycleRef.current = lifecycle;
		const cleanup = lifecycle.mount({ session, target: root });
		return () => {
			lifecycleRef.current = null;
			cleanup();
		};
	}, [session]);

	useEffect(() => {
		lifecycleRef.current?.setVisibility(visibility);
	}, [session, visibility]);

	useEffect(() => {
		const root = rootRef.current;
		if (!root) return;
		return installSurfaceFocusScope({
			root,
			mode: focusMode,
			onFocusModeChange: (mode: FocusMode) =>
				onFocusModeChangeRef.current?.(mode),
		});
	}, [focusMode]);

	return (
		<div
			ref={rootRef}
			data-editor-surface={cssNamespace}
			role="region"
			aria-label="Video editor"
			tabIndex={FOCUS_MODE_MATRIX[focusMode].tabIndex}
			className={cn("size-full", className)}
		>
			{/*
			 * Provider ORDER IS load-bearing: `SurfaceDragProvider` must stay an
			 * ancestor of `EditorSessionProvider`. Its unmount cleanup cancels any
			 * live drag, and cancel now commits (number-field `onScrubEnd`,
			 * color-picker `onChangeEnd`, playhead view state), so that commit must
			 * dispatch while the session below is still alive. Swapping these two
			 * would route a teardown commit into a disposed session.
			 */}
			<SurfaceErrorBoundary onError={(error) => onErrorRef.current?.(error)}>
				<SurfacePortalProvider namespace={cssNamespace}>
					<SurfaceDragProvider>
						<SurfaceEvidenceSeams namespace={cssNamespace} />
						<ActionScopeProvider scope={actionScope}>
							<EditorHostProvider host={session.host}>
								<EditorSessionProvider session={session}>
									<SurfaceCommitProvider binding={commitBinding ?? null}>
										<EditorProvider
											keybindingScope={{
												targetRef: rootRef,
												enabled: FOCUS_MODE_MATRIX[focusMode].keyboard,
											}}
										>
											<EditorRoot />
										</EditorProvider>
									</SurfaceCommitProvider>
								</EditorSessionProvider>
							</EditorHostProvider>
						</ActionScopeProvider>
					</SurfaceDragProvider>
				</SurfacePortalProvider>
			</SurfaceErrorBoundary>
		</div>
	);
}
