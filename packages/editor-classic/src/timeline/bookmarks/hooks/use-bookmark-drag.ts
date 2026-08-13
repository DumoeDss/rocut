import {
	useState,
	useCallback,
	useEffect,
	useRef,
	type RefObject,
} from "react";
import { useEditor, useEditorInstance } from "../../../editor/use-editor";
import { useShiftKey } from "../../../hooks/use-shift-key";
import { useSurfaceDragCoordinator } from "../../../editor/surface/embedding/surface-drag-coordinator";
import { TIMELINE_DRAG_THRESHOLD_PX } from "../../components/interaction";
import { getMouseTimeFromClientX } from "../../drag-utils";
import {
	buildTimelineSnapPoints,
	getTimelineSnapThresholdInTicks,
	resolveTimelineSnap,
	type SnapPoint,
} from "../../snapping";
import { getBookmarkSnapPoints } from "../snap-source";
import { getElementEdgeSnapPoints } from "../../element-snap-source";
import { getPlayheadSnapPoints } from "../../playhead-snap-source";
import { getAnimationKeyframeSnapPointsForTimeline } from "../../animation-snap-points";
import type { Bookmark } from "../..";
import { roundFrameTime, type MediaTime, ZERO_MEDIA_TIME } from "../../../wasm";

export interface BookmarkDragState {
	isDragging: boolean;
	bookmarkTime: MediaTime | null;
	currentTime: MediaTime;
}

interface PendingBookmarkDrag {
	bookmarkTime: MediaTime;
	startMouseX: number;
	startMouseY: number;
}

interface UseBookmarkDragProps {
	zoomLevel: number;
	scrollRef: RefObject<HTMLElement | null>;
	snappingEnabled: boolean;
	onSnapPointChange?: (snapPoint: SnapPoint | null) => void;
}

export function useBookmarkDrag({
	zoomLevel,
	scrollRef,
	snappingEnabled,
	onSnapPointChange,
}: UseBookmarkDragProps) {
	const editor = useEditorInstance();
	const dragCoordinator = useSurfaceDragCoordinator();
	const isShiftHeldRef = useShiftKey();
	const [tracks, bookmarks, playheadTime, duration] = useEditor(
		(currentEditor) => {
			const activeScene = currentEditor.scenes.getActiveScene();
			return [
				activeScene.tracks,
				activeScene.bookmarks,
				currentEditor.playback.getCurrentTime(),
				currentEditor.timeline.getTotalDuration(),
			] as const;
		},
	);

	const [dragState, setDragState] = useState<BookmarkDragState>({
		isDragging: false,
		bookmarkTime: null,
		currentTime: ZERO_MEDIA_TIME,
	});
	const [isPendingDrag, setIsPendingDrag] = useState(false);
	const pendingDragRef = useRef<PendingBookmarkDrag | null>(null);
	const lastMouseXRef = useRef(0);

	const startDrag = useCallback(
		({
			bookmarkTime,
			initialCurrentTime,
		}: {
			bookmarkTime: MediaTime;
			initialCurrentTime: MediaTime;
		}) => {
			setDragState({
				isDragging: true,
				bookmarkTime,
				currentTime: initialCurrentTime,
			});
		},
		[],
	);

	const endDrag = useCallback(() => {
		setDragState({
			isDragging: false,
			bookmarkTime: null,
			currentTime: ZERO_MEDIA_TIME,
		});
	}, []);

	const getSnapResult = useCallback(
		({
			rawTime,
			excludeBookmarkTime,
		}: {
			rawTime: MediaTime;
			excludeBookmarkTime: MediaTime;
		}): { snappedTime: MediaTime; snapPoint: SnapPoint | null } => {
			const shouldSnap = snappingEnabled && !isShiftHeldRef.current;
			if (!shouldSnap) {
				return { snappedTime: rawTime, snapPoint: null };
			}

			const snapPoints = buildTimelineSnapPoints({
				sources: [
					() => getElementEdgeSnapPoints({ tracks }),
					() => getPlayheadSnapPoints({ playheadTime }),
					() => getBookmarkSnapPoints({ bookmarks, excludeBookmarkTime }),
					() => getAnimationKeyframeSnapPointsForTimeline({ tracks }),
				],
			});
			const result = resolveTimelineSnap({
				targetTime: rawTime,
				snapPoints,
				maxSnapDistance: getTimelineSnapThresholdInTicks({ zoomLevel }),
			});
			return {
				snappedTime: result.snappedTime,
				snapPoint: result.snapPoint,
			};
		},
		[
			snappingEnabled,
			tracks,
			playheadTime,
			bookmarks,
			zoomLevel,
			isShiftHeldRef,
		],
	);

	useEffect(() => {
		if (!dragState.isDragging && !isPendingDrag) return;

		const handleMouseMove = (event: MouseEvent) => {
			lastMouseXRef.current = event.clientX;

			const scrollContainer = scrollRef.current;
			if (!scrollContainer) return;

			if (isPendingDrag && pendingDragRef.current) {
				const { startMouseX, startMouseY, bookmarkTime } =
					pendingDragRef.current;
				const deltaX = Math.abs(event.clientX - startMouseX);
				const deltaY = Math.abs(event.clientY - startMouseY);
				if (
					deltaX <= TIMELINE_DRAG_THRESHOLD_PX &&
					deltaY <= TIMELINE_DRAG_THRESHOLD_PX
				) {
					return;
				}

				const activeProject = editor.project.getActive();
				if (!activeProject) return;
				const mouseTime = getMouseTimeFromClientX({
					clientX: event.clientX,
					containerRect: scrollContainer.getBoundingClientRect(),
					zoomLevel,
					scrollLeft: scrollContainer.scrollLeft,
				});
				const frameSnappedTime = roundFrameTime({
					time: mouseTime > duration ? duration : mouseTime,
					fps: activeProject.settings.fps,
				});
				const { snappedTime: initialTime } = getSnapResult({
					rawTime: frameSnappedTime,
					excludeBookmarkTime: bookmarkTime,
				});
				startDrag({ bookmarkTime, initialCurrentTime: initialTime });
				pendingDragRef.current = null;
				setIsPendingDrag(false);
				return;
			}

			if (!dragState.isDragging || dragState.bookmarkTime === null) return;
			const activeProject = editor.project.getActive();
			if (!activeProject) return;
			const mouseTime = getMouseTimeFromClientX({
				clientX: event.clientX,
				containerRect: scrollContainer.getBoundingClientRect(),
				zoomLevel,
				scrollLeft: scrollContainer.scrollLeft,
			});
			const frameSnappedTime = roundFrameTime({
				time: mouseTime > duration ? duration : mouseTime,
				fps: activeProject.settings.fps,
			});
			const snapResult = getSnapResult({
				rawTime: frameSnappedTime,
				excludeBookmarkTime: dragState.bookmarkTime,
			});
			setDragState((previous) => ({
				...previous,
				currentTime: snapResult.snappedTime,
			}));
			onSnapPointChange?.(snapResult.snapPoint);
		};

		const clear = () => {
			pendingDragRef.current = null;
			setIsPendingDrag(false);
			endDrag();
			onSnapPointChange?.(null);
		};

		return dragCoordinator.start({
			kind: "mouse",
			move: handleMouseMove,
			finish: () => {
				if (dragState.isDragging && dragState.bookmarkTime !== null) {
					editor.scenes.moveBookmark({
						fromTime: dragState.bookmarkTime,
						toTime:
							dragState.currentTime > duration
								? duration
								: dragState.currentTime,
					});
				}
				clear();
			},
			cancel: clear,
		});
	}, [
		dragCoordinator,
		dragState,
		duration,
		editor.project,
		editor.scenes,
		endDrag,
		getSnapResult,
		isPendingDrag,
		onSnapPointChange,
		scrollRef,
		startDrag,
		zoomLevel,
	]);

	const handleBookmarkMouseDown = useCallback(
		({ event, bookmark }: { event: React.MouseEvent; bookmark: Bookmark }) => {
			if (event.button !== 0) return;

			event.preventDefault();
			event.stopPropagation();

			pendingDragRef.current = {
				bookmarkTime: bookmark.time,
				startMouseX: event.clientX,
				startMouseY: event.clientY,
			};
			setIsPendingDrag(true);
		},
		[],
	);

	return {
		dragState,
		handleBookmarkMouseDown,
		lastMouseXRef,
	};
}
