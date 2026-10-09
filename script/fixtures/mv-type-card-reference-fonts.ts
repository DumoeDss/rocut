import { typeCardFontCoverage } from "./mv-type-card-reference-cmap";
import type {
	TypeCardOriginalEngine,
	TypeCardOriginalWindow,
	TypeCardReferenceArgs,
	TypeCardReferenceFont,
} from "./mv-type-card-reference-contract";
import { typeCardReferenceDigest } from "./mv-type-card-reference-realm";

export function typeCardFontFamily(family: string) {
	if (
		typeof family !== "string" ||
		family !== family.trim() ||
		!family ||
		family.length > 128 ||
		!/^[\p{L}\p{N} _-]+$/u.test(family)
	)
		throw Error(
			"typeCard font requires one explicit family, not CSS or a fallback list",
		);
	return family;
}

/** Must run before any await, so hashes and FontFace see the same private bytes. */
export function snapshotTypeCardFonts(fonts: readonly TypeCardReferenceFont[]) {
	if (!Array.isArray(fonts) || fonts.length === 0 || fonts.length > 32)
		throw Error("Supply 1–32 explicit local typeCard font faces");
	const identities = new Set<string>();
	return fonts.map((font) => {
		const family = typeCardFontFamily(font.family),
			weight = font.weight;
		if (!Number.isInteger(weight) || weight < 1 || weight > 1000)
			throw Error("Invalid explicit typeCard font weight");
		const key = `${family.toLowerCase()}|${weight}`;
		if (identities.has(key))
			throw Error("Duplicate explicit typeCard font face");
		identities.add(key);
		if (!(font.bytes instanceof ArrayBuffer) || !font.bytes.byteLength)
			throw Error(`Missing local typeCard font bytes: ${family}`);
		const bytes = font.bytes.slice(0);
		return { family, weight, bytes, coverage: typeCardFontCoverage(bytes) };
	});
}

export async function loadTypeCardFonts(
	realm: TypeCardOriginalWindow,
	fonts: ReturnType<typeof snapshotTypeCardFonts>,
) {
	const loaded = await Promise.all(
		fonts.map(async (font) => {
			const face = new realm.FontFace(font.family, font.bytes, {
				weight: String(font.weight),
				style: "normal",
			});
			await face.load();
			realm.document.fonts.add(face);
			if (face.status !== "loaded" || !realm.document.fonts.has(face))
				throw Error(`Local typeCard FontFace failed: ${font.family}`);
			return {
				...font,
				face,
				sha256: await typeCardReferenceDigest(font.bytes),
			};
		}),
	);
	return {
		async prove(
			engine: Pick<TypeCardOriginalEngine, "FONT">,
			args: TypeCardReferenceArgs,
		) {
			const flicker = args.mode === "flicker";
			const uses = [
				{
					role: "main",
					fam: args.fam || (flicker ? "dela" : "mincho"),
					weight: args.weight || (flicker ? 400 : 500),
					text: args.lines[0] || (flicker ? "救って" : ""),
				},
			];
			if (flicker)
				uses.push({
					role: "morse-label",
					fam: "dot",
					weight: 400,
					text: "SOS",
				});
			else if (args.sub)
				uses.push({
					role: "subtitle",
					fam: "mincho",
					weight: 500,
					text: args.sub,
				});
			return Promise.all(
				uses.map(async ({ role, fam, weight, text }) => {
					const mapped = engine.FONT[fam] || fam;
					const family = typeCardFontFamily(
						mapped.replace(/^"([^"\\]+)"$/, "$1"),
					);
					const font = loaded.find(
						(item) =>
							item.family.toLowerCase() === family.toLowerCase() &&
							item.weight === weight,
					);
					if (!font)
						throw Error(
							`Missing exact local typeCard face: ${family}/${weight}`,
						);
					const glyphs = font.coverage(text),
						spec = `${weight} 100px "${family}"`;
					if (text) {
						const faces = await realm.document.fonts.load(spec, text);
						if (
							!faces.includes(font.face) ||
							!realm.document.fonts.check(spec, text)
						)
							throw Error(
								`typeCard glyph face not loaded: ${family}/${weight}`,
							);
					}
					return { role, family, weight, sha256: font.sha256, text, glyphs };
				}),
			);
		},
	};
}
