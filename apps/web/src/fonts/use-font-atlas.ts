import { useState, useMemo, useCallback, useEffect } from "react";
import {
	getCachedFontAtlas,
	loadFontAtlas,
	clearFontAtlasCache,
} from "@/fonts/google-fonts";
import type { FontAtlas } from "@/fonts/types";
import { SYSTEM_FONTS } from "@/fonts/system-fonts";
import { useEditorSession } from "@/editor/session/editor-session-provider";

type Status = "idle" | "loading" | "error";

export function useFontAtlas({ open }: { open: boolean }) {
	const session = useEditorSession();
	const loader = session.host.assetLoader;
	const resolver = session.host.assets;
	const [atlas, setAtlas] = useState<FontAtlas | null>(() =>
		getCachedFontAtlas({ loader }),
	);
	const [status, setStatus] = useState<Status>(() =>
		getCachedFontAtlas({ loader }) ? "idle" : "loading",
	);

	useEffect(() => {
		if (!open || atlas) return;

		setStatus("loading");
		loadFontAtlas({ loader, resolver }).then((data) => {
			if (data) {
				setAtlas(data);
				setStatus("idle");
			} else {
				setStatus("error");
			}
		});
	}, [open, atlas, loader, resolver]);

	const retry = useCallback(() => {
		clearFontAtlasCache({ loader });
		setStatus("loading");
		loadFontAtlas({ loader, resolver }).then((data) => {
			if (data) {
				setAtlas(data);
				setStatus("idle");
			} else {
				setStatus("error");
			}
		});
	}, [loader, resolver]);

	const fontNames = useMemo(() => {
		if (!atlas) return [];
		return [...Object.keys(atlas.fonts), ...SYSTEM_FONTS].sort();
	}, [atlas]);

	return { atlas, status, fontNames, retry };
}
