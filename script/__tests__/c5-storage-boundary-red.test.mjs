import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

function runFixture(name) {
	return spawnSync(
		process.execPath,
		[
			join(repoRoot, "script", "check-storage-boundary.mjs"),
			"--fixture",
			join("script", "fixtures", "c5-storage-boundary", name),
		],
		{ cwd: repoRoot, encoding: "utf8" },
	);
}

function expectRejected(name, diagnostic) {
	const result = runFixture(name);
	expect(
		result.status,
		`boundary gate accepted ${name}; output:\n${result.stdout}\n${result.stderr}`,
	).not.toBe(0);
	expect(`${result.stdout}\n${result.stderr}`).toContain(diagnostic);
}

const NEGATIVE_FIXTURES = [
	["direct-adapter", "retired-adapter"],
	["direct-indexeddb", "mechanism:indexeddb"],
	["direct-opfs", "mechanism:opfs"],
	["direct-singleton", "direct-singleton"],
	["hidden-host-storage", "hidden-host-storage"],
	["in-memory-fallback", "in-memory-production-fallback"],
	["localstorage-presets", "durable-library-localstorage"],
	["localstorage-sounds", "durable-library-localstorage"],
	["mechanism-type-leak", "mechanism:idb-factory"],
	["physical-storage-path-leak", "mechanism:storage-path"],
	["private-storage-context", "private-storage-context"],
	["public-command-leak", "public-command-import"],
	["public-schema-leak", "public-schema-import"],
	["public-state-store-leak", "public-state-store-import"],
	[
		"public-storage-implementation-leak",
		"public-storage-implementation-import",
	],
	["second-media-port", "second-storage-media-port"],
	["second-storage-port", "second-storage-media-port"],
	["unlisted-verification", "mechanism:indexeddb"],
];

describe("C5 final storage boundary negative controls", () => {
	test("the test table names every negative fixture", () => {
		const onDisk = readdirSync(
			join(repoRoot, "script", "fixtures", "c5-storage-boundary"),
			{ withFileTypes: true },
		)
			.filter((entry) => entry.isDirectory())
			.map((entry) => entry.name)
			.sort();
		expect(NEGATIVE_FIXTURES.map(([name]) => name).sort()).toEqual(onDisk);
	});

	for (const [name, diagnostic] of NEGATIVE_FIXTURES) {
		test(`rejects ${name} with its targeted diagnostic`, () => {
			expectRejected(name, diagnostic);
		});
	}
});
