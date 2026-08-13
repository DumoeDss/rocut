import type { STICKER_CATEGORIES } from "@/stickers/categories";
import type { AssetResolver } from "@/editor/ports";

export type StickerCategory = keyof typeof STICKER_CATEGORIES;

export interface StickerItem {
	id: string;
	provider: string;
	name: string;
	previewUrl: string;
	metadata: Record<string, unknown>;
}

export interface StickerSearchResult {
	items: StickerItem[];
	total: number;
	hasMore: boolean;
}

export interface StickerBrowseSection {
	id: string;
	title?: string;
	items: StickerItem[];
	hasMore?: boolean;
	layout?: "grid" | "row";
	action?: {
		type: "see-all";
		category?: StickerCategory;
		sectionId?: string;
	};
}

export interface StickerBrowseResult {
	sections: StickerBrowseSection[];
}

export interface StickerProviderSearchOptions {
	limit?: number;
}

export interface StickerProviderBrowseOptions {
	page?: number;
	limit?: number;
}

export interface StickerResolveOptions {
	width?: number;
	height?: number;
}

export interface StickerProvider {
	id: string;
	search({
		query,
		options,
	}: {
		query: string;
		options?: StickerProviderSearchOptions;
		assets?: AssetResolver;
	}): Promise<StickerSearchResult>;
	browse({
		options,
	}: {
		options?: StickerProviderBrowseOptions;
		assets?: AssetResolver;
	}): Promise<StickerBrowseResult>;
	resolveUrl({
		stickerId,
		options,
	}: {
		stickerId: string;
		options?: StickerResolveOptions;
		assets?: AssetResolver;
	}): string;
}
