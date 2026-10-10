import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import {
	TUNNEL_FONTS,
	TUNNEL_LATIN,
	TUNNEL_DEFAULT_WORDS,
	TUNNEL_PIXEL_NEGATIVES,
	TUNNEL_POST_NEGATIVES,
	tunnelMatrix,
} from "./mv-tunnel-matrix";
import { snapshotTunnelInput } from "./mv-tunnel-input";
import { titleRiffFontIdentity } from "./mv-title-riff-reference-font-identity";
import { typeCardFontCoverage } from "./mv-type-card-reference-cmap";
import { snapshotTypeCardFonts } from "./mv-type-card-reference-fonts";
import { splitTunnelGlyphCoverage } from "./mv-tunnel-fonts";

test("tunnel matrix has full 360-frame forward run and426 observations/26 repeated seeks", () => {
	const matrix = tunnelMatrix();
	expect(matrix.flatMap((c) => c.indices)).toHaveLength(426);
	expect(matrix[0]!.indices.slice(0, 360)).toEqual(
		Array.from({ length: 360 }, (_, i) => i),
	);
	let repeats = 0;
	for (const c of matrix) {
		const prior = new Set<number>();
		for (const index of c.indices) {
			expect(index).toBeGreaterThanOrEqual(0);
			expect(index).toBeLessThan(c.frame.duration * 60);
			snapshotTunnelInput({ ...c.frame, time: c.frame.shotStart + index / 60 });
			if (prior.has(index)) repeats++;
			else prior.add(index);
		}
	}
	expect(repeats).toBe(26);
	expect(matrix.some((c) => c.frame.args.plan !== undefined)).toBe(true);
	expect(matrix.some((c) => c.frame.args.fadeIn === 0)).toBe(true);
});
test("tunnel negatives cover all original layer families and separate dedicatedpost", () => {
	const names: readonly string[] = TUNNEL_PIXEL_NEGATIVES.map((c) => c.name);
	for (const name of [
		"background",
		"edge-fog",
		"core",
		"rings",
		"latin",
		"dial",
		"circle",
		"frame",
		"cross",
		"dust",
		"anamorphic",
		"dawn",
		"title",
		"subtitle",
		"vignette",
		"grain",
		"fade",
		"perspective",
		"real-advance",
		"repair-rays-quirk",
	])
		expect(names).toContain(name);
	expect(TUNNEL_POST_NEGATIVES).toHaveLength(6);
});
test("tunnel admission snapshots args/clock and rejects malformed parameter expansion", () => {
	const frame = tunnelMatrix()[0]!.frame;
	const copy = snapshotTunnelInput(frame);
	expect(copy).not.toBe(frame);
	expect(copy.beats).not.toBe(frame.beats);
	for (const args of [
		{ unknown: true },
		{ words: [] },
		{ plan: [] },
		{ v0: 0 },
		{ fadeIn: -1 },
		{ words: ["\u0000"] },
	])
		expect(() => snapshotTunnelInput({ ...frame, args })).toThrow();
	expect(() => snapshotTunnelInput({ ...frame, beats: [0, 0] })).toThrow();
});
test("actual local tunnel bytes prove real primary/fallback family/weight and all original glyphs", async () => {
	const fonts = snapshotTypeCardFonts(
		await Promise.all(
			TUNNEL_FONTS.map(async (role) => {
				const bytes = Uint8Array.from(
					await readFile(
						new URL(
							`../../apps/web/public/motion-text/fonts/${role.file}`,
							import.meta.url,
						),
					),
				).buffer;
				const identity = titleRiffFontIdentity(bytes, role.family, role.weight);
				expect(identity.families).toContain(role.family);
				expect(() => titleRiffFontIdentity(bytes, role.family, 1200)).toThrow();
				return { family: role.family, weight: role.weight, bytes };
			}),
		),
	);
	for (const role of TUNNEL_FONTS.filter((f) => f.family !== "Noto Serif JP")) {
		const text =
			role.weight === 800
				? TUNNEL_DEFAULT_WORDS.join("") + "　・A夜"
				: role.weight === 900
					? "残光"
					: TUNNEL_LATIN.join("") + "   ·   ";
		const split = splitTunnelGlyphCoverage({
			fonts,
			family: role.family,
			weight: role.weight,
			text,
		});
		expect(split.primaryText.length).toBeGreaterThan(0);
		if (role.family === "DotGothic16") {
			expect(split.fallbackText).toContain("Ō");
			expect(() =>
				typeCardFontCoverage(
					fonts.find((f) => f.family === role.family)!.bytes,
				)("Ō"),
			).toThrow();
		}
	}
});
