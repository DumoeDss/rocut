import { createStore } from "zustand/vanilla";
import type { SoundEffect, SavedSound } from "@/sounds/types";
import { toast } from "sonner";
import type { EditorCore } from "@/core";
import { buildLibraryAudioElement } from "@/timeline/element-utils";
import { mediaTimeFromSeconds } from "@/wasm";

const SAVED_SOUNDS_NAMESPACE = "saved-sounds";
const SAVED_SOUNDS_KEY = "user-sounds";
const SAVED_SOUNDS_SCHEMA_VERSION = 1;

export interface LibraryPersistenceFailure {
	readonly library: "saved-sounds";
	readonly operation: "load" | "save" | "remove" | "clear";
	readonly code: string;
}

interface SavedSoundsPersistence {
	loadLibraryRecord(args: {
		namespace: string;
		key: string;
		decode: (data: unknown) => SavedSound[];
	}): Promise<{ data: SavedSound[] } | null>;
	mutateLibraryRecord(args: {
		namespace: string;
		key: string;
		schemaVersion: number;
		decode: (data: unknown) => SavedSound[];
		encode: (data: SavedSound[]) => unknown;
		mutate: (
			current: SavedSound[] | null,
		) => SavedSound[] | Promise<SavedSound[]>;
	}): Promise<SavedSound[]>;
	clearLibraryNamespace(args: { namespace: string }): Promise<void>;
}

type PersistenceGetter = () => SavedSoundsPersistence;

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
	getPersistence,
	reportPersistenceFailure = () => {},
}: {
	isDisposed?: () => boolean;
	getPersistence?: PersistenceGetter;
	reportPersistenceFailure?: (failure: LibraryPersistenceFailure) => void;
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
	const persistence = () => {
		if (!getPersistence) {
			throw new Error(
				"Saved sounds require the owning session persistence coordinator",
			);
		}
		return getPersistence();
	};
	const decodeSavedSounds = (data: unknown): SavedSound[] => {
		if (typeof data !== "object" || data === null || !("sounds" in data)) {
			return [];
		}
		const sounds = (data as { sounds?: unknown }).sounds;
		if (!Array.isArray(sounds)) return [];
		return sounds.filter(isSavedSound);
	};
	const loadSavedSoundsRecord = async (): Promise<SavedSound[]> => {
		const record = await persistence().loadLibraryRecord({
			namespace: SAVED_SOUNDS_NAMESPACE,
			key: SAVED_SOUNDS_KEY,
			decode: decodeSavedSounds,
		});
		return record?.data ?? [];
	};
	const mutateSavedSoundsRecord = (
		mutate: (current: SavedSound[]) => SavedSound[],
	) =>
		persistence().mutateLibraryRecord({
			namespace: SAVED_SOUNDS_NAMESPACE,
			key: SAVED_SOUNDS_KEY,
			schemaVersion: SAVED_SOUNDS_SCHEMA_VERSION,
			decode: decodeSavedSounds,
			encode: (sounds) => ({
				sounds,
				lastModified: new Date().toISOString(),
			}),
			mutate: (current) => mutate(current ?? []),
		});
	const publishFailure = ({
		operation,
		error,
	}: {
		operation: LibraryPersistenceFailure["operation"];
		error: unknown;
	}) => {
		const code = readFailureCode(error);
		reportPersistenceFailure({
			library: "saved-sounds",
			operation,
			code,
		});
		return "Saved sounds could not be persisted. Retry the operation.";
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
				const savedSounds = await loadSavedSoundsRecord();
				if (!canPublishRequest({ token })) return;
				set({
					savedSounds,
					isSavedSoundsLoaded: true,
				});
			} catch (error) {
				if (canPublishRequest({ token })) {
					const errorMessage = publishFailure({ operation: "load", error });
					set({
						savedSoundsError: errorMessage,
					});
					toast.error(errorMessage);
				}
				throw error;
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
					const savedSound = toSavedSound(soundEffect);
					const savedSounds = await mutateSavedSoundsRecord((current) =>
						current.some((sound) => sound.id === soundEffect.id)
							? current
							: [...current, savedSound],
					);
					if (isDisposed()) return;
					set({
						savedSounds,
						isSavedSoundsLoaded: true,
						savedSoundsError: null,
					});
				} catch (error) {
					if (!isDisposed()) {
						const errorMessage = publishFailure({ operation: "save", error });
						set({ savedSoundsError: errorMessage });
						toast.error(errorMessage);
					}
					throw error;
				}
			});
		},

		removeSavedSound: ({ soundId }) => {
			generations.savedLoad += 1;
			set({ isLoadingSavedSounds: false });
			return serializeSavedMutation(async () => {
				try {
					const savedSounds = await mutateSavedSoundsRecord((current) =>
						current.filter((sound) => sound.id !== soundId),
					);
					if (isDisposed()) return;
					set({
						savedSounds,
						isSavedSoundsLoaded: true,
						savedSoundsError: null,
					});
				} catch (error) {
					if (!isDisposed()) {
						const errorMessage = publishFailure({ operation: "remove", error });
						set({ savedSoundsError: errorMessage });
						toast.error(errorMessage);
					}
					throw error;
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
					await persistence().clearLibraryNamespace({
						namespace: SAVED_SOUNDS_NAMESPACE,
					});
					if (isDisposed()) return;
					set({
						savedSounds: [],
						isSavedSoundsLoaded: true,
						savedSoundsError: null,
					});
				} catch (error) {
					if (!isDisposed()) {
						const errorMessage = publishFailure({ operation: "clear", error });
						set({ savedSoundsError: errorMessage });
						toast.error(errorMessage);
					}
					throw error;
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

function isSavedSound(value: unknown): value is SavedSound {
	if (typeof value !== "object" || value === null) return false;
	const sound = value as Partial<SavedSound>;
	return (
		typeof sound.id === "number" &&
		typeof sound.name === "string" &&
		typeof sound.username === "string" &&
		typeof sound.duration === "number" &&
		Array.isArray(sound.tags) &&
		sound.tags.every((tag) => typeof tag === "string") &&
		typeof sound.license === "string" &&
		typeof sound.savedAt === "string"
	);
}

function toSavedSound(soundEffect: SoundEffect): SavedSound {
	return {
		id: soundEffect.id,
		name: soundEffect.name,
		username: soundEffect.username,
		previewUrl: soundEffect.previewUrl,
		downloadUrl: soundEffect.downloadUrl,
		duration: soundEffect.duration,
		tags: [...soundEffect.tags],
		license: soundEffect.license,
		savedAt: new Date().toISOString(),
	};
}

function readFailureCode(error: unknown): string {
	if (typeof error !== "object" || error === null || !("code" in error)) {
		return "unknown";
	}
	switch (error.code) {
		case "aborted":
		case "quota-exceeded":
		case "unavailable":
		case "corrupt":
		case "conflict":
			return error.code;
		default:
			return "unknown";
	}
}
