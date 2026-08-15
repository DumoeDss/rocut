import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = join(
	dirname(fileURLToPath(import.meta.url)),
	"../../../../..",
);

/**
 * Scoped to `apps` and `packages`, not the whole repo: this is an editor/Host
 * module-graph invariant, and `script/` fixtures are proof-only harness code
 * that never enters a distributable bundle (S05 P1 design). Both roots are
 * scanned — not just `apps` — since editor-ports and editor-contracts now
 * live under each package's `src` tree under `packages/` after S05 P1
 * Stages A and B; editor-classic joins them at Stage C.
 */
function trackedSources(): string[] {
	return execFileSync(
		"git",
		["ls-files", "--cached", "--others", "--exclude-standard", "apps", "packages"],
		{ cwd: REPO_ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
	)
		.split("\n")
		.map((line) => line.trim())
		.filter((path) => /\.(ts|tsx)$/.test(path));
}

/**
 * Test sources are exempt from the entry-import ban: consuming the published
 * `./vectors/corpus` entry is exactly how a third-party consumer — and this
 * repository's own requirement-index drift guard, which lives under
 * `conformance/requirements/__tests__/` — reaches the corpus, and no `__tests__`
 * module is ever part of a distributable graph. The invariant protects the
 * graphs a Host can ship, not the tests that prove them.
 */
function isTestSource(path: string): boolean {
	return /[\\/]__tests__[\\/]/.test(path);
}

/**
 * The corpus is data, and it must stay data. If a module imported it, the JSON
 * would enter that module's bundle — and for an editor module, that means the
 * distributable graph. The runner is the only thing a Host can choose to take.
 */
describe("corpus isolation", () => {
	test("no distributable module imports the committed corpus", () => {
		const sources = trackedSources().filter((path) => !isTestSource(path));
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
				"packages/editor-contracts/src/vectors/__tests__/corpus-fixture.ts",
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
