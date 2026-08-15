/* eslint-disable @typescript-eslint/no-unsafe-type-assertion -- Each control edits one field of a parsed corpus to isolate the refusal it probes. */
import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";

import { corpusDigestOf, loadTransactionVectorCorpus } from "../loader";
import { TRANSACTION_VECTOR_SCHEMA, TransactionVectorError } from "../schema";
import { sha256Hex } from "../sha256";
import {
	loadPublishedCorpus,
	readContractSurface,
	readCorpusFiles,
} from "./corpus-fixture";

const contract = readContractSurface();

/** Re-manifest an edited corpus so a test isolates the rule it is probing. */
function remanifest(files: Record<string, string>): {
	manifestText: string;
	files: Record<string, string>;
} {
	const entries = Object.keys(files)
		.sort()
		.map((path) => ({
			path,
			sha256: sha256Hex(files[path]),
			family: JSON.parse(files[path]).family as "document" | "scenario",
			vectorCount: JSON.parse(files[path]).vectors.length as number,
		}));
	const manifest = {
		schema: TRANSACTION_VECTOR_SCHEMA,
		corpusVersion: 1,
		generatedBy: "loader.test.ts",
		declaredVectorCount: entries.reduce(
			(total, entry) => total + entry.vectorCount,
			0,
		),
		files: entries,
		corpusDigest: corpusDigestOf(entries),
	};
	return { manifestText: JSON.stringify(manifest), files };
}

function editDocumentFile(
	mutate: (file: {
		schema: string;
		corpusVersion: number;
		family: string;
		vectors: Record<string, unknown>[];
	}) => void,
): { manifestText: string; files: Record<string, string> } {
	const { files } = readCorpusFiles();
	const parsed = JSON.parse(files["document-vectors.json"]);
	mutate(parsed);
	return remanifest({
		...files,
		"document-vectors.json": JSON.stringify(parsed),
	});
}

function loadFailure(args: {
	manifestText: string;
	files: Record<string, string>;
}): TransactionVectorError {
	try {
		loadTransactionVectorCorpus({ ...args, contract });
	} catch (error) {
		if (error instanceof TransactionVectorError) return error;
		throw error;
	}
	throw new Error("the corpus loaded when the test required a refusal");
}

describe("published corpus", () => {
	test("parses with a plain JSON parser and is self-describing", () => {
		const { files } = readCorpusFiles();
		const paths = Object.keys(files);
		expect(paths.length).toBeGreaterThan(0);
		for (const path of paths) {
			const parsed = JSON.parse(files[path]);
			expect(parsed.schema).toBe(TRANSACTION_VECTOR_SCHEMA);
			expect(typeof parsed.corpusVersion).toBe("number");
			expect(["document", "scenario"]).toContain(parsed.family);
			expect(parsed.vectors.length).toBeGreaterThan(0);
			for (const vector of parsed.vectors) {
				expect(typeof vector.id).toBe("string");
				expect(vector.id.length).toBeGreaterThan(0);
			}
		}
	});

	test("loads, and every vector id is unique across both families", () => {
		const corpus = loadPublishedCorpus();
		const ids = [
			...corpus.documentVectors.map((vector) => vector.id),
			...corpus.scenarioVectors.map((vector) => vector.id),
		];
		expect(ids.length).toBe(corpus.declaredVectorCount);
		expect(new Set(ids).size).toBe(ids.length);
		expect(corpus.documentVectors.length).toBeGreaterThan(0);
		expect(corpus.scenarioVectors.length).toBeGreaterThan(0);
	});

	test("the corpus digest is a real SHA-256 chain, cross-checked against node:crypto", () => {
		const { files } = readCorpusFiles();
		for (const [path, text] of Object.entries(files)) {
			expect(sha256Hex(text)).toBe(
				createHash("sha256").update(text, "utf8").digest("hex"),
			);
			expect(sha256Hex(text)).not.toBe(sha256Hex(`${text} `));
			expect(path.endsWith(".json")).toBe(true);
		}
	});
});

describe("load-time refusals", () => {
	test("a file edited without regenerating the manifest fails to load", () => {
		const { manifestText, files } = readCorpusFiles();
		const tampered = {
			...files,
			"document-vectors.json": `${files["document-vectors.json"]}\n`,
		};
		const error = loadFailure({ manifestText, files: tampered });
		expect(error.code).toBe("drift");
		expect(error.file).toBe("document-vectors.json");
	});

	test("a manifest whose declared count differs from the files fails to load", () => {
		const { manifestText, files } = readCorpusFiles();
		const manifest = JSON.parse(manifestText);
		manifest.declaredVectorCount += 1;
		const error = loadFailure({
			manifestText: JSON.stringify(manifest),
			files,
		});
		expect(error.code).toBe("drift");
		expect(error.field).toBe("declaredVectorCount");
	});

	test("a vector whose expectation set is empty is a load error, not a skip", () => {
		const error = loadFailure(
			editDocumentFile((file) => {
				file.vectors[0].expect = {};
			}),
		);
		expect(error.code).toBe("empty-expectation");
		expect(error.vectorId).toBe("document/create-track-and-clone");
		expect(error.field).toBe("expect");
	});

	test("a scenario vector with no step is a load error", () => {
		const { files } = readCorpusFiles();
		const parsed = JSON.parse(files["scenario-vectors.json"]);
		parsed.vectors[0].steps = [];
		const error = loadFailure(
			remanifest({
				...files,
				"scenario-vectors.json": JSON.stringify(parsed),
			}),
		);
		expect(error.code).toBe("empty-expectation");
		expect(error.field).toBe("steps");
	});

	test("a non-integer tick value is refused with the offending field", () => {
		const error = loadFailure(
			editDocumentFile((file) => {
				const vector = file.vectors.find(
					(entry) => entry.id === "document/update-clip-move",
				) as { batch: { operations: { patch: { startTime: number } }[] } };
				vector.batch.operations[0].patch.startTime = 80000.5;
			}),
		);
		expect(error.code).toBe("wire-safety");
		expect(error.vectorId).toBe("document/update-clip-move");
		expect(error.field).toContain("startTime");
	});

	test("a non-finite number is refused", () => {
		// `1e999` is legal JSON text that parses to Infinity, so this is the real
		// hazard rather than a stand-in for it.
		const { files } = readCorpusFiles();
		const text = files["document-vectors.json"].replace(
			'"startTime": 80000',
			'"startTime": 1e999',
		);
		expect(text).not.toBe(files["document-vectors.json"]);
		expect(JSON.parse(text).vectors.some(() => true)).toBe(true);
		const error = loadFailure(
			remanifest({ ...files, "document-vectors.json": text }),
		);
		expect(error.code).toBe("wire-safety");
		expect(error.message).toContain("finite");
	});

	test("an unknown operation kind is refused", () => {
		const error = loadFailure(
			editDocumentFile((file) => {
				const vector = file.vectors[0] as {
					batch: { operations: { kind: string }[] };
				};
				vector.batch.operations[0].kind = "create-effect";
			}),
		);
		expect(error.code).toBe("unknown-member");
		expect(error.message).toContain("create-effect");
	});

	test("an unknown error code is refused", () => {
		const error = loadFailure(
			editDocumentFile((file) => {
				const vector = file.vectors.find(
					(entry) => entry.id === "document/not-found-apply",
				) as { expect: { errorCode: string } };
				vector.expect.errorCode = "teapot";
			}),
		);
		expect(error.code).toBe("unknown-member");
		expect(error.field).toBe("expect.errorCode");
	});

	test("an unknown engine issue code is refused", () => {
		const error = loadFailure(
			editDocumentFile((file) => {
				const vector = file.vectors.find(
					(entry) => entry.id === "document/validation-duplicate-id",
				) as { expect: { issueCodes: string[] } };
				vector.expect.issueCodes = ["not-a-real-issue"];
			}),
		);
		expect(error.code).toBe("unknown-member");
		expect(error.field).toBe("expect.issueCodes");
	});

	test("a duplicate vector id is refused", () => {
		const error = loadFailure(
			editDocumentFile((file) => {
				file.vectors.push(JSON.parse(JSON.stringify(file.vectors[0])));
			}),
		);
		expect(error.code).toBe("duplicate-id");
		expect(error.message).toContain("document/create-track-and-clone");
	});

	test("an unknown-kind probe naming a real kind is refused", () => {
		const error = loadFailure(
			editDocumentFile((file) => {
				const vector = file.vectors.find(
					(entry) => entry.id === "document/validation-unsupported-operation",
				) as { batch: { unknownKindProbe: string } };
				vector.batch.unknownKindProbe = "create-track";
			}),
		);
		expect(error.code).toBe("schema");
		expect(error.field).toContain("unknownKindProbe");
	});

	test("no refusal path can return a corpus", () => {
		// Each mutation above throws; this asserts the property directly rather
		// than trusting that every test above remembered to check it.
		const mutations: Array<() => { manifestText: string; files: Record<string, string> }> = [
			() =>
				editDocumentFile((file) => {
					file.vectors[0].expect = {};
				}),
			() =>
				editDocumentFile((file) => {
					(file.vectors[0] as { id: unknown }).id = 7;
				}),
			() =>
				editDocumentFile((file) => {
					file.schema = "transaction-vectors/v2";
				}),
			() =>
				editDocumentFile((file) => {
					file.vectors = [];
				}),
		];
		for (const mutation of mutations) {
			let returned: unknown = null;
			try {
				returned = loadTransactionVectorCorpus({ ...mutation(), contract });
			} catch (error) {
				expect(error).toBeInstanceOf(TransactionVectorError);
			}
			expect(returned).toBeNull();
		}
	});
});
