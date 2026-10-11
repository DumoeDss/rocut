import assert from "node:assert/strict";
import { test } from "node:test";
import { gzipSync } from "node:zlib";
import { featureTarEntries } from "./prepare-p1-d-feature-toolchain.mjs";

function tarEntry(name, type = "0", body = Buffer.from("{}")) {
	const header = Buffer.alloc(512);
	header.write(name); header.write("0000644\0", 100); header.write("0000000\0", 108); header.write("0000000\0", 116);
	header.write(body.length.toString(8).padStart(11, "0") + "\0", 124);
	header.write("00000000000\0", 136); header.fill(32, 148, 156); header.write(type, 156);
	header.write(header.reduce((sum, byte) => sum + byte, 0).toString(8).padStart(6, "0") + "\0 ", 148);
	return Buffer.concat([header, body, Buffer.alloc((512 - body.length % 512) % 512)]);
}
const archive = (...entries) => gzipSync(Buffer.concat([...entries, Buffer.alloc(1024)]));

test("bounded extractor accepts regular npm package files only", () => {
	const entries = featureTarEntries(archive(tarEntry("package/package.json"), tarEntry("package/dist/index.js", "0", Buffer.from("export {};"))));
	assert.deepEqual(entries.map((entry) => entry.path), ["package.json", "dist/index.js"]);
});
test("extractor refuses escapes, links, case duplicates, bad checksum and trailer", () => {
	for (const path of ["package/../outside", "package/dist/C:evil", "package/dist\\evil", "elsewhere/package.json"]) assert.throws(() => featureTarEntries(archive(tarEntry(path))));
	assert.throws(() => featureTarEntries(archive(tarEntry("package/package.json", "2"))), /regular files/);
	assert.throws(() => featureTarEntries(archive(tarEntry("package/package.json"), tarEntry("package/PACKAGE.JSON"))), /Duplicate/);
	const broken = tarEntry("package/package.json"); broken[10] ^= 1;
	assert.throws(() => featureTarEntries(archive(broken)), /checksum/);
	assert.throws(() => featureTarEntries(gzipSync(Buffer.concat([tarEntry("package/package.json"), Buffer.alloc(512), Buffer.from("outside")]))), /trailer/);
	assert.throws(() => featureTarEntries(gzipSync(tarEntry("package/package.json").subarray(0, 513))));
});
