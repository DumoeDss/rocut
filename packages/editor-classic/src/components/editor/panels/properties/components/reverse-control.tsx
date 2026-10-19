import { useId } from "react";
import { Switch } from "../../../../ui/switch";
import { useEditorInstance } from "../../../../../editor/use-editor";
import type { VideoElement } from "../../../../../timeline";
import { isVideoReverseSupported } from "../../../../../wasm/video-time";
import { toast } from "sonner";

export function ReverseControl({
	element,
	trackId,
}: {
	element: VideoElement;
	trackId: string;
}) {
	const editor = useEditorInstance();
	const id = useId();
	const reversed =
		element.retime &&
		"reverse" in element.retime &&
		element.retime.reverse === true;
	const supported = isVideoReverseSupported();
	return (
		<div className="px-3 py-4 border-t space-y-2">
			<div className="flex items-center justify-between gap-3">
				<label htmlFor={id} className="text-sm">
					倒放
				</label>
				<Switch
					id={id}
					data-testid="video-reverse"
					disabled={!supported}
					checked={Boolean(reversed)}
					onCheckedChange={(reverse) => {
						try {
							if (!isVideoReverseSupported())
								throw new Error(
									"当前媒体引擎不支持倒放，请升级编辑器媒体引擎后重试。",
								);
							const retime = {
								...element.retime,
								rate: element.retime?.rate ?? 1,
								reverse,
							};
							editor.timeline.updateElementRetime({
								trackId,
								elementId: element.id,
								retime,
							});
						} catch (error) {
							toast.error("无法设置倒放", {
								description: error instanceof Error ? error.message : "请重试",
							});
						}
					}}
				/>
			</div>
			{!supported && (
				<p className="text-xs text-muted-foreground">
					当前媒体引擎不支持倒放，请升级编辑器媒体引擎后重试。
				</p>
			)}
		</div>
	);
}
