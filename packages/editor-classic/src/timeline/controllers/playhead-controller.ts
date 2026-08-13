import type { MouseEvent as ReactMouseEvent } from "react";
import type { FrameRate } from "opencut-wasm";
import {
	mediaTime,
	snapSeekMediaTime,
	TICKS_PER_SECOND,
	type MediaTime,
} from "../../wasm";
import {
	buildTimelineSnapPoints,
	getTimelineSnapThresholdInTicks,
	resolveTimelineSnap,
} from "../snapping";
import { getBookmarkSnapPoints } from "../bookmarks";
import { getElementEdgeSnapPoints } from "../element-snap-source";
import { getAnimationKeyframeSnapPointsForTimeline } from "../animation-snap-points";
import {
	getCenteredLineLeft,
	timelineTimeToPixels,
	timelineTimeToSnappedPixels,
} from "..";
import { BASE_TIMELINE_PIXELS_PER_SECOND } from "../scale";
import type { Bookmark, SceneTracks } from "..";

// --- Session ---

interface ScrubSession {
	kind: "scrubbing";
	/** True when scrub started from a ruler click (not the playhead handle). */
	didStartFromRuler: boolean;
	/** True once the mouse has moved during a ruler drag. */
	hasMoved: boolean;
	/** Most recent frame-snapped time set by scrub(). */
	currentTime: MediaTime | null;
}

type Session = { kind: "idle" } | ScrubSession;

// --- Config ---

export interface PlayheadConfig {
	zoomLevel: number;
	duration: MediaTime;
	getActiveProjectFps: () => FrameRate | null;
	isShiftHeld: () => boolean;
	getIsPlaying: () => boolean;
	getRulerEl: () => HTMLDivElement | null;
	getRulerScrollEl: () => HTMLDivElement | null;
	getTracksScrollEl: () => HTMLDivElement | null;
	getPlayheadEl: () => HTMLDivElement | null;
	getSceneTracks: () => SceneTracks;
	getSceneBookmarks: () => Bookmark[];
	seek: (time: MediaTime) => void;
	setScrubbing: (isScrubbing: boolean) => void;
	setTimelineViewState: (viewState: {
		zoomLevel: number;
		scrollLeft: number;
		playheadTime: MediaTime;
	}) => void;
	/**
	 * Registers the scrub's document-level continuation with the Surface-owned
	 * private drag coordinator and returns its detach handle. Scrubbing beyond the
	 * Surface bounds is one of the continuations the R2 owner protocol governs, so
	 * this controller must not attach `window`/`document` listeners itself.
	 */
	startMouseDrag: (registration: {
		move: (event: MouseEvent) => void;
		finish: (event: MouseEvent) => void;
		cancel: () => void;
	}) => () => void;
}

export interface PlayheadConfigRef {
	readonly current: PlayheadConfig;
}

// --- Pure helpers (px → logical) ---

function pixelToTime({
	clientX,
	rulerEl,
	zoomLevel,
	duration,
}: {
	clientX: number;
	rulerEl: HTMLDivElement;
	zoomLevel: number;
	duration: MediaTime;
}): MediaTime {
	const rulerRect = rulerEl.getBoundingClientRect();
	const contentWidth = timelineTimeToPixels({ time: duration, zoomLevel });
	const clampedX = Math.max(
		0,
		Math.min(contentWidth, clientX - rulerRect.left),
	);
	const seconds = Math.max(
		0,
		Math.min(
			duration / TICKS_PER_SECOND,
			clampedX / (BASE_TIMELINE_PIXELS_PER_SECOND * zoomLevel),
		),
	);
	return mediaTime({ ticks: Math.round(seconds * TICKS_PER_SECOND) });
}

// --- Controller ---

export class PlayheadController {
	private lastMouseClientX = 0;

	private session: Session = { kind: "idle" };
	private readonly configRef: PlayheadConfigRef;
	private stopDrag: (() => void) | null = null;

	constructor(deps: { configRef: PlayheadConfigRef }) {
		this.configRef = deps.configRef;
		this.onPlayheadMouseDown = this.onPlayheadMouseDown.bind(this);
		this.onRulerMouseDown = this.onRulerMouseDown.bind(this);
		this.handleMouseMove = this.handleMouseMove.bind(this);
		this.handleMouseUp = this.handleMouseUp.bind(this);
	}

	private get config(): PlayheadConfig {
		return this.configRef.current;
	}

	get isActive(): boolean {
		return this.session.kind !== "idle";
	}

	getLastMouseClientX(): number {
		return this.lastMouseClientX;
	}

	destroy(): void {
		this.deactivate();
	}

	// --- Public event handlers (bound, stable references) ---

	onPlayheadMouseDown(event: ReactMouseEvent): void {
		event.preventDefault();
		event.stopPropagation();
		this.session = {
			kind: "scrubbing",
			didStartFromRuler: false,
			hasMoved: false,
			currentTime: null,
		};
		this.config.setScrubbing(true);
		this.scrub({ event, isElementSnappingEnabled: true });
		this.activate();
	}

	onRulerMouseDown(event: ReactMouseEvent): void {
		if (event.button !== 0) return;
		if (this.config.getPlayheadEl()?.contains(event.target as Node)) return;

		event.preventDefault();
		this.session = {
			kind: "scrubbing",
			didStartFromRuler: true,
			hasMoved: false,
			currentTime: null,
		};
		this.config.setScrubbing(true);
		// No element-edge snapping on initial ruler click — avoids a jarring jump.
		this.scrub({ event, isElementSnappingEnabled: false });
		this.activate();
	}

	// --- Public non-session methods ---

	/**
	 * Imperatively updates the playhead DOM element's `left` style.
	 * Called on scroll and playback events to avoid React re-renders
	 * during animation frame updates.
	 */
	updatePlayheadLeft(time: MediaTime): void {
		const playheadEl = this.config.getPlayheadEl();
		if (!playheadEl) return;

		const centerPixel = timelineTimeToSnappedPixels({
			time,
			zoomLevel: this.config.zoomLevel,
		});
		const scrollLeft = this.config.getRulerScrollEl()?.scrollLeft ?? 0;
		playheadEl.style.left = `${getCenteredLineLeft({ centerPixel }) - scrollLeft}px`;
	}

	/**
	 * Updates the playhead position and auto-scrolls to keep the playhead
	 * visible during playback.
	 */
	handlePlaybackUpdate(time: MediaTime): void {
		this.updatePlayheadLeft(time);

		// Auto-scroll only during playback, not while scrubbing.
		if (!this.config.getIsPlaying() || this.session.kind === "scrubbing")
			return;

		const rulerViewport = this.config.getRulerScrollEl();
		const tracksViewport = this.config.getTracksScrollEl();
		if (!rulerViewport || !tracksViewport) return;

		const playheadPixels = timelineTimeToPixels({
			time,
			zoomLevel: this.config.zoomLevel,
		});
		const viewportWidth = rulerViewport.clientWidth;
		const isOutOfView =
			playheadPixels < rulerViewport.scrollLeft ||
			playheadPixels > rulerViewport.scrollLeft + viewportWidth;

		if (isOutOfView) {
			const desiredScroll = Math.max(
				0,
				Math.min(
					rulerViewport.scrollWidth - viewportWidth,
					playheadPixels - viewportWidth / 2,
				),
			);
			rulerViewport.scrollLeft = tracksViewport.scrollLeft = desiredScroll;
		}
	}

	// --- Private ---

	private activate(): void {
		this.stopDrag = this.config.startMouseDrag({
			move: this.handleMouseMove,
			finish: this.handleMouseUp,
			// Cancel commits the scrub position, for the same reason number-field
			// and color-picker do: `scrub()` has already called `seek()` on every
			// move, so the playhead is ALREADY at the new time. Ending without
			// persisting `timelineViewState.playheadTime` would leave the visible
			// playhead and the saved view state disagreeing, and a reload would
			// snap it back. Reachable because the per-Surface coordinator holds one
			// drag and pre-empts an in-flight scrub through `cancel`.
			cancel: () => {
				const session = this.session;
				if (session.kind !== "idle" && session.currentTime !== null) {
					this.config.seek(session.currentTime);
					this.config.setTimelineViewState({
						zoomLevel: this.config.zoomLevel,
						scrollLeft: this.config.getTracksScrollEl()?.scrollLeft ?? 0,
						playheadTime: session.currentTime,
					});
				}
				this.session = { kind: "idle" };
				this.config.setScrubbing(false);
			},
		});
	}

	private deactivate(): void {
		// Null first, then detach — matching element-interaction, keyframe-drag and
		// resize controllers, so re-entry through the detach cannot see a stale handle.
		const stop = this.stopDrag;
		this.stopDrag = null;
		stop?.();
	}

	/**
	 * Converts pointer position to a frame-snapped timeline time and seeks.
	 * `isElementSnappingEnabled` controls element-edge snapping; frame-level snapping
	 * is always applied.
	 */
	private scrub({
		event,
		isElementSnappingEnabled,
	}: {
		event: MouseEvent | ReactMouseEvent;
		isElementSnappingEnabled: boolean;
	}): void {
		const ruler = this.config.getRulerEl();
		if (!ruler) return;

		const fps = this.config.getActiveProjectFps();
		if (!fps) return;

		const { zoomLevel, duration } = this.config;
		const rawTime = pixelToTime({
			clientX: event.clientX,
			rulerEl: ruler,
			zoomLevel,
			duration,
		});
		const frameTime = snapSeekMediaTime({ time: rawTime, duration, fps });

		const time = (() => {
			if (!isElementSnappingEnabled || this.config.isShiftHeld())
				return frameTime;

			const snapPoints = buildTimelineSnapPoints({
				sources: [
					() =>
						getElementEdgeSnapPoints({ tracks: this.config.getSceneTracks() }),
					() =>
						getBookmarkSnapPoints({
							bookmarks: this.config.getSceneBookmarks(),
						}),
					() =>
						getAnimationKeyframeSnapPointsForTimeline({
							tracks: this.config.getSceneTracks(),
						}),
				],
			});
			const result = resolveTimelineSnap({
				targetTime: frameTime,
				snapPoints,
				maxSnapDistance: getTimelineSnapThresholdInTicks({ zoomLevel }),
			});
			return result.snapPoint ? result.snappedTime : frameTime;
		})();

		if (this.session.kind === "scrubbing") {
			this.session.currentTime = time;
		}
		this.config.seek(time);
		this.lastMouseClientX = event.clientX;
	}

	private handleMouseMove(event: MouseEvent): void {
		if (this.session.kind !== "scrubbing") return;
		this.scrub({ event, isElementSnappingEnabled: true });
		if (this.session.didStartFromRuler) {
			this.session.hasMoved = true;
		}
	}

	private handleMouseUp(event: MouseEvent): void {
		if (this.session.kind !== "scrubbing") return;

		const session = this.session;
		this.config.setScrubbing(false);

		if (session.currentTime !== null) {
			this.config.seek(session.currentTime);
			this.config.setTimelineViewState({
				zoomLevel: this.config.zoomLevel,
				scrollLeft: this.config.getTracksScrollEl()?.scrollLeft ?? 0,
				playheadTime: session.currentTime,
			});
		}

		// Ruler click without drag: snap to clicked position on mouseup.
		if (session.didStartFromRuler && !session.hasMoved) {
			this.scrub({ event, isElementSnappingEnabled: false });
		}

		this.session = { kind: "idle" };
		this.deactivate();
	}
}
