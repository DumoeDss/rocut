import { createStore } from "zustand/vanilla";
import { persist } from "zustand/middleware";
import { PANEL_CONFIG } from "../panels/layout";

export interface PanelSizes {
	tools: number;
	preview: number;
	properties: number;
	mainContent: number;
	timeline: number;
}

export type PanelId = keyof PanelSizes;

export interface PanelState {
	panels: PanelSizes;
	hasCustomHorizontalLayout: boolean;
	compactLayout: number[] | null;
	setPanel: (args: { panel: PanelId; size: number }) => void;
	setPanels: (sizes: Partial<PanelSizes>) => void;
	setCompactLayout: (sizes: readonly number[]) => void;
	resetPanels: () => void;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function readCompactLayout(value: unknown): number[] | null {
	if (
		!Array.isArray(value) ||
		value.length !== 3 ||
		!value.every(
			(size: unknown): size is number =>
				typeof size === "number" && Number.isFinite(size) && size > 0,
		) ||
		Math.abs(value.reduce((sum, size) => sum + size, 0) - 100) > 0.01
	)
		return null;
	return [...value];
}

function readSavedSize({
	state,
	keys,
	fallback,
}: {
	state: Record<string, unknown>;
	keys: string[];
	fallback: number;
}) {
	for (const key of keys) {
		const value = state[key];
		if (typeof value === "number" && Number.isFinite(value)) return value;
	}
	return fallback;
}

export function createPanelStore() {
	return createStore<PanelState>()(
		persist(
			(set) => ({
				panels: { ...PANEL_CONFIG.panels },
				hasCustomHorizontalLayout: false,
				compactLayout: null,
				setPanel: ({ panel, size }) =>
					set((state) => ({
						hasCustomHorizontalLayout:
							state.hasCustomHorizontalLayout ||
							["tools", "preview", "properties"].includes(panel),
						panels: {
							...state.panels,
							[panel]: size,
						},
					})),
				setPanels: (sizes) =>
					set((state) => ({
						hasCustomHorizontalLayout:
							state.hasCustomHorizontalLayout ||
							[sizes.tools, sizes.preview, sizes.properties].some(
								(size) => size !== undefined,
							),
						panels: {
							...state.panels,
							...sizes,
						},
					})),
				setCompactLayout: (sizes) => {
					const compactLayout = readCompactLayout(sizes);
					if (compactLayout) set({ compactLayout });
				},
				resetPanels: () =>
					set({
						...PANEL_CONFIG,
						hasCustomHorizontalLayout: false,
						compactLayout: null,
					}),
			}),
			{
				name: "panel-sizes",
				version: 4,
				migrate: (persistedState) => {
					if (!isRecord(persistedState))
						return {
							panels: { ...PANEL_CONFIG.panels },
							hasCustomHorizontalLayout: false,
							compactLayout: null,
						};

					const state = isRecord(persistedState.panels)
						? persistedState.panels
						: persistedState;
					return {
						hasCustomHorizontalLayout:
							typeof persistedState.hasCustomHorizontalLayout === "boolean"
								? persistedState.hasCustomHorizontalLayout
								: true,
						compactLayout: readCompactLayout(persistedState.compactLayout),
						panels: {
							tools: readSavedSize({
								state,
								keys: ["tools", "toolsPanel"],
								fallback: PANEL_CONFIG.panels.tools,
							}),
							preview: readSavedSize({
								state,
								keys: ["preview", "previewPanel"],
								fallback: PANEL_CONFIG.panels.preview,
							}),
							properties: readSavedSize({
								state,
								keys: ["properties", "propertiesPanel"],
								fallback: PANEL_CONFIG.panels.properties,
							}),
							mainContent: readSavedSize({
								state,
								keys: ["mainContent"],
								fallback: PANEL_CONFIG.panels.mainContent,
							}),
							timeline: readSavedSize({
								state,
								keys: ["timeline"],
								fallback: PANEL_CONFIG.panels.timeline,
							}),
						},
					};
				},
				merge: (persistedState, currentState) => ({
					...currentState,
					...(isRecord(persistedState) ? persistedState : {}),
					compactLayout: readCompactLayout(
						isRecord(persistedState) ? persistedState.compactLayout : null,
					),
				}),
				partialize: (state) => ({
					panels: state.panels,
					hasCustomHorizontalLayout: state.hasCustomHorizontalLayout,
					compactLayout: state.compactLayout,
				}),
			},
		),
	);
}
