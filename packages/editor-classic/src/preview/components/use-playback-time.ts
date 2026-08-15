"use client";

import { useCallback, useSyncExternalStore } from "react";
import { useEditorInstance } from "../../editor/use-editor";
import type { MediaTime } from "../../wasm";
import { subscribeToPlaybackTime } from "./playback-time-subscription";

export function usePlaybackTime(): MediaTime {
	const playback = useEditorInstance().playback;
	const subscribe = useCallback(
		(onChange: () => void) => subscribeToPlaybackTime(playback, onChange),
		[playback],
	);
	const getSnapshot = useCallback(
		() => playback.getCurrentTime(),
		[playback],
	);

	return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
