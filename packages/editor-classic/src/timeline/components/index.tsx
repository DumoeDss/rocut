"use client";

import { ScrollArea } from "../../components/ui/scroll-area";
import {
	Delete02Icon,
	TaskAdd02Icon,
	ViewIcon,
	VolumeHighIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import {
	ContextMenu,
	ContextMenuContent,
	ContextMenuItem,
	ContextMenuTrigger,
} from "../../components/ui/context-menu";
import { useTimelineZoom } from "../hooks/use-timeline-zoom";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useContainerSize } from "../../hooks/use-container-size";
import type { MediaTime } from "../../wasm";
import type { ElementDragView, DropTarget } from "..";
import { TimelineTrackContent } from "./timeline-track";
import { TimelineTrackLabel } from "./track-label";
import { MoveOverlayTrackCommand } from "../../commands/timeline/track/move-overlay-track";
import { TimelinePlayhead } from "./timeline-playhead";
import { SelectionBox } from "../../selection/selection-box";
import { useBoxSelect } from "../../selection/hooks/use-box-select";
import { SnapIndicator } from "./snap-indicator";
import type { SnapPoint } from "../snapping";
import type { TimelineTrack } from "..";
import {
	TIMELINE_SCROLLBAR_SIZE_PX,
	TIMELINE_CONTENT_TOP_PADDING_PX,
	TIMELINE_TRACK_GAP_PX,
	TIMELINE_TRACK_LABELS_COLUMN_WIDTH_PX,
	KEYFRAME_LANE_HEIGHT_PX,
} from "./layout";
import { useElementInteraction } from "../hooks/element/use-element-interaction";
import {
	canTrackHaveAudio,
	canTrackBeHidden,
	getTimelineZoomMin,
	getTimelinePaddingPx,
} from "..";
import { timelineTimeToPixels } from "../pixel-utils";
import {
	getTrackHeight,
	getCumulativeHeightBefore,
	getTotalTracksHeight,
} from "./track-layout";
import { SELECTED_TRACK_ROW_CLASS } from "./theme";
import {
	computeTrackExpansionHeight,
	getTrackExpandedRows,
	getPropertyLabel,
	type ExpandedRow,
} from "./expanded-layout";
import { TIMELINE_HORIZONTAL_WHEEL_STEP_PX } from "./interaction";
import { TimelineToolbar } from "./timeline-toolbar";
import { fitTimelineRange } from "../fit-range";
import { TICKS_PER_SECOND } from "../../wasm";
import { useElementSelection } from "../hooks/element/use-element-selection";
import { useTimelineSeek } from "../hooks/use-timeline-seek";
import { useTimelineDragDrop } from "../hooks/use-timeline-drag-drop";
import { TimelineRuler } from "./timeline-ruler";
import { TimelineBookmarksRow, useBookmarkDrag } from "../bookmarks";
import { useEdgeAutoScroll } from "../hooks/use-edge-auto-scroll";
import { useInitialScrollBottom } from "../hooks/use-initial-scroll-bottom";
import { useTimelineResize } from "../hooks/use-timeline-resize";
import { useTimelineStore } from "../../editor/use-session-store";
import { useEditor, useEditorInstance } from "../../editor/use-editor";
import { useScrollPosition } from "../hooks/use-scroll-position";
import { useTimelinePlayhead } from "../hooks/use-timeline-playhead";
import { DragLine } from "./drag-line";
import { useActionInvoker } from "../../actions/action-scope";
import { resolveTimelineElementIntersections } from "./selection-hit-testing";
import { cn } from "../../utils/ui";
import type { TimerHandle } from "../../editor/session/resources";
import { CreatorAnnotationLabels, CreatorAnnotationRows, useCreatorTimelineAnnotations } from "./creator-annotation-rows";

const TRACKS_CONTAINER_MAX_HEIGHT = 800;
const FALLBACK_CONTAINER_WIDTH = 1000;
const TRACKS_CONTAINER_HEIGHT = { min: 0, max: TRACKS_CONTAINER_MAX_HEIGHT };

export function Timeline() {
	const creatorAnnotations = useCreatorTimelineAnnotations();
	const heightScale = useTimelineStore((s) => s.trackHeightScale);
	const snappingEnabled = useTimelineStore((s) => s.snappingEnabled);
	const {
		selectedElements,
		clearElementSelection,
		setElementSelection,
		mergeElementsIntoSelection,
	} = useElementSelection();
	const editor = useEditorInstance();
	const scene = useEditor((currentEditor) =>
		currentEditor.scenes.getActiveSceneOrNull(),
	);
	const timelineDuration = useEditor((currentEditor) =>
		currentEditor.timeline.getTotalDuration(),
	);
	const tracks = useMemo<TimelineTrack[]>(
		() =>
			scene
				? [...scene.tracks.overlay, scene.tracks.main, ...scene.tracks.audio]
				: [],
		[scene],
	);
	const mainTrackId = scene?.tracks.main.id ?? null;
	const seek = (time: MediaTime) => editor.playback.seek({ time });

	const timelineRef = useRef<HTMLDivElement>(null);
	const timelineHeaderRef = useRef<HTMLDivElement>(null);
	const rulerRef = useRef<HTMLDivElement>(null);
	const rulerScrollRef = useRef<HTMLDivElement>(null);
	const tracksContainerRef = useRef<HTMLDivElement>(null);
	const tracksScrollRef = useRef<HTMLDivElement>(null);
	const trackLabelsRef = useRef<HTMLDivElement>(null);
	const playheadRef = useRef<HTMLDivElement>(null);
	const trackLabelsScrollRef = useRef<HTMLDivElement>(null);

	const [currentSnapPoint, setCurrentSnapPoint] = useState<SnapPoint | null>(
		null,
	);
	const { width: tracksContainerWidth } = useContainerSize({
		containerRef: tracksContainerRef,
	});
	const { height: timelineHeaderHeightValue } = useContainerSize({
		containerRef: timelineHeaderRef,
	});
	const { viewportWidth: tracksViewportWidth } = useScrollPosition({
		scrollRef: tracksScrollRef,
	});

	const handleSnapPointChange = useCallback((snapPoint: SnapPoint | null) => {
		setCurrentSnapPoint(snapPoint);
	}, []);

	const containerWidth = tracksContainerWidth || FALLBACK_CONTAINER_WIDTH;
	const minZoomLevel = getTimelineZoomMin({
		duration: timelineDuration,
		containerWidth,
	});

	const savedViewState = useEditor((currentEditor) =>
		currentEditor.project.getTimelineViewState(),
	);
	const initialFit = useRef<{ projectId: string; needed: boolean } | null>(
		null,
	);
	const projectId = editor.project.getActive().metadata.id;
	const hasSavedViewState = !!editor.project.getActive().timelineViewState;
	useEffect(() => {
		if (initialFit.current?.projectId !== projectId)
			initialFit.current = {
				projectId,
				needed: !hasSavedViewState,
			};
	}, [projectId, hasSavedViewState]);

	const { zoomLevel, setZoomLevel, handleWheel, saveScrollPosition } =
		useTimelineZoom({
			containerRef: timelineRef,
			minZoom: minZoomLevel,
			initialZoom: savedViewState?.zoomLevel,
			initialScrollLeft: savedViewState?.scrollLeft,
			initialPlayheadTime: savedViewState?.playheadTime,
			tracksScrollRef,
			rulerScrollRef,
		});
	useEffect(() => {
		if (
			!initialFit.current?.needed ||
			tracksContainerWidth <= 0 ||
			timelineDuration <= 0
		)
			return;
		const fit = fitTimelineRange({
			startSeconds: 0,
			endSeconds: timelineDuration / TICKS_PER_SECOND,
			viewportWidth:
				tracksScrollRef.current?.clientWidth ?? tracksContainerWidth,
			minZoom: minZoomLevel,
		});
		if (!fit) return;
		initialFit.current.needed = false;
		setZoomLevel(fit.zoom);
	}, [
		projectId,
		tracksContainerWidth,
		timelineDuration,
		minZoomLevel,
		setZoomLevel,
	]);
	const { isResizing, handleResizeStart } = useTimelineResize({
		zoomLevel,
		onSnapPointChange: handleSnapPointChange,
	});

	const expandedElementIds = useTimelineStore((s) => s.expandedElementIds);

	const getTrackExpansionHeight = useCallback(
		(trackIndex: number) => {
			const track = tracks[trackIndex];
			if (!track) return 0;
			return computeTrackExpansionHeight({ track, expandedElementIds });
		},
		[tracks, expandedElementIds],
	);

	// Stable refs so the wheel listener never goes stale
	const setZoomLevelRef = useRef(setZoomLevel);
	useEffect(() => {
		setZoomLevelRef.current = setZoomLevel;
	}, [setZoomLevel]);

	const saveScrollPositionRef = useRef(saveScrollPosition);
	useEffect(() => {
		saveScrollPositionRef.current = saveScrollPosition;
	}, [saveScrollPosition]);

	const minZoomLevelRef = useRef(minZoomLevel);
	useEffect(() => {
		minZoomLevelRef.current = minZoomLevel;
	}, [minZoomLevel]);

	// Pushes tracks scroll position to the two overflow:hidden followers
	// (ruler and track labels). Called from the wheel handler (before paint,
	// zero lag) and from onScroll on the tracks area (covers scrollbar drag).
	const syncFollowers = useCallback(() => {
		const tracks = tracksScrollRef.current;
		if (!tracks) return;
		if (rulerScrollRef.current) {
			rulerScrollRef.current.scrollLeft = tracks.scrollLeft;
		}
		if (trackLabelsScrollRef.current) {
			trackLabelsScrollRef.current.scrollTop = tracks.scrollTop;
		}
	}, []);

	// Single non-passive capture listener owns all wheel input. Prevents any
	// native scroll or browser zoom from firing inside the timeline.
	useEffect(() => {
		const container = timelineRef.current;
		if (!container) return;

		let pendingZoomDelta = 0;
		let zoomRafId: TimerHandle | null = null;

		const onWheel = (e: WheelEvent) => {
			const isZoom = e.ctrlKey || e.metaKey;

			if (isZoom) {
				e.preventDefault();
				const normalizedDelta = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
				pendingZoomDelta += normalizedDelta;

				if (zoomRafId === null) {
					zoomRafId = editor.resources.requestAnimationFrame({
						handler: () => {
							const frameRawDelta = pendingZoomDelta;
							const cappedDelta =
								Math.sign(frameRawDelta) *
								Math.min(Math.abs(frameRawDelta), 30);
							const zoomFactor = Math.exp(-cappedDelta / 300);
							setZoomLevelRef.current((prev) => prev * zoomFactor);
							pendingZoomDelta = 0;
							zoomRafId = null;
						},
					});
				}
				return;
			}

			const tracks = tracksScrollRef.current;
			if (!tracks) return;

			const isHorizontal =
				e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY);

			e.preventDefault();

			if (isHorizontal) {
				const raw =
					Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
				const clamped =
					Math.sign(raw) *
					Math.min(Math.abs(raw), TIMELINE_HORIZONTAL_WHEEL_STEP_PX);
				tracks.scrollLeft = Math.max(0, tracks.scrollLeft + clamped);
			} else {
				tracks.scrollTop = Math.max(0, tracks.scrollTop + e.deltaY);
			}

			syncFollowers();
			saveScrollPositionRef.current();
		};

		container.addEventListener("wheel", onWheel, {
			passive: false,
			capture: true,
		});
		return () => {
			container.removeEventListener("wheel", onWheel, { capture: true });
			if (zoomRafId !== null) zoomRafId.cancel();
		};
	}, [editor.resources, syncFollowers]);

	useInitialScrollBottom({
		tracksScrollRef,
		trackLabelsScrollRef,
		onAfterScroll: () => saveScrollPositionRef.current(),
		isReady: tracks.length > 0,
	});

	const { dragView, handleElementMouseDown, handleElementClick } =
		useElementInteraction({
			zoomLevel,
			tracksContainerRef,
			tracksScrollRef,
			snappingEnabled,
			onSnapPointChange: handleSnapPointChange,
		});
	const isElementDragging = dragView.kind === "dragging";

	const {
		dragState: bookmarkDragState,
		handleBookmarkMouseDown,
		lastMouseXRef: bookmarkLastMouseXRef,
	} = useBookmarkDrag({
		zoomLevel,
		scrollRef: tracksScrollRef,
		snappingEnabled,
		onSnapPointChange: handleSnapPointChange,
	});

	const { handleRulerMouseDown: handlePlayheadRulerMouseDown } =
		useTimelinePlayhead({
			zoomLevel,
			rulerRef,
			rulerScrollRef,
			tracksScrollRef,
			playheadRef,
		});

	const { isDragOver, dropTarget, dragProps, placementError } =
		useTimelineDragDrop({
			containerRef: tracksContainerRef,
			tracksScrollRef,
			zoomLevel,
		});

	const {
		selectionBox,
		handleMouseDown: handleSelectionMouseDown,
		isSelecting,
		shouldIgnoreClick,
	} = useBoxSelect({
		containerRef: tracksContainerRef,
		selectedIds: selectedElements,
		anchorId: null,
		getIsAdditiveSelection: (event) =>
			event.shiftKey || event.ctrlKey || event.metaKey,
		resolveIntersections: ({ startPos, currentPos }) => {
			if (!tracksContainerRef.current) {
				return [];
			}

			return resolveTimelineElementIntersections({ heightScale,
				container: tracksContainerRef.current,
				scrollContainer: tracksScrollRef.current,
				tracks,
				zoomLevel,
				startPos,
				currentPos,
			});
		},
		onSelectionChange: ({ intersectedIds, isAdditive }) => {
			if (isAdditive) {
				mergeElementsIntoSelection({ elements: intersectedIds });
			} else {
				setElementSelection({ elements: intersectedIds });
			}
		},
	});

	const contentWidth = timelineTimeToPixels({
		time: timelineDuration,
		zoomLevel,
	});
	const paddingPx = getTimelinePaddingPx({
		containerWidth,
		zoomLevel,
		minZoom: minZoomLevel,
	});
	const dynamicTimelineWidth = Math.max(
		contentWidth + paddingPx,
		containerWidth,
	);
	const hasHorizontalScrollbar =
		dynamicTimelineWidth > (tracksViewportWidth || containerWidth);

	useEdgeAutoScroll({
		isActive: bookmarkDragState.isDragging,
		getMouseClientX: () => bookmarkLastMouseXRef.current,
		rulerScrollRef,
		tracksScrollRef,
		contentWidth: dynamicTimelineWidth,
	});

	useEdgeAutoScroll({
		isActive: isElementDragging,
		getMouseClientX: () =>
			dragView.kind === "dragging" ? dragView.currentMouseX : 0,
		rulerScrollRef,
		tracksScrollRef,
		contentWidth: dynamicTimelineWidth,
	});

	const showSnapIndicator =
		snappingEnabled &&
		currentSnapPoint !== null &&
		(isElementDragging || bookmarkDragState.isDragging || isResizing);

	const {
		handleTracksMouseDown,
		handleTracksClick,
		handleRulerMouseDown,
		handleRulerClick,
	} = useTimelineSeek({
		playheadRef,
		trackLabelsRef,
		rulerScrollRef,
		tracksScrollRef,
		zoomLevel,
		duration: timelineDuration,
		isSelecting,
		clearSelectedElements: clearElementSelection,
		seek,
	});

	const timelineHeaderHeight =
		timelineHeaderHeightValue + TIMELINE_CONTENT_TOP_PADDING_PX;

	return (
		<section
			className={
				"panel bg-background relative flex h-full flex-col overflow-hidden rounded-sm border"
			}
			{...dragProps}
			aria-label="Timeline"
		>
			{placementError && (
				<p role="alert" className="text-destructive px-3 py-2 text-xs">
					{placementError}
				</p>
			)}
			<TimelineToolbar
				zoomLevel={zoomLevel}
				minZoom={minZoomLevel}
				setZoomLevel={({ zoom }) => setZoomLevel(zoom)}
				onFit={(scope) => {
					const scene = editor.scenes.getActiveSceneOrNull();
					if (!scene) return;
					const elements: { startTime: number; duration: number }[] = [];
					for (const track of [
						scene.tracks.main,
						...scene.tracks.overlay,
						...scene.tracks.audio,
					]) {
						for (const element of track.elements) {
							if (
								scope === "project" ||
								editor.selection
									.getSelectedElements()
									.some(
										(reference) =>
											reference.trackId === track.id &&
											reference.elementId === element.id,
									)
							)
								elements.push(element);
						}
					}
					if (elements.length === 0) return;
					const fit = fitTimelineRange({
						startSeconds:
							scope === "project"
								? 0
								: Math.min(...elements.map((element) => element.startTime)) /
									TICKS_PER_SECOND,
						endSeconds:
							Math.max(
								...elements.map(
									(element) => element.startTime + element.duration,
								),
							) / TICKS_PER_SECOND,
						viewportWidth: tracksScrollRef.current?.clientWidth ?? 0,
						minZoom: minZoomLevel,
					});
					if (!fit) return;
					setZoomLevel(fit.zoom);
					editor.resources.requestAnimationFrame({
						handler: () => {
							if (tracksScrollRef.current)
								tracksScrollRef.current.scrollLeft = fit.scrollLeft;
							if (rulerScrollRef.current)
								rulerScrollRef.current.scrollLeft = fit.scrollLeft;
							saveScrollPosition();
						},
					});
				}}
			/>

			<div className="relative flex flex-1 overflow-hidden" ref={timelineRef}>
				<TrackLabelsPanel
					hasCreatorAnnotations={!!creatorAnnotations.annotations}
					trackLabelsRef={trackLabelsRef}
					trackLabelsScrollRef={trackLabelsScrollRef}
					timelineHeaderHeight={timelineHeaderHeight}
					hasHorizontalScrollbar={hasHorizontalScrollbar}
					getTrackExpansionHeight={getTrackExpansionHeight}
				/>

				<div
					className="relative isolate flex flex-1 flex-col overflow-hidden"
					ref={tracksContainerRef}
				>
					<SelectionBox bounds={selectionBox?.bounds ?? null} />
					<DragLine
						dropTarget={dropTarget}
						tracks={tracks}
						isVisible={isDragOver && !dropTarget?.targetElement}
						headerHeight={timelineHeaderHeight}
					/>
					<DragLine
						dropTarget={isElementDragging ? dragView.dropTarget : null}
						tracks={tracks}
						isVisible={isElementDragging}
						headerHeight={timelineHeaderHeight}
					/>

					<div ref={rulerScrollRef} className="shrink-0 overflow-hidden">
						<div
							ref={timelineHeaderRef}
							className="flex flex-col"
							style={{ width: `${dynamicTimelineWidth}px` }}
						>
							<TimelineRuler
								zoomLevel={zoomLevel}
								dynamicTimelineWidth={dynamicTimelineWidth}
								rulerRef={rulerRef}
								tracksScrollRef={rulerScrollRef}
								handleWheel={handleWheel}
								handleTimelineContentClick={handleRulerClick}
								handleRulerTrackingMouseDown={handleRulerMouseDown}
								handleRulerMouseDown={handlePlayheadRulerMouseDown}
							/>
							<TimelineBookmarksRow
								zoomLevel={zoomLevel}
								dynamicTimelineWidth={dynamicTimelineWidth}
								dragState={bookmarkDragState}
								onBookmarkMouseDown={handleBookmarkMouseDown}
								handleWheel={handleWheel}
								handleTimelineContentClick={handleRulerClick}
								handleRulerTrackingMouseDown={handleRulerMouseDown}
								handleRulerMouseDown={handlePlayheadRulerMouseDown}
							/>
							{creatorAnnotations.annotations && <CreatorAnnotationRows
								annotations={creatorAnnotations.annotations} zoomLevel={zoomLevel}
								error={creatorAnnotations.error} onMove={creatorAnnotations.move} />}
						</div>
					</div>

					<ScrollArea
						className="flex-1"
						ref={tracksScrollRef}
						onScroll={() => {
							syncFollowers();
							saveScrollPosition();
						}}
					>
						<div
							className="flex min-h-full flex-col"
							style={{ width: `${dynamicTimelineWidth}px` }}
						>
							{/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions -- spatial gesture surface (tracks container background); direct-target clicks here originate box-select or clear selection. Keyboard control is global timeline shortcuts. */}
							<div
								className="relative shrink-0"
								style={{
									height: `${
										Math.max(
											TRACKS_CONTAINER_HEIGHT.min,
											Math.min(
												TRACKS_CONTAINER_HEIGHT.max,
												getTotalTracksHeight({ heightScale,
													tracks,
													getExtraHeight: getTrackExpansionHeight,
												}),
											),
										) + TIMELINE_CONTENT_TOP_PADDING_PX
									}px`,
								}}
								onMouseDown={(event) => {
									const isDirectTarget = event.target === event.currentTarget;
									if (!isDirectTarget) return;
									event.stopPropagation();
									handleTracksMouseDown(event);
									handleSelectionMouseDown(event);
								}}
								onClick={(event) => {
									const isDirectTarget = event.target === event.currentTarget;
									if (!isDirectTarget) return;
									event.stopPropagation();
									handleTracksClick(event);
								}}
							>
								{tracks.length > 0 && (
									<TimelineTrackRows
										mainTrackId={mainTrackId}
										zoomLevel={zoomLevel}
										dragView={dragView}
										onResizeStart={handleResizeStart}
										onElementMouseDown={handleElementMouseDown}
										onElementClick={handleElementClick}
										onTrackMouseDown={(event) => {
											handleSelectionMouseDown(event);
											handleTracksMouseDown(event);
										}}
										onTrackMouseUp={handleTracksClick}
										shouldIgnoreClick={shouldIgnoreClick}
										isDragOver={isDragOver}
										dropTarget={dropTarget}
									/>
								)}
							</div>
							<TimelineGutter
								onMouseDown={(event) => {
									handleTracksMouseDown(event);
									handleSelectionMouseDown(event);
								}}
								onClick={handleTracksClick}
							/>
						</div>
					</ScrollArea>

					<TimelinePlayhead
						zoomLevel={zoomLevel}
						hasHorizontalScrollbar={hasHorizontalScrollbar}
						rulerRef={rulerRef}
						rulerScrollRef={rulerScrollRef}
						tracksScrollRef={tracksScrollRef}
						timelineRef={timelineRef}
						playheadRef={playheadRef}
						isSnappingToPlayhead={
							showSnapIndicator && currentSnapPoint?.type === "playhead"
						}
					/>
				</div>
				<SnapIndicator
					snapPoint={currentSnapPoint}
					zoomLevel={zoomLevel}
					timelineRef={timelineRef}
					tracksScrollRef={tracksScrollRef}
					isVisible={showSnapIndicator}
				/>
			</div>
		</section>
	);
}

function TrackLabelsPanel({
	hasCreatorAnnotations,
	trackLabelsRef,
	trackLabelsScrollRef,
	timelineHeaderHeight,
	hasHorizontalScrollbar,
	getTrackExpansionHeight,
}: {
	hasCreatorAnnotations: boolean;
	trackLabelsRef: React.RefObject<HTMLDivElement>;
	trackLabelsScrollRef: React.RefObject<HTMLDivElement>;
	timelineHeaderHeight: number;
	hasHorizontalScrollbar: boolean;
	getTrackExpansionHeight: (trackIndex: number) => number;
}) {
	const editor = useEditorInstance();
	const scene = useEditor((e) => e.scenes.getActiveSceneOrNull());
	const tracks = useMemo<TimelineTrack[]>(
		() =>
			scene
				? [...scene.tracks.overlay, scene.tracks.main, ...scene.tracks.audio]
				: [],
		[scene],
	);
	const { selectedElements } = useElementSelection();
	const tracksWithSelection = useMemo(
		() => new Set(selectedElements.map((el) => el.trackId)),
		[selectedElements],
	);

	const heightScale = useTimelineStore((s) => s.trackHeightScale);
	const expandedElementIds = useTimelineStore((s) => s.expandedElementIds);
	const trackExpandedRowsMap = useMemo(
		() =>
			tracks.map((track) =>
				getTrackExpandedRows({ track, expandedElementIds }),
			),
		[tracks, expandedElementIds],
	);

	return (
		<div
			className="flex shrink-0 flex-col border-r"
			style={{ width: `${TIMELINE_TRACK_LABELS_COLUMN_WIDTH_PX}px` }}
		>
			<div
				className="relative shrink-0"
				style={{ height: timelineHeaderHeight || 48 }}
			>{hasCreatorAnnotations && <CreatorAnnotationLabels />}</div>
			<div ref={trackLabelsRef} className="flex-1 overflow-hidden">
				<div ref={trackLabelsScrollRef} className="size-full overflow-hidden">
					{tracks.length > 0 && (
						<div
							className="flex flex-col"
							style={{ gap: `${TIMELINE_TRACK_GAP_PX}px` }}
						>
							{tracks.map((track, index) => {
								const expandedRows = trackExpandedRowsMap[index];
								const baseHeight = getTrackHeight({ type: track.type, heightScale });

								return (
									<div
										key={track.id}
										className={cn(
											"group flex flex-col",
											tracksWithSelection.has(track.id) &&
												SELECTED_TRACK_ROW_CLASS,
										)}
										style={{
											height: `${baseHeight + getTrackExpansionHeight(index)}px`,
										}}
									>
										<TimelineTrackLabel
											track={track}
											onToggleLock={() =>
												editor.timeline.toggleTrackLock({ trackId: track.id })
											}
											order={
												index < (scene?.tracks.overlay.length ?? 0)
													? {
															canMoveUp: index > 0,
															canMoveDown:
																index < (scene?.tracks.overlay.length ?? 0) - 1,
															onMove: (direction) => {
																void editor.command.execute({
																	command: new MoveOverlayTrackCommand({
																		trackId: track.id,
																		direction,
																	}),
																});
															},
														}
													: undefined
											}
											onToggleMute={() =>
												editor.timeline.toggleTrackMute({ trackId: track.id })
											}
											onToggleVisibility={() =>
												editor.timeline.toggleTrackVisibility({
													trackId: track.id,
												})
											}
										/>
										{expandedRows.length > 0 && (
											<PropertyTree rows={expandedRows} />
										)}
									</div>
								);
							})}
						</div>
					)}
				</div>
			</div>
			<div
				className="bg-background shrink-0"
				style={{
					height: hasHorizontalScrollbar ? TIMELINE_SCROLLBAR_SIZE_PX : 0,
				}}
			/>
		</div>
	);
}

function TimelineTrackRows({
	mainTrackId,
	zoomLevel,
	dragView,
	onResizeStart,
	onElementMouseDown,
	onElementClick,
	onTrackMouseDown,
	onTrackMouseUp,
	shouldIgnoreClick,
	isDragOver,
	dropTarget,
}: {
	mainTrackId: string | null;
	zoomLevel: number;
	dragView: ElementDragView;
	onResizeStart: React.ComponentProps<
		typeof TimelineTrackContent
	>["onResizeStart"];
	onElementMouseDown: React.ComponentProps<
		typeof TimelineTrackContent
	>["onElementMouseDown"];
	onElementClick: React.ComponentProps<
		typeof TimelineTrackContent
	>["onElementClick"];
	onTrackMouseDown: (event: React.MouseEvent) => void;
	onTrackMouseUp: (event: React.MouseEvent) => void;
	shouldIgnoreClick: () => boolean;
	isDragOver: boolean;
	dropTarget: DropTarget | null;
}) {
	const invokeAction = useActionInvoker();
	const timeline = useEditor((e) => e.timeline);
	const scene = useEditor((e) => e.scenes.getActiveSceneOrNull());
	const tracks = useMemo<TimelineTrack[]>(
		() =>
			scene
				? [...scene.tracks.overlay, scene.tracks.main, ...scene.tracks.audio]
				: [],
		[scene],
	);
	const { selectedElements } = useElementSelection();
	const tracksWithSelection = useMemo(
		() => new Set(selectedElements.map((el) => el.trackId)),
		[selectedElements],
	);

	const heightScale = useTimelineStore((s) => s.trackHeightScale);
	const expandedElementIds = useTimelineStore((s) => s.expandedElementIds);

	const getTrackExpansionHeight = useCallback(
		(trackIndex: number) => {
			const track = tracks[trackIndex];
			if (!track) return 0;
			return computeTrackExpansionHeight({ track, expandedElementIds });
		},
		[tracks, expandedElementIds],
	);

	const draggingElementIds = useMemo(
		() =>
			dragView.kind === "dragging"
				? dragView.memberTimeOffsets
				: (null as ReadonlyMap<string, MediaTime> | null),
		[dragView],
	);
	const sortedTracks = useMemo(() => {
		if (!draggingElementIds)
			return tracks.map((track, index) => ({ track, index }));
		return [...tracks]
			.map((track, index) => ({ track, index }))
			.sort((a, b) => {
				const aHasDragged = a.track.elements.some((element) =>
					draggingElementIds.has(element.id),
				);
				const bHasDragged = b.track.elements.some((element) =>
					draggingElementIds.has(element.id),
				);
				if (aHasDragged) return 1;
				if (bHasDragged) return -1;
				return 0;
			});
	}, [tracks, draggingElementIds]);

	return (
		<>
			{sortedTracks.map(({ track, index }) => (
				<ContextMenu key={track.id}>
					<ContextMenuTrigger asChild>
						<div
							className={cn(
								"absolute right-0 left-0 transition-colors",
								tracksWithSelection.has(track.id) && SELECTED_TRACK_ROW_CLASS,
							)}
							style={{
								top: `${TIMELINE_CONTENT_TOP_PADDING_PX + getCumulativeHeightBefore({ heightScale, tracks, trackIndex: index, getExtraHeight: getTrackExpansionHeight })}px`,
								height: `${getTrackHeight({ type: track.type, heightScale }) + getTrackExpansionHeight(index)}px`,
							}}
						>
							<TimelineTrackContent
								track={track}
								zoomLevel={zoomLevel}
								dragView={dragView}
								onResizeStart={onResizeStart}
								onElementMouseDown={onElementMouseDown}
								onElementClick={onElementClick}
								onTrackMouseDown={onTrackMouseDown}
								onTrackMouseUp={onTrackMouseUp}
								shouldIgnoreClick={shouldIgnoreClick}
								targetElementId={
									isDragOver
										? (dropTarget?.targetElement?.elementId ?? null)
										: null
								}
							/>
						</div>
					</ContextMenuTrigger>
					<ContextMenuContent className="w-40">
						<ContextMenuItem
							icon={<HugeiconsIcon icon={TaskAdd02Icon} />}
							onClick={(event: React.MouseEvent) => {
								event.stopPropagation();
								invokeAction("paste-copied");
							}}
						>
							Paste elements
						</ContextMenuItem>
						<ContextMenuItem
							icon={<HugeiconsIcon icon={VolumeHighIcon} />}
							onClick={(event: React.MouseEvent) => {
								event.stopPropagation();
								timeline.toggleTrackMute({ trackId: track.id });
							}}
						>
							{canTrackHaveAudio(track) && track.muted
								? "Unmute track"
								: "Mute track"}
						</ContextMenuItem>
						<ContextMenuItem
							icon={<HugeiconsIcon icon={ViewIcon} />}
							onClick={(event: React.MouseEvent) => {
								event.stopPropagation();
								timeline.toggleTrackVisibility({ trackId: track.id });
							}}
						>
							{canTrackBeHidden(track) && track.hidden
								? "Show track"
								: "Hide track"}
						</ContextMenuItem>
						{track.id !== mainTrackId && (
							<ContextMenuItem
								icon={<HugeiconsIcon icon={Delete02Icon} />}
								onClick={(event: React.MouseEvent) => {
									event.stopPropagation();
									timeline.removeTrack({ trackId: track.id });
								}}
								variant="destructive"
							>
								Delete track
							</ContextMenuItem>
						)}
					</ContextMenuContent>
				</ContextMenu>
			))}
		</>
	);
}

function TimelineGutter({
	onMouseDown,
	onClick,
}: {
	onMouseDown: (event: React.MouseEvent) => void;
	onClick: (event: React.MouseEvent) => void;
}) {
	return (
		// eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions -- spatial gesture surface (empty space below tracks); clicks here clear selection. Keyboard control is global timeline shortcuts.
		<div className="flex-1" onMouseDown={onMouseDown} onClick={onClick} />
	);
}

function PropertyTree({ rows }: { rows: ExpandedRow[] }) {
	return (
		<div className="flex flex-col overflow-hidden">
			{rows.map((row) => (
				<div
					key={row.propertyPath}
					className={cn("flex shrink-0 items-center px-3 bg-muted/50")}
					style={{ height: `${KEYFRAME_LANE_HEIGHT_PX}px` }}
				>
					<span className="text-muted-foreground truncate text-xs leading-none">
						{getPropertyLabel(row.propertyPath)}
					</span>
				</div>
			))}
		</div>
	);
}
