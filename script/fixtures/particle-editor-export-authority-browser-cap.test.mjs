import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// Pure descriptor policy seam only: no anchor replacement or real admission.
const source =
	new TextDecoder("utf8", { fatal: true })
		.decode(
			await readFile(
				new URL("./particle-editor-export-authority.mjs", import.meta.url),
			),
		)
		.replace(
			'"./particle-editor-export-authority-identity.mjs"',
			JSON.stringify(
				new URL(
					"./particle-editor-export-authority-identity.mjs",
					import.meta.url,
				).href,
			),
		) + "\nexport { fileEntry as testFileEntry };\n";
const { testFileEntry } = await import(
	`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`
);
const independentlyFrozen = {
	path: "chrome.dll",
	byteLength: 301124096,
	sha256: "0b69d34d08e1112d5e7de94e389d20e209a890e931863c734378b39b7394da13",
};

test("exact frozen chrome.dll descriptor may exceed ordinary cap only in browser closure", () => {
	assert.doesNotThrow(() => testFileEntry(independentlyFrozen, "browser"));
	for (const role of [
		undefined,
		"ordinary",
		"toolchain",
		"packedSampler",
		true,
	])
		assert.throws(() => testFileEntry(independentlyFrozen, role));
});

test("wrong browser path, digest or size cannot use the frozen DLL exception", () => {
	for (const change of [
		{ path: "other.dll" },
		{ path: "nested/chrome.dll" },
		{ sha256: "0".repeat(64) },
		{ byteLength: 301124095 },
		{ byteLength: 301124097 },
		{ byteLength: 512 * 1024 * 1024 },
	])
		assert.throws(() =>
			testFileEntry({ ...independentlyFrozen, ...change }, "browser"),
		);
});

test("ordinary cap boundary and identity-independent empty content rule remain unchanged", () => {
	const entry = {
		path: "ordinary.js",
		byteLength: 256 * 1024 * 1024,
		sha256: "1".repeat(64),
	};
	for (const role of [undefined, "browser"]) {
		assert.doesNotThrow(() => testFileEntry(entry, role));
		assert.throws(() =>
			testFileEntry({ ...entry, byteLength: entry.byteLength + 1 }, role),
		);
	}
});
