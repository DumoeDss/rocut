import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

/** Test-only derivative of this repository's OFL font, never a system font.
 * Rename the real variation axis so a weight-only implementation cannot pass.
 * It is generated in the owned temporary project, not shipped as a new asset.
 */
export async function variableFontFixture(tag: string) {
	assert.equal(Buffer.byteLength(tag, "ascii"), 4);
	const bytes = await readFile(
		fileURLToPath(
			new URL(
				"../../apps/web/public/motion-text/fonts/noto-sans-jp-variable.ttf",
				import.meta.url,
			),
		),
	);
	const tables = new Map<
		string,
		{ record: number; offset: number; length: number }
	>();
	for (let index = 0; index < bytes.readUInt16BE(4); index++) {
		const record = 12 + index * 16;
		tables.set(bytes.toString("ascii", record, record + 4), {
			record,
			offset: bytes.readUInt32BE(record + 8),
			length: bytes.readUInt32BE(record + 12),
		});
	}
	const fvar = tables.get("fvar")!,
		stat = tables.get("STAT")!,
		head = tables.get("head")!;
	assert.ok(fvar && stat && head && tables.has("gvar"));
	assert.equal(bytes.readUInt16BE(fvar.offset + 8), 1);
	const axis = fvar.offset + bytes.readUInt16BE(fvar.offset + 4);
	assert.equal(bytes.toString("ascii", axis, axis + 4), "wght");
	assert.equal(bytes.readInt32BE(axis + 4) / 65536, 100);
	assert.equal(bytes.readInt32BE(axis + 12) / 65536, 900);
	bytes.write(tag, axis, 4, "ascii");
	for (let index = 0; index < bytes.readUInt16BE(stat.offset + 6); index++) {
		const offset =
			stat.offset +
			bytes.readUInt32BE(stat.offset + 8) +
			index * bytes.readUInt16BE(stat.offset + 4);
		if (bytes.toString("ascii", offset, offset + 4) === "wght")
			bytes.write(tag, offset, 4, "ascii");
	}
	const checksum = (offset: number, length: number) => {
		let sum = 0;
		for (let pos = offset; pos < offset + length; pos += 4) {
			let word = 0;
			for (let byte = 0; byte < 4; byte++)
				word =
					(word * 256 +
						(pos + byte < offset + length ? bytes[pos + byte]! : 0)) >>>
					0;
			sum = (sum + word) >>> 0;
		}
		return sum;
	};
	bytes.writeUInt32BE(0, head.offset + 8);
	for (const table of [fvar, stat, head])
		bytes.writeUInt32BE(checksum(table.offset, table.length), table.record + 4);
	bytes.writeUInt32BE(
		(0xb1b0afba - checksum(0, bytes.length)) >>> 0,
		head.offset + 8,
	);
	assert.equal(checksum(0, bytes.length), 0xb1b0afba);
	return bytes;
}
