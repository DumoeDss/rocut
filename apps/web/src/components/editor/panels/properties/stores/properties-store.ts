import { createStore } from "zustand/vanilla";

export interface PropertiesState {
	activeTabPerType: Record<string, string>;
	setActiveTab: (args: { elementType: string; tabId: string }) => void;
	isTransformScaleLocked: boolean;
	setTransformScaleLocked: (args: { locked: boolean }) => void;
}

export function createPropertiesStore() {
	return createStore<PropertiesState>()((set) => ({
		activeTabPerType: {},
		setActiveTab: ({ elementType, tabId }) =>
			set((state) => ({
				activeTabPerType: { ...state.activeTabPerType, [elementType]: tabId },
			})),
		isTransformScaleLocked: false,
		setTransformScaleLocked: ({ locked }) =>
			set({ isTransformScaleLocked: locked }),
	}));
}
