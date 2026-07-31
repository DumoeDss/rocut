"use client";

import { useStore } from "zustand";

import type { KeybindingsState } from "@/actions/keybindings-store";
import type { AssetsPanelStore } from "@/components/editor/panels/assets/assets-panel-store";
import type { PropertiesState } from "@/components/editor/panels/properties/stores/properties-store";
import {
	storesForSession,
	type EditorSessionStoreKey,
	type EditorSessionStores,
} from "@/editor/runtime/session-stores";
import { useEditorSession } from "@/editor/session/editor-session-provider";
import type { EditorState } from "@/editor/editor-store";
import type { PanelState } from "@/editor/panel-store";
import type { PreviewState } from "@/preview/preview-store";
import type { SoundsStore } from "@/sounds/sounds-store";
import type { StickersStore } from "@/stickers/stickers-store";
import type { TimelineStore } from "@/timeline/timeline-store";

export {
	TAB_KEYS,
	tabs,
} from "@/components/editor/panels/assets/assets-panel-store";
export type {
	MediaSortKey,
	MediaSortOrder,
	MediaViewMode,
	Tab,
} from "@/components/editor/panels/assets/assets-panel-store";

type StoreState<Key extends EditorSessionStoreKey> =
	EditorSessionStores[Key] extends {
		getState(): infer State;
	}
		? State
		: never;

function useOwnedStore<Key extends EditorSessionStoreKey, Selected>({
	key,
	selector,
}: {
	key: Key;
	selector: (state: StoreState<Key>) => Selected;
}): Selected {
	const session = useEditorSession();
	return useStore(storesForSession(session)[key], selector);
}

const identity = <State>(state: State): State => state;

export function usePanelStore<Selected = PanelState>(
	selector: (state: PanelState) => Selected = identity as (
		state: PanelState,
	) => Selected,
): Selected {
	return useOwnedStore({ key: "panel", selector });
}

export function useEditorStore<Selected = EditorState>(
	selector: (state: EditorState) => Selected = identity as (
		state: EditorState,
	) => Selected,
): Selected {
	return useOwnedStore({ key: "editor", selector });
}

export function usePreviewStore<Selected = PreviewState>(
	selector: (state: PreviewState) => Selected = identity as (
		state: PreviewState,
	) => Selected,
): Selected {
	return useOwnedStore({ key: "preview", selector });
}

export function useTimelineStore<Selected = TimelineStore>(
	selector: (state: TimelineStore) => Selected = identity as (
		state: TimelineStore,
	) => Selected,
): Selected {
	return useOwnedStore({ key: "timeline", selector });
}

export function useSoundsStore<Selected = SoundsStore>(
	selector: (state: SoundsStore) => Selected = identity as (
		state: SoundsStore,
	) => Selected,
): Selected {
	return useOwnedStore({ key: "sounds", selector });
}

export function useStickersStore<Selected = StickersStore>(
	selector: (state: StickersStore) => Selected = identity as (
		state: StickersStore,
	) => Selected,
): Selected {
	return useOwnedStore({ key: "stickers", selector });
}

export function useKeybindingsStore<Selected = KeybindingsState>(
	selector: (state: KeybindingsState) => Selected = identity as (
		state: KeybindingsState,
	) => Selected,
): Selected {
	return useOwnedStore({ key: "keybindings", selector });
}

export function usePropertiesStore<Selected = PropertiesState>(
	selector: (state: PropertiesState) => Selected = identity as (
		state: PropertiesState,
	) => Selected,
): Selected {
	return useOwnedStore({ key: "properties", selector });
}

export function useAssetsPanelStore<Selected = AssetsPanelStore>(
	selector: (state: AssetsPanelStore) => Selected = identity as (
		state: AssetsPanelStore,
	) => Selected,
): Selected {
	return useOwnedStore({ key: "assetsPanel", selector });
}
