import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
	inspectMotionTextFont,
	inspectMotionTextFontCoverage,
} from "./motion-text-font";

test("real WASM coverage preserves glyph/face checks without returning an authentication digest", () => {
	const bytes = new Uint8Array(
		readFileSync(
			new URL(
				"../../../../apps/web/public/motion-text/fonts/ibm-plex-mono-medium.ttf",
				import.meta.url,
			),
		),
	);
	const options = { bytes, text: "HELLO\n\t\u{10FFFF}\u{10FFFF}\u{10FFFE}" };
	const full = inspectMotionTextFont(options);
	const coverage = inspectMotionTextFontCoverage(options);
	expect(full.error).toBeNull();
	expect(coverage.error).toBeNull();
	expect(full.inspection?.contentDigest).toMatch(/^sha256:[a-f0-9]{64}$/);
	expect(coverage.inspection).toEqual({
		faceIndex: full.inspection?.faceIndex,
		glyphCount: full.inspection?.glyphCount,
		missingCodePoints: [0x10fffe, 0x10ffff],
	});
	expect(coverage.inspection).not.toHaveProperty("contentDigest");
	expect(
		inspectMotionTextFontCoverage({ ...options, faceIndex: 0xffffffff })
			.inspection,
	).toBeNull();
	expect(
		inspectMotionTextFontCoverage({ bytes: new Uint8Array([1, 2]), text: "A" })
			.error,
	).toMatch(/^invalid-font:/);
});
