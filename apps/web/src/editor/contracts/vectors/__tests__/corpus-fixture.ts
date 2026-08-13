/**
 * Test-only access to the committed corpus and to the contract's source text.
 *
 * The published loader, coverage gate and runner take text and data, never
 * paths — that is what keeps them runnable outside this repository. Reading
 * files is therefore a job for the harness, and it lives here rather than in
 * the shipped modules.
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type { ContractSurface } from "../contract-surface";
import { parseContractSurface } from "../contract-surface";
import { loadTransactionVectorCorpus } from "../loader";
import type { TransactionVectorCorpus } from "../schema";

const HERE = dirname(fileURLToPath(import.meta.url));
export const VECTORS_DIR = join(HERE, "..");
export const CORPUS_DIR = join(VECTORS_DIR, "corpus");
const CONTRACTS_DIR = join(VECTORS_DIR, "..");

export function readContractSurface(): ContractSurface {
	return parseContractSurface({
		operations: readFileSync(join(CONTRACTS_DIR, "operations.ts"), "utf8"),
		transaction: readFileSync(join(CONTRACTS_DIR, "transaction.ts"), "utf8"),
		engineTypes: readFileSync(join(CONTRACTS_DIR, "engine/types.ts"), "utf8"),
	});
}

export function readContractSources(): {
	operations: string;
	transaction: string;
	engineTypes: string;
} {
	return {
		operations: readFileSync(join(CONTRACTS_DIR, "operations.ts"), "utf8"),
		transaction: readFileSync(join(CONTRACTS_DIR, "transaction.ts"), "utf8"),
		engineTypes: readFileSync(join(CONTRACTS_DIR, "engine/types.ts"), "utf8"),
	};
}

export function readCorpusFiles(): {
	manifestText: string;
	files: Record<string, string>;
} {
	const manifestText = readFileSync(join(CORPUS_DIR, "manifest.json"), "utf8");
	const files: Record<string, string> = {};
	for (const name of readdirSync(CORPUS_DIR)) {
		if (!name.endsWith(".json") || name === "manifest.json") continue;
		files[name] = readFileSync(join(CORPUS_DIR, name), "utf8");
	}
	return { manifestText, files };
}

export function loadPublishedCorpus(): TransactionVectorCorpus {
	const { manifestText, files } = readCorpusFiles();
	return loadTransactionVectorCorpus({
		manifestText,
		files,
		contract: readContractSurface(),
	});
}
