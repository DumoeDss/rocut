import { useRef } from "react";
import { toast } from "sonner";
import { useEditor, useEditorInstance } from "../../editor/use-editor";
import { ToggleVideoFreezeCommand } from "../../commands/timeline/element/toggle-video-freeze";
import { selectElementWithTrackTuple } from "../element-with-track-selector";
import { useElementSelection } from "./element/use-element-selection";
import { mediaTimeFromSeconds, planVideoFreezeFrame } from "../../wasm";

export function useVideoFreeze() {
	const editor = useEditorInstance();
	const { selectedElements } = useElementSelection();
	const [track, element] = useEditor((current) =>
		selectElementWithTrackTuple({
			editor: current,
			elements: selectedElements,
		}),
	);
	const playhead = useEditor((current) => current.playback.getCurrentTime());
	const assets = useEditor((current) => current.media.getAssets());

	const applying = useRef(false);
	const video =
		selectedElements.length === 1 && element?.type === "video" ? element : null;
	const frozen = video?.freezeFrame !== undefined;
	const source = assets.find((asset) => asset.id === video?.mediaId);
	const sourceDuration =
		video?.sourceDuration ??
		(source?.duration === undefined
			? undefined
			: mediaTimeFromSeconds({ seconds: source.duration }));
	const canFreeze =
		!!video &&
		sourceDuration !== undefined &&
		planVideoFreezeFrame({
			clipStart: video.startTime,
			clipDuration: video.duration,
			playhead,
			trimStart: video.trimStart,
			playbackRate: video.retime?.rate ?? 1,
			reverse: video.retime?.reverse,
			sourceDuration,
		}) !== null;
	return {
		label: frozen ? "取消定格" : "定格画面",
		disabled: !track || (!frozen && !canFreeze),
		isActive: frozen,
		apply: async () => {
			if (applying.current || !track || !video || (!frozen && !canFreeze))
				return;
			applying.current = true;

			editor.playback.pause();
			try {
				await editor.command.execute({
					command: new ToggleVideoFreezeCommand({
						trackId: track.id,
						elementId: video.id,
						playhead,
					}),
				});
				toast.success(
					frozen ? "已恢复视频播放" : "已定格此片段画面，并暂停原始音频",
				);
			} catch (error) {
				toast.error("无法修改画面定格", {
					description: error instanceof Error ? error.message : "请重试。",
				});
			} finally {
				applying.current = false;
			}
		},
	};
}
