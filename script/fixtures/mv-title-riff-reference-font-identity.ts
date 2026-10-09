/** Test-only SFNT admission. Never relabel a Black 900 face as Medium 500. */
export function titleRiffFontIdentity(bytes: ArrayBuffer, family: string, weight: number) {
	const view = new DataView(bytes);
	const need = (at: number, length: number, limit = view.byteLength) => {
		if (!Number.isInteger(at) || !Number.isInteger(length) || at < 0 || length < 0 || at + length > limit) throw Error("Truncated titleRiff SFNT identity");
	};
	const u16 = (at: number) => { need(at, 2); return view.getUint16(at); };
	const u32 = (at: number) => { need(at, 4); return view.getUint32(at); };
	if (![0x00010000, 0x4f54544f].includes(u32(0))) throw Error("titleRiff fonts require real uncompressed TTF/OTF bytes");
	const tables = new Map<number, { at: number; length: number }>();
	for (let i = 0, n = u16(4); i < n; i++) {
		const record = 12 + i * 16, tag = u32(record), at = u32(record + 8), length = u32(record + 12);
		need(at, length);
		if (tables.has(tag)) throw Error("Duplicate SFNT identity table");
		tables.set(tag, { at, length });
	}
	const name = tables.get(0x6e616d65), os2 = tables.get(0x4f532f32);
	if (!name || !os2 || name.length < 6 || os2.length < 64) throw Error("Font cannot prove family/weight/style");
	const names = new Set<string>(), limit = name.at + name.length;
	const count = u16(name.at + 2), strings = name.at + u16(name.at + 4);
	need(name.at + 6, count * 12, limit);
	for (let i = 0; i < count; i++) {
		const record = name.at + 6 + i * 12, platform = u16(record), id = u16(record + 6);
		if (![1, 16].includes(id) || ![0, 3].includes(platform)) continue;
		const at = strings + u16(record + 10), length = u16(record + 8);
		need(at, length, limit);
		if (length % 2) throw Error("Invalid UTF-16 SFNT family name");
		names.add(new TextDecoder("utf-16be", { fatal: true }).decode(bytes.slice(at, at + length)));
	}
	if (!names.has(family)) throw Error(`Wrong titleRiff font family: expected ${family}`);
	if (u16(os2.at + 62) & 0x201) throw Error("titleRiff requires normal, not italic/oblique font bytes");
	const staticWeight = u16(os2.at + 4), fvar = tables.get(0x66766172);
	let range: readonly [number, number] | undefined;
	if (fvar) {
		need(fvar.at, 16, fvar.at + fvar.length);
		const start = fvar.at + u16(fvar.at + 4), n = u16(fvar.at + 8), size = u16(fvar.at + 10);
		if (n > 64 || size < 20) throw Error("Invalid variable-font axes");
		need(start, n * size, fvar.at + fvar.length);
		for (let i = 0; i < n; i++) {
			const at = start + i * size;
			if (u32(at) !== 0x77676874) continue;
			if (range) throw Error("Duplicate font weight axis");
			const min = view.getInt32(at + 4) / 65536, def = view.getInt32(at + 8) / 65536, max = view.getInt32(at + 12) / 65536;
			if (!(min <= def && def <= max)) throw Error("Invalid font weight range");
			range = [min, max];
		}
	}
	if (range ? weight < range[0] || weight > range[1] : weight !== staticWeight) throw Error(`Wrong titleRiff font weight: expected ${weight}`);
	return { families: [...names], staticWeight, weightRange: range ?? null };
}
