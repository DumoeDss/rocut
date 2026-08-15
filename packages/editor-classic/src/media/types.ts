import type { MediaAssetData } from "../services/storage/types";
import type { ObjectUrlHandle } from "@opencut/editor-ports";

export type MediaType = "image" | "video" | "audio";

export interface MediaAsset extends Omit<
	MediaAssetData,
	"size" | "lastModified"
> {
	file: File;
	url?: string;
	/** Session-owned URL lifetime; absent only for host-provided/non-blob URLs. */
	urlHandle?: ObjectUrlHandle;
}
