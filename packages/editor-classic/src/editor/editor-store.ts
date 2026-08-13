import { createStore } from "zustand/vanilla";
import { DEFAULT_CANVAS_PRESETS } from "../canvas/sizes";
import type { TCanvasSize } from "../project/types";

export interface EditorState {
	isInitializing: boolean;
	isPanelsReady: boolean;
	canvasPresets: TCanvasSize[];
	setInitializing: (loading: boolean) => void;
	setPanelsReady: (ready: boolean) => void;
	initializeApp: () => Promise<void>;
}

export function createEditorStore() {
	return createStore<EditorState>()((set) => ({
		isInitializing: true,
		isPanelsReady: false,
		canvasPresets: DEFAULT_CANVAS_PRESETS.map((preset) => ({ ...preset })),
		setInitializing: (loading) => set({ isInitializing: loading }),
		setPanelsReady: (ready) => set({ isPanelsReady: ready }),
		initializeApp: async () => {
			set({ isInitializing: true, isPanelsReady: false });
			set({ isPanelsReady: true, isInitializing: false });
		},
	}));
}
