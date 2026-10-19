import { useEffect, useReducer, useState, type RefObject } from "react";
import { useEditor, useEditorInstance } from "../../editor/use-editor";
import { useTimelineStore } from "../../editor/use-session-store";
import { useCommittedRef } from "../../hooks/use-committed-ref";
import { useCreatorWorkspaceBridge } from "../../editor/surface/creator-workspace-context";
import { toElementDurationTicks } from "../creation";
import { validateCreatorDrag } from "../creator-drag-validation";
import {
	DragDropController,
	type DragDropConfig,
} from "../controllers/drag-drop-controller";

interface UseTimelineDragDropProps {
	containerRef: RefObject<HTMLDivElement | null>;
	headerRef?: RefObject<HTMLElement | null>;
	tracksScrollRef?: RefObject<HTMLDivElement | null>;
	zoomLevel: number;
}

export function useTimelineDragDrop({
	containerRef,
	headerRef,
	tracksScrollRef,
	zoomLevel,
}: UseTimelineDragDropProps) {
	const editor = useEditorInstance();
	const creatorBridge = useCreatorWorkspaceBridge();
	const creatorBridgeRef = useCommittedRef(creatorBridge);
	const [placementError, setPlacementError] = useState<{
		bridge: typeof creatorBridge;
		message: string;
	} | null>(null);
	const dragSource = useEditor((current) => current.timeline.dragSource);

	const heightScale = useTimelineStore((s) => s.trackHeightScale);
	const config: DragDropConfig = { heightScale,
		zoomLevel,
		getContainerEl: () => containerRef.current,
		getHeaderEl: () => headerRef?.current ?? null,
		getTracksScrollEl: () => tracksScrollRef?.current ?? null,
		getActiveProjectFps: () => editor.project.getActive()?.settings.fps ?? null,
		getActiveProjectId: () =>
			editor.project.getActiveOrNull()?.metadata.id ?? null,
		getSceneTracks: () => editor.scenes.getActiveScene().tracks,
		getCurrentPlayheadTime: () => editor.playback.getCurrentTime(),
		getMediaAssets: () => editor.media.getAssets(),
		getStore: () => editor.persistence.store,
		reportPersistenceFailure: (failure) =>
			editor.reportPersistenceFailure(failure),
		resources: editor.resources,
		dragSource,
		placeCreatorAsset: async ({ dragData, target }) => {
			setPlacementError(null);
			const source = dragData.creator;
			if (!source || !creatorBridge) return;
			const projectId = editor.project.getActiveOrNull()?.metadata.id;
			const sceneId = editor.scenes.getActiveSceneOrNull()?.id;
			try {
				const snapshot = await creatorBridge.getSnapshot();
				if (
					creatorBridgeRef.current !== creatorBridge ||
					!validateCreatorDrag({ dragData, snapshot, projectId, sceneId }) ||
					projectId !== editor.project.getActiveOrNull()?.metadata.id ||
					sceneId !== editor.scenes.getActiveSceneOrNull()?.id
				)
					throw new Error("拖动素材已失效或项目已切换，请重新拖动");
				const scene = editor.scenes.getActiveSceneOrNull();
				const tracks = scene
					? [...scene.tracks.overlay, scene.tracks.main, ...scene.tracks.audio]
					: [];
				const track = tracks[target.trackIndex];
				const trackType = dragData.mediaType === "audio" ? "audio" : "video";
				if (!target.isNewTrack && (!track || track.type !== trackType))
					throw new Error("请拖到可用的同类型轨道，或通过素材详情选择目标轨道");
				if (!projectId || !sceneId) return;
				await editor.save.flush();
				if (
					creatorBridgeRef.current !== creatorBridge ||
					projectId !== editor.project.getActiveOrNull()?.metadata.id ||
					sceneId !== editor.scenes.getActiveSceneOrNull()?.id
				)
					throw new Error("项目已切换，请重新拖动");
				await creatorBridge.execute({
					type: "asset.place-version",
					assetId: source.assetId,
					versionId: source.versionId,
					expectedSha256: source.sha256,
					native: {
						projectId,
						sceneId,
						revision: Number(await editor.transactions.revision()),
						placement: {
							clipId: crypto.randomUUID(),
							trackId: target.isNewTrack ? crypto.randomUUID() : track.id,
							...(target.isNewTrack
								? {
										newTrack: {
											type: trackType,
											index: tracks
												.slice(0, target.trackIndex)
												.filter((candidate) => candidate.type === trackType)
												.length,
										},
									}
								: {}),
							startTime: target.xPosition,
							...(dragData.mediaType === "image" || source.durationSeconds
								? {
										duration: toElementDurationTicks({
											seconds: source.durationSeconds,
										}),
									}
								: {}),
							trimStart: 0,
							trimEnd: 0,
						},
					},
				});
				if (projectId === editor.project.getActiveOrNull()?.metadata.id)
					await editor.project.loadProject({ id: projectId });
			} catch (failure) {
				setPlacementError({
					bridge: creatorBridge,
					message:
						failure instanceof Error ? failure.message : "素材入轨失败，请重试",
				});
			}
		},
		addMediaAsset: (args) => editor.media.addMediaAsset(args),
		executeCommand: (command) => editor.command.execute({ command }),
		insertElement: (args) => editor.timeline.insertElement(args),
		addClipEffect: (args) => editor.timeline.addClipEffect(args),
	};
	const configRef = useCommittedRef(config);
	const [controller] = useState(() => new DragDropController({ configRef }));

	const [, rerender] = useReducer((n: number) => n + 1, 0);
	useEffect(() => controller.subscribe(rerender), [controller]);
	useEffect(() => () => controller.destroy(), [controller]);

	return {
		placementError:
			placementError?.bridge === creatorBridge ? placementError.message : null,
		isDragOver: controller.isDragOver,
		dropTarget: controller.dropTarget,
		dragElementType: controller.dragElementType,
		dragProps: {
			onDragEnter: controller.onDragEnter,
			onDragOver: controller.onDragOver,
			onDragLeave: controller.onDragLeave,
			onDrop: controller.onDrop,
		},
	};
}
