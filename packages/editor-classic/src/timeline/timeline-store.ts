/**
 * UI state for the timeline
 * For core logic, use EditorCore instead.
 */

import { createStore } from "zustand/vanilla";
import { persist } from "zustand/middleware";

export interface TimelineStore {
	trackHeightScale: number;
	setTrackHeightScale: (scale: number) => void;
	snappingEnabled: boolean;
	toggleSnapping: () => void;
	rippleEditingEnabled: boolean;
	toggleRippleEditing: () => void;
	expandedElementIds: Set<string>;
	toggleElementExpanded: (elementId: string) => void;
}

export function createTimelineStore() {
	return createStore<TimelineStore>()(
		persist(
			(set) => ({
				trackHeightScale: 1,
				setTrackHeightScale: (scale) => {
					if ([0.8, 1, 1.5, 2].includes(scale)) set({ trackHeightScale: scale });
				},
				snappingEnabled: true,

				toggleSnapping: () => {
					set((state) => ({ snappingEnabled: !state.snappingEnabled }));
				},

				rippleEditingEnabled: false,

				toggleRippleEditing: () => {
					set((state) => ({
						rippleEditingEnabled: !state.rippleEditingEnabled,
					}));
				},

				expandedElementIds: new Set<string>(),

				toggleElementExpanded: (elementId) => {
					set((state) => {
						const next = new Set(state.expandedElementIds);
						if (next.has(elementId)) {
							next.delete(elementId);
						} else {
							next.add(elementId);
						}
						return { expandedElementIds: next };
					});
				},
			}),
			{
				name: "timeline-store",
				partialize: (state) => ({
					trackHeightScale: state.trackHeightScale,
					snappingEnabled: state.snappingEnabled,
					rippleEditingEnabled: state.rippleEditingEnabled,
				}),
			},
		),
	);
}
