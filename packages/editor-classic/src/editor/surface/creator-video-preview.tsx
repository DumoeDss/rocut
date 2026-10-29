import { useRef } from "react";
import { Button } from "../../components/ui/button";
import type { CreatorAssetVersion } from "./creator-workspace-types";
import { useCreatorVideoPoster } from "./use-creator-video-poster";

export function CreatorVideoPreview({ assetId, version }: { assetId: string; version: CreatorAssetVersion }) {
	const root = useRef<HTMLDivElement>(null);
	const { state, retry } = useCreatorVideoPoster(assetId, version, root);
	const poster = version.posterUrl ?? (state.status === "available" ? state.url : undefined);
	return <div ref={root} className="flex max-h-full min-h-0 flex-col items-center gap-2">
		<video className="max-h-full min-h-0 max-w-full" src={version.previewUrl}
			poster={poster} controls preload="metadata" />
		{state.status === "loading" && !poster ? <p role="status" className="text-xs text-muted-foreground">正在获取封面</p> : null}
		{state.status === "unavailable" && !poster ? <div className="text-center text-xs text-muted-foreground">
			<p role="status">视频封面暂不可用：{state.reason}</p>
			<Button size="sm" variant="ghost" data-testid="creator-poster-retry" onClick={retry}>重试封面</Button>
		</div> : null}
	</div>;
}
