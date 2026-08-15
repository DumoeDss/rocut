#!/usr/bin/env node
/**
 * Regenerate the published transaction-vector manifest (S03 T4, task 1.3).
 *
 * The manifest is the corpus's integrity claim: every file, its SHA-256, the
 * declared vector count, and a digest over the whole set. The loader recomputes
 * all of it and refuses to load a corpus whose bytes have moved without the
 * manifest moving with them, so this generator is the only supported way to
 * change the corpus.
 *
 *   node script/generate-vector-manifest.mjs           # rewrite the manifest
 *   node script/generate-vector-manifest.mjs --check   # fail if it is stale
 */
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const KNOWN_FLAGS = new Set(["--check"]);
const unknownFlags = process.argv
	.slice(2)
	.filter((flag) => !KNOWN_FLAGS.has(flag));
if (unknownFlags.length > 0) {
	console.error(
		`generate-vector-manifest: unknown flag(s) ${unknownFlags.join(", ")}. ` +
			`Known: ${[...KNOWN_FLAGS].join(", ")}.`,
	);
	process.exit(2);
}

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
// The corpus moved under the package extraction (Stage C, S05 P1 task 3.1)
// from "apps/web/src/editor/contracts/vectors/corpus" to
// "packages/editor-contracts/src/vectors/corpus" — the old path no longer
// exists, so `readdirSync` below would fail with ENOENT against it.
const CORPUS_DIR = join(
	REPO_ROOT,
	"packages/editor-contracts/src/vectors/corpus",
);
const MANIFEST = join(CORPUS_DIR, "manifest.json");
const SCHEMA = "transaction-vectors/v1";

function sha256(text) {
	return createHash("sha256").update(text, "utf8").digest("hex");
}

const files = readdirSync(CORPUS_DIR)
	.filter((name) => name.endsWith(".json") && name !== "manifest.json")
	.sort();

if (files.length === 0) {
	console.error("No corpus file found. A manifest over nothing is not evidence.");
	process.exit(1);
}

let corpusVersion = null;
const entries = files.map((name) => {
	const text = readFileSync(join(CORPUS_DIR, name), "utf8");
	const parsed = JSON.parse(text);
	if (parsed.schema !== SCHEMA) {
		console.error(`${name} declares schema ${parsed.schema}, expected ${SCHEMA}`);
		process.exit(1);
	}
	if (corpusVersion === null) corpusVersion = parsed.corpusVersion;
	else if (corpusVersion !== parsed.corpusVersion) {
		console.error(`${name} declares a different corpus version`);
		process.exit(1);
	}
	return {
		path: name,
		sha256: sha256(text),
		family: parsed.family,
		vectorCount: parsed.vectors.length,
	};
});

const corpusDigest = sha256(
	entries
		.map((entry) => `${entry.path}:${entry.sha256}`)
		.sort()
		.join("\n"),
);

const manifest = {
	schema: SCHEMA,
	corpusVersion,
	generatedBy: "script/generate-vector-manifest.mjs",
	declaredVectorCount: entries.reduce(
		(total, entry) => total + entry.vectorCount,
		0,
	),
	files: entries,
	corpusDigest,
};

const serialized = `${JSON.stringify(manifest, null, "\t")}\n`;

if (process.argv.includes("--check")) {
	let current = "";
	try {
		current = readFileSync(MANIFEST, "utf8");
	} catch {
		current = "";
	}
	if (current !== serialized) {
		console.error(
			"manifest.json is stale — run `node script/generate-vector-manifest.mjs`.",
		);
		process.exit(1);
	}
	console.log(
		`vector manifest current: ${entries.length} file(s), ${manifest.declaredVectorCount} vector(s), digest ${corpusDigest.slice(0, 12)}`,
	);
} else {
	writeFileSync(MANIFEST, serialized);
	console.log(
		`wrote ${entries.length} file(s), ${manifest.declaredVectorCount} vector(s), digest ${corpusDigest.slice(0, 12)}`,
	);
}
