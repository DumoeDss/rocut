/** Test-only glyph admission, not a text-layout or rendering oracle. */
export function typeCardFontCoverage(bytes: ArrayBuffer) {
	const view = new DataView(bytes);
	const need = (offset: number, length: number, end = view.byteLength) => {
		if (
			!Number.isInteger(offset) ||
			!Number.isInteger(length) ||
			offset < 0 ||
			length < 0 ||
			offset + length > end
		)
			throw Error("Truncated local SFNT font");
	};
	const u16 = (at: number) => {
		need(at, 2);
		return view.getUint16(at);
	};
	const u32 = (at: number) => {
		need(at, 4);
		return view.getUint32(at);
	};
	if (![0x00010000, 0x4f54544f].includes(u32(0)))
		throw Error(
			"typeCard glyph proof requires uncompressed SFNT TTF/OTF bytes",
		);
	const count = u16(4);
	need(12, count * 16);
	const tables = new Map<number, { offset: number; length: number }>();
	for (let i = 0; i < count; i++) {
		const at = 12 + i * 16,
			tag = u32(at),
			offset = u32(at + 8),
			length = u32(at + 12);
		need(offset, length);
		if (tables.has(tag)) throw Error("Duplicate local SFNT table");
		tables.set(tag, { offset, length });
	}
	const cmap = tables.get(0x636d6170),
		maxp = tables.get(0x6d617870);
	if (!cmap || !maxp || maxp.length < 6 || cmap.length < 4)
		throw Error("Local font lacks cmap/maxp glyph proof");
	const glyphCount = u16(maxp.offset + 4),
		end = cmap.offset + cmap.length;
	if (!glyphCount || u16(cmap.offset) !== 0)
		throw Error("Invalid local font glyph/cmap header");
	const records = u16(cmap.offset + 2);
	need(cmap.offset + 4, records * 8, end);
	const candidates: { offset: number; format: number; length: number }[] = [];
	for (let i = 0; i < records; i++) {
		const at = cmap.offset + 4 + i * 8,
			platform = u16(at),
			encoding = u16(at + 2);
		if (
			platform !== 0 &&
			!(platform === 3 && (encoding === 1 || encoding === 10))
		)
			continue;
		const offset = cmap.offset + u32(at + 4);
		need(offset, 4, end);
		const format = u16(offset);
		if (format !== 4 && format !== 12) continue;
		const length =
			format === 12 ? (need(offset, 8, end), u32(offset + 4)) : u16(offset + 2);
		need(offset, length, end);
		candidates.push({ offset, format, length });
	}
	const table =
		candidates.find((item) => item.format === 12) ??
		candidates.find((item) => item.format === 4);
	if (!table) throw Error("Local font has no supported Unicode cmap 4/12");
	const base = table.offset,
		limit = base + table.length;
	let glyph: (codePoint: number) => number;
	if (table.format === 12) {
		need(base, 16, limit);
		const groups = u32(base + 12);
		need(base + 16, groups * 12, limit);
		let previous = -1;
		for (let i = 0; i < groups; i++) {
			const at = base + 16 + i * 12,
				first = u32(at),
				last = u32(at + 4);
			if (first <= previous || last < first || last > 0x10ffff)
				throw Error("Invalid Unicode cmap groups");
			previous = last;
		}
		glyph = (codePoint) => {
			let low = 0,
				high = groups - 1;
			while (low <= high) {
				const mid = (low + high) >>> 1,
					at = base + 16 + mid * 12;
				if (codePoint < u32(at)) high = mid - 1;
				else if (codePoint > u32(at + 4)) low = mid + 1;
				else return u32(at + 8) + codePoint - u32(at);
			}
			return 0;
		};
	} else {
		need(base, 16, limit);
		const twice = u16(base + 6),
			segments = twice / 2;
		if (!twice || twice % 2) throw Error("Invalid Unicode cmap segments");
		need(base, 16 + segments * 8, limit);
		const ends = base + 14,
			starts = ends + twice + 2,
			deltas = starts + twice,
			ranges = deltas + twice;
		let previous = -1;
		for (let i = 0; i < segments; i++) {
			const first = u16(starts + i * 2),
				last = u16(ends + i * 2);
			if (first <= previous || last < first || u16(ranges + i * 2) % 2)
				throw Error("Invalid Unicode cmap segments");
			previous = last;
		}
		glyph = (codePoint) => {
			if (codePoint > 0xffff) return 0;
			for (let i = 0; i < segments; i++) {
				const first = u16(starts + i * 2),
					last = u16(ends + i * 2);
				if (codePoint < first || codePoint > last) continue;
				const delta = u16(deltas + i * 2),
					rangeAt = ranges + i * 2,
					range = u16(rangeAt);
				if (!range) return (codePoint + delta) & 0xffff;
				const at = rangeAt + range + (codePoint - first) * 2;
				if (at < ranges + twice)
					throw Error("Invalid Unicode cmap glyph offset");
				need(at, 2, limit);
				const id = u16(at);
				return id ? (id + delta) & 0xffff : 0;
			}
			return 0;
		};
	}
	return (text: string) =>
		[...new Set([...text].map((character) => character.codePointAt(0)!))].map(
			(codePoint) => {
				if (codePoint >= 0xd800 && codePoint <= 0xdfff)
					throw Error("typeCard text contains a non-scalar surrogate");
				const glyphId = glyph(codePoint);
				if (glyphId <= 0 || glyphId >= glyphCount)
					throw Error(
						`Local font cannot prove glyph U+${codePoint.toString(16).toUpperCase()}; fallback refused`,
					);
				return { codePoint, glyphId };
			},
		);
}
