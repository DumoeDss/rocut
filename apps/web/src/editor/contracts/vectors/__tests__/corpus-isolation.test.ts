import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = join(
	dirname(fileURLToPath(import.meta.url)),
	"../../../../../../..",
);

function trackedSources(): string[] {
	return execFileSync(
		"git",
		["ls-files", "--cached", "--others", "--exclude-standard", "apps"],
		{ cwd: REPO_ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
	)
		.split("\n")
		.map((line) => line.trim())
		.filter((path) => /\.(ts|tsx)$/.test(path));
}

/**
 * The corpus is data, and it must stay data. If a module imported it, the JSON
 * would enter that module's bundle — and for an editor module, that means the
 * distributable graph. The runner is the only thing a Host can choose to take.
 */
describe("corpus isolation", () => {
	test("no module imports the committed corpus", () => {
		const sources = trackedSources();
		expect(sources.length).toBeGreaterThan(100);
		const importers = sources.filter((path) => {
			const text = readFileSync(join(REPO_ROOT, path), "utf8");
			return /from\s+["'][^"']*vectors\/corpus[^"']*["']/.test(text);
		});
		expect(importers).toEqual([]);
	});

	test("no source imports a corpus JSON file by any relative path", () => {
		const sources = trackedSources();
		const importers = sources.filter((path) => {
			const text = readFileSync(join(REPO_ROOT, path), "utf8");
			return /(?:import|require)\s*\(?\s*["'][^"']*(?:document-vectors|scenario-vectors|manifest)\.json["']/.test(
				text,
			);
		});
		expect(importers).toEqual([]);
	});

	test("the harness reads the corpus from disk, which proves the scan can see an importer", () => {
		// Converse control: the fixture below *does* reach the corpus, so the
		// scans above are looking at real content rather than an empty set.
		const fixture = readFileSync(
			join(
				REPO_ROOT,
				"apps/web/src/editor/contracts/vectors/__tests__/corpus-fixture.ts",
			),
			"utf8",
		);
		expect(fixture).toContain("corpus");
		expect(
			/from\s+["'][^"']*vectors\/corpus[^"']*["']/.test(fixture),
			"the fixture must read the corpus, never import it",
		).toBe(false);
		expect(fixture).toContain("readFileSync");
	});
});
