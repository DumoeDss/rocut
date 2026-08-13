"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import useDeepCompareEffect from "use-deep-compare-effect";
import { useEditor, useEditorInstance } from "../../editor/use-editor";
import { useEditorSession } from "../../editor/session/editor-session-provider";
import { useRafLoop } from "../../hooks/use-raf-loop";
import type { SessionResources, TimerHandle } from "../../editor/session/resources";
import {
	SessionActivityGenerationError,
	type SessionResourceLifecycle,
} from "../../editor/session/session-resources";
import { useContainerSize } from "../../hooks/use-container-size";
import { useFullscreen } from "../../hooks/use-fullscreen";
import { TICKS_PER_SECOND } from "../../wasm";
import type { RootNode } from "../../services/renderer/nodes/root-node";
import { buildScene } from "../../services/renderer/scene-builder";
import { PreviewOverlayLayer } from "./overlay-layer";
import { PreviewInteractionOverlay } from "./preview-interaction-overlay";
import { ContextMenu, ContextMenuTrigger } from "../../components/ui/context-menu";
import type {
	PreviewOverlayControl,
	PreviewOverlayInstance,
} from "../overlays";
import { PreviewContextMenu } from "./context-menu";
import { PreviewToolbar } from "./toolbar";
import {
	PreviewViewportProvider,
	usePreviewViewportState,
} from "./preview-viewport";

type PreviewActivityLifecycle = Pick<
	SessionResourceLifecycle,
	| "assertActivityGeneration"
	| "getActivityGeneration"
	| "isActivityAdmitted"
	| "subscribeActivityLifecycle"
>;

function hasPreviewActivityLifecycle(
	resources: SessionResources,
): resources is SessionResources & PreviewActivityLifecycle {
	return (
		"assertActivityGeneration" in resources &&
		typeof resources.assertActivityGeneration === "function" &&
		"getActivityGeneration" in resources &&
		typeof resources.getActivityGeneration === "function" &&
		"isActivityAdmitted" in resources &&
		typeof resources.isActivityAdmitted === "function" &&
		"subscribeActivityLifecycle" in resources &&
		typeof resources.subscribeActivityLifecycle === "function"
	);
}

function resolvePreviewActivityLifecycle(
	resources: SessionResources,
): PreviewActivityLifecycle {
	if (!hasPreviewActivityLifecycle(resources)) {
		throw new Error("Preview rendering requires session activity lifecycle.");
	}
	return resources;
}

function usePreviewSize() {
	const canvasSize = useEditor(
		(e) => e.project.getActive()?.settings.canvasSize,
	);

	return {
		width: canvasSize?.width,
		height: canvasSize?.height,
	};
}

function normalizeWheelDelta({
	delta,
	deltaMode,
	pageSize,
}: {
	delta: number;
	deltaMode: number;
	pageSize: number;
}): number {
	if (deltaMode === WheelEvent.DOM_DELTA_LINE) {
		return delta * 16;
	}

	if (deltaMode === WheelEvent.DOM_DELTA_PAGE) {
		return delta * pageSize;
	}

	return delta;
}

export function PreviewPanel({
	overlayControls,
	overlayInstances,
	onOverlayVisibilityChange,
}: {
	overlayControls: PreviewOverlayControl[];
	overlayInstances: PreviewOverlayInstance[];
	onOverlayVisibilityChange: (params: {
		overlayId: string;
		isVisible: boolean;
	}) => void;
}) {
	const containerRef = useRef<HTMLDivElement | null>(null);
	const [container, setContainer] = useState<HTMLDivElement | null>(null);
	const { toggleFullscreen } = useFullscreen({ containerRef });
	const handleContainerRef = useCallback((node: HTMLDivElement | null) => {
		containerRef.current = node;
		setContainer(node);
	}, []);

	return (
		<div
			ref={handleContainerRef}
			className="panel bg-background relative flex size-full min-h-0 min-w-0 flex-col rounded-sm border"
		>
			<PreviewCanvas
				container={container}
				onToggleFullscreen={toggleFullscreen}
				overlayControls={overlayControls}
				overlayInstances={overlayInstances}
				onOverlayVisibilityChange={onOverlayVisibilityChange}
			/>
			<RenderTreeController />
		</div>
	);
}

function RenderTreeController() {
	const editor = useEditorInstance();
	const isDegraded = useEditor((e) => e.renderer.isDegraded);
	const tracks = useEditor(
		(e) => e.timeline.getPreviewTracks() ?? e.scenes.getActiveScene().tracks,
	);
	const mediaAssets = useEditor((e) => e.media.getAssets());
	const activeProject = useEditor((e) => e.project.getActive());

	const { width, height } = usePreviewSize();

	useDeepCompareEffect(() => {
		if (isDegraded) {
			editor.renderer.setRenderTree({ renderTree: null });
			return;
		}
		if (!activeProject) return;

		const duration = editor.timeline.getTotalDuration();
		const renderTree = buildScene({
			tracks,
			mediaAssets,
			duration,
			canvasSize: { width, height },
			background: activeProject.settings.background,
			isPreview: true,
			assetResolver: editor.renderer.assetResolver,
		});

		editor.renderer.setRenderTree({ renderTree });
	}, [
		tracks,
		mediaAssets,
		activeProject?.settings.background,
		width,
		height,
		isDegraded,
	]);

	return null;
}

function PreviewCanvas({
	container,
	onToggleFullscreen,
	overlayControls,
	overlayInstances,
	onOverlayVisibilityChange,
}: {
	container: HTMLElement | null;
	onToggleFullscreen: () => void;
	overlayControls: PreviewOverlayControl[];
	overlayInstances: PreviewOverlayInstance[];
	onOverlayVisibilityChange: (params: {
		overlayId: string;
		isVisible: boolean;
	}) => void;
}) {
	const canvasMountRef = useRef<HTMLDivElement>(null);
	const viewportRef = useRef<HTMLDivElement>(null);
	const lastFrameRef = useRef(-1);
	const lastSceneRef = useRef<RootNode | null>(null);
	const renderingRef = useRef(false);
	const { width: nativeWidth, height: nativeHeight } = usePreviewSize();
	const viewportSize = useContainerSize({ containerRef: viewportRef });
	const editor = useEditorInstance();
	const session = useEditorSession();
	const activityLifecycle = resolvePreviewActivityLifecycle(session.resources);
	const [activityGeneration, setActivityGeneration] = useState(() =>
		activityLifecycle.getActivityGeneration(),
	);
	const activeProject = useEditor((e) => e.project.getActive());
	const renderTree = useEditor((e) => e.renderer.getRenderTree());
	const rendererManager = useEditor((e) => e.renderer);
	const isDegraded = useEditor((e) => e.renderer.isDegraded);
	const viewport = usePreviewViewportState({
		canvasHeight: nativeHeight,
		canvasWidth: nativeWidth,
		viewportHeight: viewportSize.height,
		viewportRef,
		viewportWidth: viewportSize.width,
	});
	const { canPan, panByScreenDelta, scaleZoom } = viewport;

	useEffect(
		() =>
			activityLifecycle.subscribeActivityLifecycle({
				onResume: ({ generation }) => {
					setActivityGeneration(generation);
				},
			}),
		[activityLifecycle],
	);

	const renderer = useMemo(() => {
		if (isDegraded) return null;
		return rendererManager.createCanvasRenderer({
			width: nativeWidth,
			height: nativeHeight,
			fps: activeProject.settings.fps,
		});
	}, [
		rendererManager,
		nativeWidth,
		nativeHeight,
		activeProject.settings.fps,
		isDegraded,
	]);

	// Mount the compositor's output canvas directly into the preview. wgpu
	// renders straight into this element, so there is no intermediate copy —
	// the container div owns positioning/styling, the canvas itself fills it.
	useEffect(() => {
		const mount = canvasMountRef.current;
		if (!mount || !renderer) return;
		let outputCanvas: HTMLCanvasElement | null = null;
		let cancelled = false;
		void renderer
			.getOutputCanvas()
			.then((canvas) => {
				if (cancelled) return;
				try {
					activityLifecycle.assertActivityGeneration({
						generation: activityGeneration,
					});
				} catch (error) {
					if (error instanceof SessionActivityGenerationError) return;
					throw error;
				}
				outputCanvas = canvas;
				canvas.style.display = "block";
				canvas.style.width = "100%";
				canvas.style.height = "100%";
				mount.appendChild(canvas);
			})
			.catch((error: unknown) => {
				if (!cancelled && !(error instanceof SessionActivityGenerationError)) {
					console.error("Failed to mount preview canvas:", error);
				}
			});
		return () => {
			cancelled = true;
			if (outputCanvas?.parentElement === mount) {
				mount.removeChild(outputCanvas);
			}
		};
	}, [activityGeneration, activityLifecycle, renderer]);

	const render = useCallback(() => {
		if (isDegraded || !renderer || !renderTree || renderingRef.current) return;

		const renderTime = Math.min(
			editor.playback.getCurrentTime(),
			editor.timeline.getLastFrameTime(),
		);
		const ticksPerFrame = Math.round(
			(TICKS_PER_SECOND * renderer.fps.denominator) / renderer.fps.numerator,
		);
		const frame = Math.floor(renderTime / ticksPerFrame);

		if (frame === lastFrameRef.current && renderTree === lastSceneRef.current) {
			return;
		}

		renderingRef.current = true;
		lastSceneRef.current = renderTree;
		lastFrameRef.current = frame;
		void renderer
			.render({ node: renderTree, time: renderTime })
			.catch((error: unknown) => {
				if (!(error instanceof SessionActivityGenerationError)) {
					console.error("Failed to render preview frame:", error);
				}
			})
			.finally(() => {
				renderingRef.current = false;
			});
	}, [isDegraded, renderer, renderTree, editor.playback, editor.timeline]);

	useRafLoop({ callback: render, resources: editor.resources });

	useEffect(() => {
		const container = viewportRef.current;
		if (!container) return;

		let pendingZoomDelta = 0;
		let pendingPanDeltaX = 0;
		let pendingPanDeltaY = 0;
		let zoomRafId: TimerHandle | null = null;
		let panRafId: TimerHandle | null = null;
		let eventGeneration = activityLifecycle.getActivityGeneration();
		let listening = false;

		const cancelPendingFrames = () => {
			zoomRafId?.cancel();
			panRafId?.cancel();
			zoomRafId = null;
			panRafId = null;
			pendingZoomDelta = 0;
			pendingPanDeltaX = 0;
			pendingPanDeltaY = 0;
		};

		const onWheel = (event: WheelEvent) => {
			try {
				activityLifecycle.assertActivityGeneration({
					generation: eventGeneration,
				});
			} catch (error) {
				if (error instanceof SessionActivityGenerationError) return;
				throw error;
			}
			const normalizedDeltaX = normalizeWheelDelta({
				delta: event.deltaX,
				deltaMode: event.deltaMode,
				pageSize: container.clientWidth,
			});
			const normalizedDeltaY = normalizeWheelDelta({
				delta: event.deltaY,
				deltaMode: event.deltaMode,
				pageSize: container.clientHeight,
			});
			const isZoomGesture = event.ctrlKey || event.metaKey;
			if (isZoomGesture) {
				event.preventDefault();
				pendingZoomDelta += normalizedDeltaY;

				if (zoomRafId === null) {
					zoomRafId = editor.resources.requestAnimationFrame({
						handler: () => {
							const cappedDelta =
								Math.sign(pendingZoomDelta) *
								Math.min(Math.abs(pendingZoomDelta), 30);
							const zoomFactor = Math.exp(-cappedDelta / 300);

							scaleZoom({ factor: zoomFactor });
							pendingZoomDelta = 0;
							zoomRafId = null;
						},
					});
				}

				return;
			}

			if (!canPan) {
				return;
			}

			if (normalizedDeltaX === 0 && normalizedDeltaY === 0) {
				return;
			}

			event.preventDefault();
			pendingPanDeltaX += normalizedDeltaX;
			pendingPanDeltaY += normalizedDeltaY;

			if (panRafId === null) {
				panRafId = editor.resources.requestAnimationFrame({
					handler: () => {
						panByScreenDelta({
							deltaX: pendingPanDeltaX,
							deltaY: pendingPanDeltaY,
						});
						pendingPanDeltaX = 0;
						pendingPanDeltaY = 0;
						panRafId = null;
					},
				});
			}
		};

		const attach = () => {
			if (listening || !activityLifecycle.isActivityAdmitted()) return;
			container.addEventListener("wheel", onWheel, {
				capture: true,
				passive: false,
			});
			listening = true;
		};
		const detach = () => {
			if (!listening) return;
			container.removeEventListener("wheel", onWheel, { capture: true });
			listening = false;
		};
		const unsubscribe = activityLifecycle.subscribeActivityLifecycle({
			onSuspend: () => {
				detach();
				cancelPendingFrames();
			},
			onResume: ({ generation }) => {
				eventGeneration = generation;
				attach();
			},
		});
		attach();

		return () => {
			unsubscribe();
			detach();
			cancelPendingFrames();
		};
	}, [
		activityLifecycle,
		canPan,
		editor.resources,
		panByScreenDelta,
		scaleZoom,
	]);

	return (
		<PreviewViewportProvider value={viewport}>
			<div className="flex size-full min-h-0 min-w-0 flex-col">
				<div className="flex min-h-0 min-w-0 flex-1 p-2 pb-0">
					<ContextMenu>
						<ContextMenuTrigger asChild>
							<div
								ref={viewportRef}
								className="relative flex size-full min-h-0 min-w-0 items-center justify-center overflow-hidden"
							>
								<div
									ref={canvasMountRef}
									className="absolute block border"
									style={{
										left: viewport.sceneLeft,
										top: viewport.sceneTop,
										width: viewport.sceneWidth,
										height: viewport.sceneHeight,
										background:
											activeProject.settings.background.type === "blur"
												? "transparent"
												: activeProject?.settings.background.color,
									}}
								>
									{isDegraded ? (
										<div
											role="status"
											className="bg-muted text-muted-foreground flex size-full items-center justify-center px-6 text-center text-sm"
										>
											Preview unavailable: this environment has no rasterizer.
										</div>
									) : null}
								</div>
								<PreviewOverlayLayer
									instances={overlayInstances}
									plane="under-interaction"
								/>
								<PreviewInteractionOverlay />
								<PreviewOverlayLayer
									instances={overlayInstances}
									plane="over-interaction"
								/>
							</div>
						</ContextMenuTrigger>
						<PreviewContextMenu
							onToggleFullscreen={onToggleFullscreen}
							container={container}
							overlayControls={overlayControls}
							onOverlayVisibilityChange={onOverlayVisibilityChange}
						/>
					</ContextMenu>
				</div>
				<PreviewToolbar onToggleFullscreen={onToggleFullscreen} />
			</div>
		</PreviewViewportProvider>
	);
}
