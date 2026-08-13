import { stickersRegistry } from "./registry";
import { parseStickerId } from "./sticker-id";
import { registerDefaultStickerProviders } from "./providers";
import type { StickerResolveOptions } from "@/stickers/types";
import type { AssetResolver } from "@/editor/ports";

export function resolveStickerId({
	stickerId,
	options,
	assets,
}: {
	stickerId: string;
	options?: StickerResolveOptions;
	assets?: AssetResolver;
}): string {
	registerDefaultStickerProviders();

	const parsedStickerId = parseStickerId({ stickerId });
	return stickersRegistry.get(parsedStickerId.providerId).resolveUrl({
		stickerId,
		options,
		assets,
	});
}
