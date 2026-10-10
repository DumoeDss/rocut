import { snapshotTypeCardFonts } from "./mv-type-card-reference-fonts";
/** The unchanged stack deliberately falls back to Noto Serif JP for Ō.
 * Prove every scalar against explicit local bytes; never drop/replace glyphs. */
export function splitTunnelGlyphCoverage({
	fonts,
	family,
	weight,
	text,
}: {
	fonts: ReturnType<typeof snapshotTypeCardFonts>;
	family: string;
	weight: number;
	text: string;
}) {
	const primary = fonts.find((f) => f.family === family && f.weight === weight),
		fallback = fonts.find(
			(f) => f.family === "Noto Serif JP" && f.weight === weight,
		);
	if (!primary || !fallback)
		throw Error("Missing primary/explicit original fallback face");
	let primaryText = "",
		fallbackText = "";
	for (const ch of new Set([...text])) {
		try {
			primary.coverage(ch);
			primaryText += ch;
		} catch {
			fallback.coverage(ch);
			fallbackText += ch;
		}
	}
	return { primaryText, fallbackText };
}
