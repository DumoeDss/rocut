import { expect, test } from "bun:test";
import { typeCardFontCoverage } from "./mv-type-card-reference-cmap";

// Minimal binary fixtures exercise glyph admission only, never browser font rendering.
function sfnt(subtables: Uint8Array[]) {
	const header = 4 + subtables.length * 8;
	const bytes = new Uint8Array(
		50 + header + subtables.reduce((total, item) => total + item.length, 0),
	);
	const view = new DataView(bytes.buffer);
	view.setUint32(0, 0x00010000);
	view.setUint16(4, 2);
	view.setUint32(12, 0x6d617870);
	view.setUint32(20, 44);
	view.setUint32(24, 6);
	view.setUint32(28, 0x636d6170);
	view.setUint32(36, 50);
	view.setUint32(40, bytes.length - 50);
	view.setUint32(44, 0x00010000);
	view.setUint16(48, 16);
	view.setUint16(52, subtables.length);
	let cursor = header;
	for (const [index, table] of subtables.entries()) {
		const record = 54 + index * 8;
		view.setUint16(record, 3);
		view.setUint16(record + 2, table[1] === 12 ? 10 : 1);
		view.setUint32(record + 4, cursor);
		bytes.set(table, 50 + cursor);
		cursor += table.length;
	}
	return bytes.buffer;
}

function format4() {
	const bytes = new Uint8Array(44),
		view = new DataView(bytes.buffer);
	view.setUint16(0, 4);
	view.setUint16(2, bytes.length);
	view.setUint16(6, 6);
	[67, 70, 65535].forEach((value, index) =>
		view.setUint16(14 + index * 2, value),
	);
	[65, 69, 65535].forEach((value, index) =>
		view.setUint16(22 + index * 2, value),
	);
	[1 - 65, 3, 1].forEach((value, index) =>
		view.setUint16(28 + index * 2, value & 0xffff),
	);
	view.setUint16(36, 4);
	view.setUint16(40, 0);
	view.setUint16(42, 7);
	return bytes;
}

function format12() {
	const bytes = new Uint8Array(40),
		view = new DataView(bytes.buffer);
	view.setUint16(0, 12);
	view.setUint32(4, bytes.length);
	view.setUint32(12, 2);
	view.setUint32(16, 65);
	view.setUint32(20, 66);
	view.setUint32(24, 1);
	view.setUint32(28, 0x1f600);
	view.setUint32(32, 0x1f600);
	view.setUint32(36, 3);
	return bytes;
}

test("cmap4 applies delta, range-offset delta and glyph-zero semantics", () => {
	const cover = typeCardFontCoverage(sfnt([format4()]));
	expect(cover("ABCFAB")).toEqual([
		{ codePoint: 65, glyphId: 1 },
		{ codePoint: 66, glyphId: 2 },
		{ codePoint: 67, glyphId: 3 },
		{ codePoint: 70, glyphId: 10 },
	]);
	for (const text of ["D", "E", "\uffff", "\u{1f600}"])
		expect(() => cover(text)).toThrow("fallback refused");
});

test("cmap12 supports non-BMP Unicode and takes precedence over cmap4", () => {
	const cover = typeCardFontCoverage(sfnt([format4(), format12()]));
	expect(cover("AB\u{1f600}")).toEqual([
		{ codePoint: 65, glyphId: 1 },
		{ codePoint: 66, glyphId: 2 },
		{ codePoint: 0x1f600, glyphId: 3 },
	]);
	expect(() => cover("C")).toThrow("fallback refused");
});

test("cmap admission rejects malformed lengths, groups, segments and glyph offsets", () => {
	for (const [offset, value] of [
		[2, 14],
		[6, 5],
		[24, 66],
		[16, 68],
		[36, 3],
	] as const) {
		const table = format4();
		new DataView(table.buffer).setUint16(offset, value);
		expect(() => typeCardFontCoverage(sfnt([table]))).toThrow();
	}
	const beforeGlyphArray = format4();
	new DataView(beforeGlyphArray.buffer).setUint16(36, 2);
	expect(() => typeCardFontCoverage(sfnt([beforeGlyphArray]))("E")).toThrow(
		"glyph offset",
	);
	const beyondSubtable = format4();
	new DataView(beyondSubtable.buffer).setUint16(36, 100);
	expect(() => typeCardFontCoverage(sfnt([beyondSubtable]))("E")).toThrow(
		"Truncated",
	);
	const invalidGlyph = format4();
	new DataView(invalidGlyph.buffer).setUint16(42, 16);
	expect(() => typeCardFontCoverage(sfnt([invalidGlyph]))("F")).toThrow(
		"fallback refused",
	);
	for (const [offset, value] of [
		[4, 15],
		[12, 10],
		[28, 65],
		[32, 0x110000],
	] as const) {
		const table = format12();
		new DataView(table.buffer).setUint32(offset, value);
		expect(() => typeCardFontCoverage(sfnt([table]))).toThrow();
	}
	const badTable = sfnt([format12()]);
	new DataView(badTable).setUint32(36, badTable.byteLength);
	expect(() => typeCardFontCoverage(badTable)).toThrow("Truncated");
	const duplicate = sfnt([format12()]);
	new DataView(duplicate).setUint32(28, 0x6d617870);
	expect(() => typeCardFontCoverage(duplicate)).toThrow("Duplicate");
});
