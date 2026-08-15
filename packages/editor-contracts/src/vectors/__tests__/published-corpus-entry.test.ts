import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";

import type { ContractSurface } from "../contract-surface";
import {
	PUBLISHED_CONTRACT_SURFACE,
	readPublishedCorpusText,
} from "../corpus";
import { loadTransactionVectorCorpus } from "../loader";
import { sha256Hex } from "../sha256";
import type { VectorManifest } from "../schema";
import { CORPUS_DIR, readContractSurface } from "./corpus-fixture";

/**
 * Drift guards for the published corpus entry (S05 P3, spec scenario "The
 * published surface cannot drift from the contract").
 *
 * The entry publishes two things as data — the corpus's exact file bytes and
 * the frozen contract surface. Both are restatements of committed truth, so
 * both are guarded fail-closed here: if the contract grows an export without
 * the published constant moving, or a corpus file changes without its
 * manifest, these tests go red rather than letting the entry ship a lie.
 */
describe("published corpus entry", () => {
	test("PUBLISHED_CONTRACT_SURFACE equals the surface parsed from the real sources", () => {
		expect(PUBLISHED_CONTRACT_SURFACE).toEqual(readContractSurface());
	});

	test("a one-member surface mutation fails the guard's comparison", () => {
		// The guard above is one `toEqual`. Proving it discriminates: mutate the
		// published data by exactly one member (the shape of drift it exists to
		// catch — a contract export added without the constant moving) and
		// require the same comparison to fail.
		const mutated: ContractSurface = {
			...PUBLISHED_CONTRACT_SURFACE,
			operationKinds: [
				...PUBLISHED_CONTRACT_SURFACE.operationKinds,
				"synthetic-kind",
			],
		};
		expect(mutated).not.toEqual(readContractSurface());
		expect(PUBLISHED_CONTRACT_SURFACE.operationKinds).not.toContain(
			"synthetic-kind",
		);
	});

	test("readPublishedCorpusText loads through the published loader, digest matching", () => {
		const { manifestText, files } = readPublishedCorpusText();
		const manifest = JSON.parse(manifestText) as VectorManifest;
		const corpus = loadTransactionVectorCorpus({
			manifestText,
			files,
			contract: PUBLISHED_CONTRACT_SURFACE,
		});
		expect(corpus.corpusDigest).toBe(manifest.corpusDigest);
		expect(corpus.declaredVectorCount).toBe(manifest.declaredVectorCount);
		expect(
			corpus.documentVectors.length + corpus.scenarioVectors.length,
		).toBe(manifest.declaredVectorCount);
	});

	test("each returned file text hashes to the manifest's declared sha256", () => {
		const { manifestText, files } = readPublishedCorpusText();
		const manifest = JSON.parse(manifestText) as VectorManifest;
		for (const entry of manifest.files) {
			expect(sha256Hex(files[entry.path] ?? "")).toBe(entry.sha256);
		}
	});

	test("the returned texts are the exact committed file bytes", () => {
		const { manifestText, files } = readPublishedCorpusText();
		expect(manifestText).toBe(
			readFileSync(join(CORPUS_DIR, "manifest.json"), "utf8"),
		);
		expect(Object.keys(files).sort()).toEqual(
			["document-vectors.json", "scenario-vectors.json"].sort(),
		);
		for (const [name, text] of Object.entries(files)) {
			expect(text).toBe(readFileSync(join(CORPUS_DIR, name), "utf8"));
		}
	});
});
