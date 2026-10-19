import { createContext, useContext, useState, type ReactNode } from "react";
import type { MediaAsset } from "../../media/types";
import { Button } from "../../components/ui/button";
import { useEditor, useEditorInstance } from "../use-editor";
import { useMediaPreview } from "../../media/use-media-preview";

const Context = createContext<{ asset: MediaAsset | null; activation: number; open: (asset: MediaAsset | null) => void }>({ asset: null, activation: 0, open: () => {} });
export const useNativeAssetPreview = () => useContext(Context);
export function NativeAssetPreviewProvider({ children }: { children: ReactNode }) {
	const [asset, setAsset] = useState<MediaAsset | null>(null);
	const [activation, setActivation] = useState(0);
	const open = (next: MediaAsset | null) => {
		setAsset(next);
		if (next) setActivation((value) => value + 1);
	};
	const projectId = useEditor((editor) => editor.project.getActiveOrNull()?.metadata.id);
	const [previewProjectId, setPreviewProjectId] = useState(projectId);
	if (previewProjectId !== projectId) {
		setPreviewProjectId(projectId);
		setAsset(null);
	}
	return <Context.Provider value={{ asset, activation, open }}>{children}</Context.Provider>;
}
export function NativeAssetViewer({ children }: { children: ReactNode }) {
	const { asset, open } = useNativeAssetPreview();
	const editor = useEditorInstance();
	const preview = useMediaPreview({ asset: asset ?? undefined });
	return <div className="h-full min-h-0 flex flex-col">
		<div className="h-full min-h-0" style={{ display: asset ? "none" : undefined }}>{children}</div>
		{asset && <div className="creator-viewer" data-testid="native-asset-viewer"><div className="creator-viewer-heading"><h2 className="truncate text-xs">{asset.name}</h2><Button size="sm" variant="ghost" onClick={() => open(null)}>返回成片</Button></div><div className="flex-1 min-h-0 flex items-center justify-center p-4">{asset.type === "image" ? <img src={asset.url} alt={asset.name} className="max-h-full max-w-full object-contain" /> : asset.type === "video" ? <video src={asset.url} poster={preview.status === "ready" ? preview.url : undefined} controls preload="metadata" className="max-h-full max-w-full" /> : <audio src={asset.url} controls preload="metadata" className="max-w-full" />}</div><div className="p-3 text-xs text-muted-foreground border-t">{asset.type === "image" ? "图片" : asset.type === "video" ? "视频" : "音频"}{asset.duration != null ? ` · ${asset.duration.toFixed(2)} 秒` : ""}<Button size="sm" variant="ghost" onClick={() => { editor.playback.pause(); open(null); }}>返回剪辑</Button></div></div>}
	</div>;
}
