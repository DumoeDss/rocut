import type { TitleRiffEngine, TitleRiffReferenceFrame, TitleRiffSong } from "./mv-title-riff-reference-contract";
import type { snapshotTitleRiffAssets } from "./mv-title-riff-reference-assets";

export async function loadTitleRiffFonts(realm: Window & typeof globalThis, engine: TitleRiffEngine,
	fonts: ReturnType<typeof snapshotTitleRiffAssets>["fonts"]) {
	const aliases = { minchoHeavy: "Zen Old Mincho", dot: "DotGothic16", gothic: "Zen Kaku Gothic New", serif: "Noto Serif JP" };
	for (const [alias, family] of Object.entries(aliases)) if (engine.FONT[alias]?.replace(/^"(.*)"$/, "$1") !== family) throw Error("Original titleRiff font mapping changed");
	const loaded = await Promise.all(fonts.map(async (font) => {
		const face = new realm.FontFace(font.family, font.body, { weight: String(font.weight), style: "normal" });
		await face.load(); realm.document.fonts.add(face);
		if (face.status !== "loaded" || !realm.document.fonts.has(face)) throw Error(`FontFace failed: ${font.family}`);
		return { ...font, face };
	}));
	return async (frame: TitleRiffReferenceFrame, song: TitleRiffSong) => {
		const a = frame.args;
		const texts = {
			"Zen Old Mincho": a.glyphs.join(""),
			"DotGothic16": (Object.values(a.hud).join("") + "0123456789ABCDEFXZ#%+=/<>ｱｳｶｻﾀﾅﾊﾏﾗ・:. BAR MAIN TITLE END TITLE · ")
				.replaceAll("Ō", "O").replaceAll("ō", "o"),
			"Zen Kaku Gothic New": (a.ruby === false ? "" : a.ruby.join("")) + song.credit,
			"Noto Serif JP": a.sub,
		};
		return Promise.all(loaded.map(async (font) => {
			const text = texts[font.family as keyof typeof texts], glyphs = font.coverage(text);
			const spec = `${font.weight} 100px "${font.family}"`;
			if (text && (!(await realm.document.fonts.load(spec, text)).includes(font.face) || !realm.document.fonts.check(spec, text))) throw Error(`Exact titleRiff face not ready: ${font.family}`);
			return { id: font.id, family: font.family, weight: font.weight, sha256: font.sha256, byteLength: font.byteLength, mimeType: font.mimeType, identity: font.identity, text, glyphs };
		}));
	};
}
