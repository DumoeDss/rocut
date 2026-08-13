import { resolveStickerId } from "../../../stickers";
import {
	VisualNode,
	type ResolvedVisualSourceNodeState,
	type VisualNodeParams,
} from "./visual-node";
import type { AssetResolver } from "@opencut/editor-ports";
import { stickerSourceCacheKey } from "./sticker-cache-key";

export interface StickerNodeParams extends VisualNodeParams {
	stickerId: string;
	intrinsicWidth?: number;
	intrinsicHeight?: number;
	assets: AssetResolver;
}

interface CachedStickerSource {
	source: HTMLImageElement;
	width: number;
	height: number;
}

const stickerSourceCache = new Map<string, Promise<CachedStickerSource>>();

export function loadStickerSource({
	stickerId,
	assets,
	width = 200,
	height = 200,
}: {
	stickerId: string;
	assets: AssetResolver;
	width?: number;
	height?: number;
}): Promise<CachedStickerSource> {
	const url = resolveStickerId({
		stickerId,
		options: { width, height },
		assets,
	});
	const cacheKey = stickerSourceCacheKey({ url, width, height });
	const cached = stickerSourceCache.get(cacheKey);
	if (cached) return cached;

	const promise = (async (): Promise<CachedStickerSource> => {
		const image = new Image();

		await new Promise<void>((resolve, reject) => {
			image.onload = () => resolve();
			image.onerror = () =>
				reject(new Error(`Failed to load sticker: ${stickerId}`));
			image.src = url;
		});

		return {
			source: image,
			width: image.naturalWidth,
			height: image.naturalHeight,
		};
	})();

	stickerSourceCache.set(cacheKey, promise);
	return promise;
}

export class StickerNode extends VisualNode<
	StickerNodeParams,
	ResolvedVisualSourceNodeState
> {}
