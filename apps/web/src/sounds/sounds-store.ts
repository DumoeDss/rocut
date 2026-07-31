import { createStore } from "zustand/vanilla";
import type { SoundEffect, SavedSound } from "@/sounds/types";
import { storageService } from "@/services/storage/service";
import { toast } from "sonner";
import type { EditorCore } from "@/core";
import { buildLibraryAudioElement } from "@/timeline/element-utils";
import { mediaTimeFromSeconds } from "@/wasm";

export interface SoundsStore {
	topSoundEffects: SoundEffect[];
	isLoading: boolean;
	error: string | null;
	hasLoaded: boolean;
	showCommercialOnly: boolean;
	toggleCommercialFilter: () => void;
	searchQuery: string;
	searchResults: SoundEffect[];
	isSearching: boolean;
	searchError: string | null;
	lastSearchQuery: string;
	scrollPosition: number;
	currentPage: number;
	hasNextPage: boolean;
	totalCount: number;
	isLoadingMore: boolean;
	savedSounds: SavedSound[];
	isSavedSoundsLoaded: boolean;
	isLoadingSavedSounds: boolean;
	savedSoundsError: string | null;

	addSoundToTimeline: ({
		sound,
		editor,
	}: {
		sound: SoundEffect;
		editor: EditorCore;
	}) => Promise<boolean>;
	setTopSoundEffects: ({ sounds }: { sounds: SoundEffect[] }) => void;
	setLoading: ({ loading }: { loading: boolean }) => void;
	setError: ({ error }: { error: string | null }) => void;
	setHasLoaded: ({ loaded }: { loaded: boolean }) => void;
	setSearchQuery: ({ query }: { query: string }) => void;
	setSearchResults: ({ results }: { results: SoundEffect[] }) => void;
	setSearching: ({ searching }: { searching: boolean }) => void;
	setSearchError: ({ error }: { error: string | null }) => void;
	setLastSearchQuery: ({ query }: { query: string }) => void;
	setScrollPosition: ({ position }: { position: number }) => void;
	setCurrentPage: ({ page }: { page: number }) => void;
	setHasNextPage: ({ hasNext }: { hasNext: boolean }) => void;
	setTotalCount: ({ count }: { count: number }) => void;
	setLoadingMore: ({ loading }: { loading: boolean }) => void;
	appendSearchResults: ({ results }: { results: SoundEffect[] }) => void;
	appendTopSounds: ({ results }: { results: SoundEffect[] }) => void;
	resetPagination: () => void;
	loadSavedSounds: () => Promise<void>;
	saveSoundEffect: ({
		soundEffect,
	}: {
		soundEffect: SoundEffect;
	}) => Promise<void>;
	removeSavedSound: ({ soundId }: { soundId: number }) => Promise<void>;
	isSoundSaved: ({ soundId }: { soundId: number }) => boolean;
	toggleSavedSound: ({
		soundEffect,
	}: {
		soundEffect: SoundEffect;
	}) => Promise<void>;
	clearSavedSounds: () => Promise<void>;
	beginRequest: ({
		channel,
	}: {
		channel: SoundsRequestChannel;
	}) => SoundsRequestToken;
	canPublishRequest: ({ token }: { token: SoundsRequestToken }) => boolean;
}

export type SoundsRequestChannel =
	| "search"
	| "loadMore"
	| "savedLoad"
	| "timeline";

export interface SoundsRequestToken {
	readonly channel: SoundsRequestChannel;
	readonly generation: number;
	readonly owner: symbol;
}

export function createSoundsStore({
	isDisposed = () => false,
	storage = storageService,
}: {
	isDisposed?: () => boolean;
	storage?: Pick<
		typeof storageService,
		| "loadSavedSounds"
		| "saveSoundEffect"
		| "removeSavedSound"
		| "clearSavedSounds"
	>;
} = {}) {
	const owner = Symbol("soundsStoreRequestOwner");
	const generations: Record<SoundsRequestChannel, number> = {
		search: 0,
		loadMore: 0,
		savedLoad: 0,
		timeline: 0,
	};
	const beginRequest = ({ channel }: { channel: SoundsRequestChannel }) => {
		if (channel === "search") {
			// A new query invalidates any page append that belongs to the previous
			// query, including one currently yielding in response.json().
			generations.loadMore++;
		}
		return {
			channel,
			generation: ++generations[channel],
			owner,
		};
	};
	const canPublishRequest = ({ token }: { token: SoundsRequestToken }) =>
		!isDisposed() &&
		token.owner === owner &&
		(token.channel === "timeline" ||
			token.generation === generations[token.channel]);
	let savedMutationTail: Promise<void> = Promise.resolve();
	const serializeSavedMutation = (mutation: () => Promise<void>) => {
		const result = savedMutationTail.then(mutation);
		savedMutationTail = result.catch(() => {});
		return result;
	};

	return createStore<SoundsStore>()((set, get) => ({
		beginRequest,
		canPublishRequest,
		topSoundEffects: [],
		isLoading: false,
		error: null,
		hasLoaded: false,
		showCommercialOnly: true,

		toggleCommercialFilter: () => {
			set((state) => ({ showCommercialOnly: !state.showCommercialOnly }));
		},

		searchQuery: "",
		searchResults: [],
		isSearching: false,
		searchError: null,
		lastSearchQuery: "",
		scrollPosition: 0,
		currentPage: 1,
		hasNextPage: false,
		totalCount: 0,
		isLoadingMore: false,
		savedSounds: [],
		isSavedSoundsLoaded: false,
		isLoadingSavedSounds: false,
		savedSoundsError: null,

		setTopSoundEffects: ({ sounds }) => set({ topSoundEffects: sounds }),
		setLoading: ({ loading }) => set({ isLoading: loading }),
		setError: ({ error }) => set({ error }),
		setHasLoaded: ({ loaded }) => set({ hasLoaded: loaded }),
		setSearchQuery: ({ query }) => set({ searchQuery: query }),
		setSearchResults: ({ results }) =>
			set({ searchResults: results, currentPage: 1 }),
		setSearching: ({ searching }) => set({ isSearching: searching }),
		setSearchError: ({ error }) => set({ searchError: error }),
		setLastSearchQuery: ({ query }) => set({ lastSearchQuery: query }),
		setScrollPosition: ({ position }) => set({ scrollPosition: position }),
		setCurrentPage: ({ page }) => set({ currentPage: page }),
		setHasNextPage: ({ hasNext }) => set({ hasNextPage: hasNext }),
		setTotalCount: ({ count }) => set({ totalCount: count }),
		setLoadingMore: ({ loading }) => set({ isLoadingMore: loading }),

		appendSearchResults: ({ results }) =>
			set((state) => ({
				searchResults: [...state.searchResults, ...results],
			})),

		appendTopSounds: ({ results }) =>
			set((state) => ({
				topSoundEffects: [...state.topSoundEffects, ...results],
			})),

		resetPagination: () =>
			set({
				currentPage: 1,
				hasNextPage: false,
				totalCount: 0,
				isLoadingMore: false,
			}),

		loadSavedSounds: async () => {
			if (get().isSavedSoundsLoaded) return;
			const token = beginRequest({ channel: "savedLoad" });

			try {
				set({ isLoadingSavedSounds: true, savedSoundsError: null });
				const savedSoundsData = await storage.loadSavedSounds();
				if (!canPublishRequest({ token })) return;
				set({
					savedSounds: savedSoundsData.sounds,
					isSavedSoundsLoaded: true,
				});
			} catch (error) {
				if (!canPublishRequest({ token })) return;
				const errorMessage =
					error instanceof Error
						? error.message
						: "Failed to load saved sounds";
				set({
					savedSoundsError: errorMessage,
				});
				console.error("Failed to load saved sounds:", error);
			} finally {
				if (canPublishRequest({ token })) {
					set({ isLoadingSavedSounds: false });
				}
			}
		},

		saveSoundEffect: ({ soundEffect }) => {
			generations.savedLoad += 1;
			set({ isLoadingSavedSounds: false });
			return serializeSavedMutation(async () => {
				try {
					await storage.saveSoundEffect({ soundEffect });
					if (isDisposed()) return;
					const savedSoundsData = await storage.loadSavedSounds();
					if (isDisposed()) return;
					set({
						savedSounds: savedSoundsData.sounds,
						isSavedSoundsLoaded: true,
						savedSoundsError: null,
					});
				} catch (error) {
					if (isDisposed()) return;
					const errorMessage =
						error instanceof Error ? error.message : "Failed to save sound";
					set({ savedSoundsError: errorMessage });
					toast.error("Failed to save sound");
					console.error("Failed to save sound:", error);
				}
			});
		},

		removeSavedSound: ({ soundId }) => {
			generations.savedLoad += 1;
			set({ isLoadingSavedSounds: false });
			return serializeSavedMutation(async () => {
				try {
					await storage.removeSavedSound({ soundId });
					if (isDisposed()) return;
					const savedSoundsData = await storage.loadSavedSounds();
					if (isDisposed()) return;
					set({
						savedSounds: savedSoundsData.sounds,
						isSavedSoundsLoaded: true,
						savedSoundsError: null,
					});
				} catch (error) {
					if (isDisposed()) return;
					const errorMessage =
						error instanceof Error ? error.message : "Failed to remove sound";
					set({ savedSoundsError: errorMessage });
					toast.error("Failed to remove sound");
					console.error("Failed to remove sound:", error);
				}
			});
		},

		isSoundSaved: ({ soundId }) => {
			const { savedSounds } = get();
			return savedSounds.some((sound) => sound.id === soundId);
		},

		toggleSavedSound: async ({ soundEffect }) => {
			const { isSoundSaved, saveSoundEffect, removeSavedSound } = get();

			if (isSoundSaved({ soundId: soundEffect.id })) {
				await removeSavedSound({ soundId: soundEffect.id });
			} else {
				await saveSoundEffect({ soundEffect });
			}
		},

		clearSavedSounds: () => {
			generations.savedLoad += 1;
			set({ isLoadingSavedSounds: false });
			return serializeSavedMutation(async () => {
				try {
					await storage.clearSavedSounds();
					if (isDisposed()) return;
					const savedSoundsData = await storage.loadSavedSounds();
					if (isDisposed()) return;
					set({
						savedSounds: savedSoundsData.sounds,
						isSavedSoundsLoaded: true,
						savedSoundsError: null,
					});
				} catch (error) {
					if (isDisposed()) return;
					const errorMessage =
						error instanceof Error
							? error.message
							: "Failed to clear saved sounds";
					set({ savedSoundsError: errorMessage });
					toast.error("Failed to clear saved sounds");
					console.error("Failed to clear saved sounds:", error);
				}
			});
		},

		addSoundToTimeline: async ({ sound, editor }) => {
			const token = beginRequest({ channel: "timeline" });
			const audioUrl = sound.previewUrl;
			if (!audioUrl) {
				toast.error("Sound file not available");
				return false;
			}

			try {
				const currentTime = editor.playback.getCurrentTime();

				const response = await fetch(audioUrl);
				if (!canPublishRequest({ token })) return false;
				if (!response.ok)
					throw new Error(`Failed to download audio: ${response.statusText}`);

				const arrayBuffer = await response.arrayBuffer();
				if (!canPublishRequest({ token })) return false;
				const audioContext = new AudioContext();
				const buffer = await audioContext.decodeAudioData(arrayBuffer);
				if (!canPublishRequest({ token })) return false;

				const element = buildLibraryAudioElement({
					sourceUrl: audioUrl,
					name: sound.name,
					duration: mediaTimeFromSeconds({ seconds: sound.duration }),
					startTime: currentTime,
					buffer,
				});

				editor.timeline.insertElement({
					placement: { mode: "auto", trackType: "audio" },
					element,
				});
				return true;
			} catch (error) {
				if (!canPublishRequest({ token })) return false;
				console.error("Failed to add sound to timeline:", error);
				toast.error(
					error instanceof Error
						? error.message
						: "Failed to add sound to timeline",
					{ id: `sound-${sound.id}` },
				);
				return false;
			}
		},
	}));
}
