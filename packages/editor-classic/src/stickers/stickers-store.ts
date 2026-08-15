import { createStore } from "zustand/vanilla";
import { persist } from "zustand/middleware";
import {
	browseAll,
	browseCategory,
	searchAll,
	searchStickers as searchStickersFromProviders,
} from ".";
import type { StickerBrowseResult, StickerSearchResult } from ".";
import { STICKER_CATEGORIES } from "./categories";
import type { StickerCategory } from "./types";
import { registerDefaultStickerProviders } from "./providers";
import { stickersRegistry } from "./registry";
import { parseStickerId } from "./sticker-id";
import type { AssetResolver } from "@opencut/editor-ports";

const MAX_RECENT_STICKERS = 50;

function isValidStickerId(value: unknown): value is string {
	if (typeof value !== "string") {
		return false;
	}

	try {
		const parsed = parseStickerId({ stickerId: value });
		return stickersRegistry.has(parsed.providerId);
	} catch {
		return false;
	}
}

function sanitizeRecentStickers({
	recentStickers,
}: {
	recentStickers: unknown;
}): string[] {
	registerDefaultStickerProviders({});

	if (!Array.isArray(recentStickers)) {
		return [];
	}

	const sanitized: string[] = [];
	for (const stickerId of recentStickers) {
		if (!isValidStickerId(stickerId)) {
			continue;
		}
		if (sanitized.includes(stickerId)) {
			continue;
		}
		sanitized.push(stickerId);
		if (sanitized.length >= MAX_RECENT_STICKERS) {
			break;
		}
	}

	return sanitized;
}

type ViewMode = "search" | "browse";

export interface StickersStore {
	searchQuery: string;
	selectedCategory: StickerCategory;
	viewMode: ViewMode;
	searchResults: StickerSearchResult | null;
	browseContent: StickerBrowseResult | null;
	recentStickers: string[];
	isSearching: boolean;
	isBrowsing: boolean;

	setSearchQuery: ({ query }: { query: string }) => void;
	setSelectedCategory: ({ category }: { category: StickerCategory }) => void;
	searchStickers: ({ query }: { query: string }) => Promise<void>;
	browseStickers: () => Promise<void>;
	addToRecentStickers: ({ stickerId }: { stickerId: string }) => void;
	clearRecentStickers: () => void;
}

export interface StickerStoreQueries {
	searchAll: typeof searchAll;
	searchStickers: typeof searchStickersFromProviders;
	browseAll: typeof browseAll;
	browseCategory: typeof browseCategory;
}

const DEFAULT_QUERIES: StickerStoreQueries = {
	searchAll,
	searchStickers: searchStickersFromProviders,
	browseAll,
	browseCategory,
};

export function createStickersStore({
	isDisposed = () => false,
	queries = DEFAULT_QUERIES,
	assets,
}: {
	isDisposed?: () => boolean;
	queries?: StickerStoreQueries;
	assets?: AssetResolver;
} = {}) {
	let requestVersion = 0;
	return createStore<StickersStore>()(
		persist(
			(set, get) => ({
				searchQuery: "",
				selectedCategory: "all",
				viewMode: "browse",

				searchResults: null,
				browseContent: null,
				recentStickers: [],

				isSearching: false,
				isBrowsing: false,

				setSearchQuery: ({ query }) => set({ searchQuery: query }),

				setSelectedCategory: ({ category }) => {
					set({
						selectedCategory: category in STICKER_CATEGORIES ? category : "all",
						browseContent: null,
					});

					const query = get().searchQuery.trim();
					if (query) {
						void get().searchStickers({ query });
						return;
					}

					void get().browseStickers();
				},

				searchStickers: async ({ query }: { query: string }) => {
					const version = ++requestVersion;
					const trimmedQuery = query.trim();
					if (!trimmedQuery) {
						set({ searchResults: null, viewMode: "browse" });
						await get().browseStickers();
						return;
					}

					const category = get().selectedCategory;
					const selectedCategory =
						category in STICKER_CATEGORIES ? category : "all";

					set({
						isSearching: true,
						isBrowsing: false,
						viewMode: "search",
					});
					try {
						if (selectedCategory === "all") {
							const browseContent = await queries.searchAll({
								query: trimmedQuery,
								assets,
							});
							if (isDisposed() || version !== requestVersion) return;
							set({ browseContent, searchResults: null });
						} else {
							const results = await queries.searchStickers({
								query: trimmedQuery,
								category: selectedCategory,
								limit: 100,
								assets,
							});
							if (isDisposed() || version !== requestVersion) return;
							set({ searchResults: results });
						}
					} catch (error) {
						if (isDisposed() || version !== requestVersion) return;
						console.error("Search failed:", error);
						set({ searchResults: null });
					} finally {
						if (!isDisposed() && version === requestVersion) {
							set({ isSearching: false });
						}
					}
				},

				browseStickers: async () => {
					const version = ++requestVersion;
					const category = get().selectedCategory;
					const selectedCategory =
						category in STICKER_CATEGORIES ? category : "all";

					set({
						isBrowsing: true,
						isSearching: false,
						viewMode: "browse",
					});
					try {
						const browseContent =
							selectedCategory === "all"
								? await queries.browseAll({
										recentStickers: get().recentStickers,
										assets,
									})
								: await queries.browseCategory({
										category: selectedCategory,
										assets,
									});

						if (isDisposed() || version !== requestVersion) return;
						set({ browseContent });
					} catch (error) {
						if (isDisposed() || version !== requestVersion) return;
						console.error("Browse failed:", error);
						set({ browseContent: null });
					} finally {
						if (!isDisposed() && version === requestVersion) {
							set({ isBrowsing: false });
						}
					}
				},

				addToRecentStickers: ({ stickerId }: { stickerId: string }) => {
					const sanitizedStickerIds = sanitizeRecentStickers({
						recentStickers: [stickerId],
					});
					if (sanitizedStickerIds.length === 0) {
						return;
					}

					set((state) => {
						const recent = [
							sanitizedStickerIds[0],
							...state.recentStickers.filter(
								(s) => s !== sanitizedStickerIds[0],
							),
						];
						return {
							recentStickers: recent.slice(0, MAX_RECENT_STICKERS),
						};
					});

					if (get().viewMode === "browse" && get().selectedCategory === "all") {
						void get().browseStickers();
					}
				},

				clearRecentStickers: () => {
					set({ recentStickers: [] });

					if (get().viewMode === "browse" && get().selectedCategory === "all") {
						void get().browseStickers();
					}
				},
			}),
			{
				name: "stickers-settings",
				version: 1,
				migrate: (persistedState) => {
					if (
						typeof persistedState === "object" &&
						persistedState !== null &&
						"selectedCategory" in persistedState
					) {
						const typedState = persistedState as {
							selectedCategory?: string;
							recentStickers?: string[];
						};
						const category = typedState.selectedCategory ?? "all";
						return {
							...typedState,
							selectedCategory:
								category in STICKER_CATEGORIES
									? (category as StickerCategory)
									: "all",
							recentStickers: sanitizeRecentStickers({
								recentStickers: typedState.recentStickers ?? [],
							}),
						};
					}
					return persistedState;
				},
				partialize: (state) => ({
					selectedCategory: state.selectedCategory,
					recentStickers: state.recentStickers,
				}),
			},
		),
	);
}
