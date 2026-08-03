"use client";

import { createStore } from "zustand/vanilla";
import { generateUUID } from "@/utils/id";
import type { NormalizedCubicBezier } from "@/animation/types";
import type { EasingPreset } from "./easing-presets";

const PRESET_NAMESPACE = "graph-editor-presets";
const PRESET_KEY = "user-presets";
const PRESET_SCHEMA_VERSION = 1;

interface CustomPresetPersistence {
	loadLibraryRecord(args: {
		namespace: string;
		key: string;
		decode: (data: unknown) => EasingPreset[];
	}): Promise<{ data: EasingPreset[] } | null>;
	mutateLibraryRecord(args: {
		namespace: string;
		key: string;
		schemaVersion: number;
		decode: (data: unknown) => EasingPreset[];
		encode: (data: EasingPreset[]) => unknown;
		mutate: (
			current: EasingPreset[] | null,
		) => EasingPreset[] | Promise<EasingPreset[]>;
	}): Promise<EasingPreset[]>;
}

type PersistenceGetter = () => CustomPresetPersistence;

export interface CustomPresetPersistenceFailure {
	readonly library: "graph-editor-presets";
	readonly operation: "load" | "save" | "remove";
	readonly code: string;
}

export interface CustomPresetsStore {
	presets: EasingPreset[];
	isLoading: boolean;
	hasLoaded: boolean;
	error: string | null;
	load: () => Promise<void>;
	savePreset: (args: { value: NormalizedCubicBezier }) => Promise<void>;
	removePreset: (args: { id: string }) => Promise<void>;
}

export function createCustomPresetsStore({
	getPersistence,
	isDisposed = () => false,
	reportPersistenceFailure = () => {},
}: {
	getPersistence: PersistenceGetter;
	isDisposed?: () => boolean;
	reportPersistenceFailure?: (failure: CustomPresetPersistenceFailure) => void;
}) {
	let mutationTail: Promise<void> = Promise.resolve();
	let loadGeneration = 0;
	const serialize = (mutation: () => Promise<void>) => {
		const result = mutationTail.then(mutation);
		mutationTail = result.catch(() => {});
		return result;
	};
	const loadDurable = async () => {
		const record = await getPersistence().loadLibraryRecord({
			namespace: PRESET_NAMESPACE,
			key: PRESET_KEY,
			decode: decodePresetArray,
		});
		return record?.data ?? [];
	};
	const mutateDurable = (mutate: (current: EasingPreset[]) => EasingPreset[]) =>
		getPersistence().mutateLibraryRecord({
			namespace: PRESET_NAMESPACE,
			key: PRESET_KEY,
			schemaVersion: PRESET_SCHEMA_VERSION,
			decode: decodePresetArray,
			encode: (presets) => ({ presets }),
			mutate: (current) => mutate(current ?? []),
		});
	const failure = ({
		operation,
		error,
	}: {
		operation: CustomPresetPersistenceFailure["operation"];
		error: unknown;
	}) => {
		reportPersistenceFailure({
			library: "graph-editor-presets",
			operation,
			code: readFailureCode(error),
		});
		return "Custom presets could not be persisted. Retry the operation.";
	};

	return createStore<CustomPresetsStore>()((set) => ({
		presets: [],
		isLoading: false,
		hasLoaded: false,
		error: null,

		load: async () => {
			const generation = ++loadGeneration;
			const canPublish = () => !isDisposed() && generation === loadGeneration;
			set({ isLoading: true, error: null });
			try {
				const presets = await loadDurable();
				if (!canPublish()) return;
				set({ presets, hasLoaded: true });
			} catch (error) {
				if (canPublish()) {
					set({ error: failure({ operation: "load", error }) });
				}
				throw error;
			} finally {
				if (canPublish()) set({ isLoading: false });
			}
		},

		savePreset: ({ value }) => {
			loadGeneration += 1;
			if (!isDisposed()) set({ isLoading: false });
			return serialize(async () => {
				try {
					const presets = await mutateDurable((current) => [
						...current,
						{
							id: generateUUID(),
							label: `Custom ${current.length + 1}`,
							value: [...value] as NormalizedCubicBezier,
							isCustom: true,
						},
					]);
					if (!isDisposed()) {
						set({ presets, hasLoaded: true, error: null });
					}
				} catch (error) {
					if (!isDisposed()) {
						set({ error: failure({ operation: "save", error }) });
					}
					throw error;
				}
			});
		},

		removePreset: ({ id }) => {
			loadGeneration += 1;
			if (!isDisposed()) set({ isLoading: false });
			return serialize(async () => {
				try {
					const presets = await mutateDurable((current) =>
						current.filter((preset) => preset.id !== id),
					);
					if (!isDisposed()) {
						set({ presets, hasLoaded: true, error: null });
					}
				} catch (error) {
					if (!isDisposed()) {
						set({ error: failure({ operation: "remove", error }) });
					}
					throw error;
				}
			});
		},
	}));
}

function decodePresetArray(data: unknown): EasingPreset[] {
	if (typeof data !== "object" || data === null || !("presets" in data)) {
		return [];
	}
	const presets = (data as { presets?: unknown }).presets;
	if (!Array.isArray(presets)) return [];
	return presets.filter(isValidPreset);
}

function isValidPreset(value: unknown): value is EasingPreset {
	if (typeof value !== "object" || value === null) return false;
	const preset = value as Partial<EasingPreset>;
	return (
		typeof preset.id === "string" &&
		typeof preset.label === "string" &&
		Array.isArray(preset.value) &&
		preset.value.length === 4 &&
		preset.value.every((number: unknown) => typeof number === "number")
	);
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
