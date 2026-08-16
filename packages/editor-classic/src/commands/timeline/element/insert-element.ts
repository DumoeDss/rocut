import {
	Command,
	type EditorCommandContext,
	type CommandResult,
} from "../../base-command";
import type {
	CreateTimelineElement,
	SceneTracks,
	TimelineElement,
	TrackType,
} from "../../../timeline";
import { generateUUID } from "../../../utils/id";
import { requiresMediaId } from "../../../timeline/element-utils";
import type { MediaAsset } from "../../../media/types";
import { DEFAULT_NEW_ELEMENT_DURATION } from "../../../timeline/creation";
import { floatToFrameRate } from "../../../fps/utils";
import { graphicsRegistry, registerDefaultGraphics } from "../../../graphics";
import {
	applyPlacement,
	canElementGoOnTrack,
	resolveTrackPlacement,
	validateElementTrackCompatibility,
} from "../../../timeline/placement";
import { roundMediaTime, TICKS_PER_SECOND } from "../../../wasm";

type InsertElementPlacement =
	| { mode: "explicit"; trackId: string }
	| { mode: "auto"; trackType?: TrackType; insertIndex?: number };

export interface InsertElementParams {
	element: CreateTimelineElement;
	placement: InsertElementPlacement;
}

export class InsertElementCommand extends Command {
	readonly routingClass = "transaction" as const;

	private elementId: string;
	private savedState: SceneTracks | null = null;
	private targetTrackId: string | null = null;

	constructor({ element, placement }: InsertElementParams) {
		super();
		this.elementId = generateUUID();
		this.element = element;
		this.placement = placement;
	}

	private element: CreateTimelineElement;
	private placement: InsertElementPlacement;

	execute({ editor }: EditorCommandContext): CommandResult | undefined {
		this.savedState = editor.scenes.getActiveScene().tracks;

		if (!this.validateElementBasics({ element: this.element })) {
			return;
		}

		const totalElementsInTimeline =
			this.savedState.main.elements.length +
			this.savedState.overlay.reduce(
				(total, track) => total + track.elements.length,
				0,
			) +
			this.savedState.audio.reduce(
				(total, track) => total + track.elements.length,
				0,
			);
		const isFirstElement = totalElementsInTimeline === 0;

		// Frame alignment: the transaction engine's base placement policy rejects
		// any clip whose startTime/duration/trimStart/trimEnd is not an exact
		// multiple of ticks-per-frame. Real media durations essentially never are,
		// so align here, against the frame rate that will be in effect after this
		// insert (the first visual element adopts the asset's fps below).
		const ticksPerFrame = this.resolveTicksPerFrame({ editor, isFirstElement });

		const newElement = this.buildElement({
			element: this.element,
			ticksPerFrame,
		});
		const updateResult = this.applyPlacementResult({
			tracks: this.savedState,
			element: newElement,
		});

		if (!updateResult) {
			return;
		}

		const { updatedTracks, targetTrackId } = updateResult;
		this.targetTrackId = targetTrackId;

		const isVisualMedia =
			newElement.type === "video" || newElement.type === "image";

		if (isFirstElement && isVisualMedia) {
			const mediaAssets = editor.media.getAssets();
			const activeProject = editor.project.getActive();
			const asset = mediaAssets.find(
				(item: MediaAsset) => item.id === newElement.mediaId,
			);

			if (asset?.width && asset?.height) {
				const nextCanvasSize = { width: asset.width, height: asset.height };
				const shouldSetOriginalCanvasSize =
					!activeProject?.settings.originalCanvasSize;
				editor.project.updateSettings({
					settings: {
						canvasSize: nextCanvasSize,
						...(shouldSetOriginalCanvasSize
							? { originalCanvasSize: nextCanvasSize }
							: {}),
					},
					pushHistory: false,
				});
			}

			if (asset?.type === "video" && asset?.fps) {
				editor.project.updateSettings({
					settings: { fps: floatToFrameRate(asset.fps) },
					pushHistory: false,
				});
			}
		}

		editor.timeline.updateTracks(updatedTracks);

		return {
			selection: {
				selectedElements: [
					{ trackId: targetTrackId, elementId: this.elementId },
				],
				selectedKeyframes: [],
				keyframeSelectionAnchor: null,
				selectedMaskPoints: null,
			},
		};
	}

	undo({ editor }: EditorCommandContext): void {
		if (this.savedState) {
			editor.timeline.updateTracks(this.savedState);
		}
	}

	getElementId(): string {
		return this.elementId;
	}

	getTrackId(): string | null {
		return this.targetTrackId;
	}

	private resolveTicksPerFrame({
		editor,
		isFirstElement,
	}: {
		editor: EditorCommandContext["editor"];
		isFirstElement: boolean;
	}): number {
		let frameRate = editor.project.getActive().settings.fps;
		const isVisualMedia =
			this.element.type === "video" || this.element.type === "image";
		const mediaId =
			"mediaId" in this.element ? String(this.element.mediaId) : null;
		if (isFirstElement && isVisualMedia && mediaId !== null) {
			const asset = editor.media
				.getAssets()
				.find((candidate) => candidate.id === mediaId);
			if (asset?.type === "video" && asset?.fps) {
				frameRate = floatToFrameRate(asset.fps);
			}
		}
		return Math.max(
			1,
			Math.round(
				(TICKS_PER_SECOND * frameRate.denominator) / frameRate.numerator,
			),
		);
	}

	private buildElement({
		element,
		ticksPerFrame,
	}: {
		element: CreateTimelineElement;
		ticksPerFrame: number;
	}): TimelineElement {
		const ticks = (value: unknown): number => Number(value ?? 0);
		const alignDown = (value: number): number =>
			Math.max(0, Math.floor(value / ticksPerFrame) * ticksPerFrame);
		const alignNearest = (value: number): number =>
			Math.max(0, Math.round(value / ticksPerFrame) * ticksPerFrame);
		const rawDuration = ticks(element.duration ?? DEFAULT_NEW_ELEMENT_DURATION);
		return {
			...element,
			id: this.elementId,
			startTime: alignNearest(ticks(element.startTime)),
			trimStart: alignDown(ticks(element.trimStart)),
			trimEnd: alignDown(ticks(element.trimEnd)),
			// Never floor a positive source duration to zero: the same policy also
			// rejects non-positive durations.
			duration: Math.max(ticksPerFrame, alignDown(rawDuration)),
		} as TimelineElement;
	}

	private validateElementBasics({
		element,
	}: {
		element: CreateTimelineElement;
	}): boolean {
		if (requiresMediaId({ element }) && !("mediaId" in element)) {
			console.error("Element requires mediaId");
			return false;
		}

		if (
			element.type === "audio" &&
			element.sourceType === "library" &&
			!element.sourceUrl
		) {
			console.error("Library audio element must have sourceUrl");
			return false;
		}

		if (element.type === "sticker" && !element.stickerId) {
			console.error("Sticker element must have stickerId");
			return false;
		}

		if (element.type === "graphic") {
			registerDefaultGraphics();
			if (
				!element.definitionId ||
				!graphicsRegistry.has(element.definitionId)
			) {
				console.error("Graphic element must have a valid definitionId");
				return false;
			}
		}

		if (element.type === "text" && !element.params.content) {
			console.error("Text element must have content");
			return false;
		}

		if (element.type === "effect" && !element.effectType) {
			console.error("Effect element must have effectType");
			return false;
		}

		return true;
	}

	private applyPlacementResult({
		tracks,
		element,
	}: {
		tracks: SceneTracks;
		element: TimelineElement;
	}): { updatedTracks: SceneTracks; targetTrackId: string } | null {
		const placement = this.placement;

		if (
			placement.mode === "auto" &&
			placement.trackType &&
			!canElementGoOnTrack({
				elementType: element.type,
				trackType: placement.trackType,
			})
		) {
			console.error(
				`${element.type} elements cannot be placed on ${placement.trackType} tracks`,
			);
			return null;
		}

		const placementResult = resolveTrackPlacement({
			tracks,
			...(placement.mode === "auto" && placement.trackType
				? { trackType: placement.trackType }
				: { elementType: element.type }),
			timeSpans: [
				{
					startTime: element.startTime,
					duration: element.duration,
				},
			],
			strategy:
				placement.mode === "explicit"
					? { type: "explicit", trackId: placement.trackId }
					: { type: "firstAvailable" },
		});
		if (!placementResult) {
			if (placement.mode === "explicit") {
				const targetTrack =
					tracks.main.id === placement.trackId
						? tracks.main
						: (tracks.overlay.find((track) => track.id === placement.trackId) ??
							tracks.audio.find((track) => track.id === placement.trackId));
				if (!targetTrack) {
					console.error("Track not found:", placement.trackId);
					return null;
				}

				const validation = validateElementTrackCompatibility({
					element,
					track: targetTrack,
				});
				console.error(validation.errorMessage);
			} else {
				// Auto placement used to fail mutely. Every entry point that is not
				// an explicit drop -- the panel "+" button, drag-and-drop onto empty
				// timeline space -- returned here with no signal at all.
				console.error(
					`No track could accept a ${element.type} element under auto placement`,
				);
			}

			return null;
		}

		const elementToPlace =
			placementResult.kind === "existingTrack"
				? {
						...element,
						startTime:
							placementResult.adjustedStartTime !== undefined
								? roundMediaTime({
										time: placementResult.adjustedStartTime,
									})
								: element.startTime,
					}
				: element;

		const appliedPlacement = applyPlacement({
			tracks,
			placementResult,
			elements: [elementToPlace],
			newTrackInsertIndexOverride:
				placement.mode === "auto" && typeof placement.insertIndex === "number"
					? placement.insertIndex
					: undefined,
		});
		if (!appliedPlacement) {
			return null;
		}

		return {
			updatedTracks: appliedPlacement.updatedTracks,
			targetTrackId: appliedPlacement.targetTrackId,
		};
	}
}
