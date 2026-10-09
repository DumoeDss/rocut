import type { TitleRiffReferenceFrame, TitleRiffSong } from "./mv-title-riff-reference-contract";

/** Explicit synthetic test song; not product defaults or measured song analysis. */
export const titleRiffTestSong = (): TitleRiffSong => ({
	beats: Array.from({ length: 81 }, (_, i) => i / 2), bpm: 120, downbeatIndex0: 2, credit: "LOCAL ORACLE",
});
export function titleRiffTestFrame(variant: "intro" | "outro", time?: number): TitleRiffReferenceFrame {
	const outro = variant === "outro", shotStart = outro ? 20.25 : 2.25;
	return { time: time ?? shotStart, shotStart, duration: 10,
		args: { variant, char: "character.png", sky: "sky.png", glyphs: ["残", "光"], ruby: ["ざん", "こう"], sub: "afterglow",
			hud: { title: "「残光」 ZANKŌ — afterglow", when: outro ? "DAWN / 夜明け" : "DUSK / 逢魔が時", bpm: "BPM 120 · 4/4", geo: "35°41′N 139°46′E", place: "踏切 No.7 — 上り", len: "00:40" },
			cues: outro ? { sun: 0, hud: 0, hud2: 1, zan: 2, cross: 3, ko: 4, split: 5, neg: -1, sil: -1, lock: 8, exit: 15 }
				: { sun: 0, hud: 1, hud2: 2, zan: 3, cross: 4, ko: 5, split: 6, neg: 7, sil: 8, lock: 12, exit: 15 },
			exit: true, grain: 0.07,
			...(outro ? { final: "dawn.png", recap: [
				{ bg: "sky.png", char: "character.png", view: { zoom: 1.1, x: 0, y: 0, rot: 0 }, h: 1.6, cx: 0, cy: 1.05 },
				{ bg: "dawn.png", view: { zoom: 1.2, x: 0.1, y: -0.1, rot: 0.03 }, h: 1.2, cx: 0, cy: 1.05 },
				{ bg: "sky.png", char: "character.png", view: { zoom: 1, x: -0.1, y: 0.2, rot: -0.02 }, h: 2, cx: 0.15, cy: 1.1 },
			] } : {}),
		},
	};
}
