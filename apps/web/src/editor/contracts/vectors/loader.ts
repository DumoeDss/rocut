/* eslint-disable @typescript-eslint/no-unsafe-type-assertion, opencut/prefer-object-params -- This is the untrusted-JSON boundary: every assertion here is guarded by the validator immediately above it, and the small positional validators mirror one shape (value, field, context). */
/**
 * The corpus loader: parse, digest-check, and refuse (S03 T4, tasks 1.2/1.3).
 *
 * Loading is fail-closed by construction. Every refusal below is a rejection
 * naming the offending file, vector and field — never a vector quietly admitted
 * as skipped or passing, because a corpus that admits an unreadable vector is a
 * corpus that reports coverage it does not have.
 *
 * The loader takes text, not paths: it does no file-system work, so the same
 * function runs in a browser, in Node and in a consumer's own harness.
 */
import type { ContractSurface } from "./contract-surface";
import { sha256Hex } from "./sha256";
import type {
	DocumentVector,
	ScenarioStep,
	ScenarioVector,
	TransactionVectorCorpus,
	VectorBatch,
	VectorExpectation,
	VectorManifest,
	VectorManifestEntry,
	VectorSeedDocument,
} from "./schema";
import { TRANSACTION_VECTOR_SCHEMA, TransactionVectorError } from "./schema";

/** Tick-valued fields, wherever they appear in an entity or a patch. */
const TICK_FIELDS = new Set([
	"startTime",
	"duration",
	"trimStart",
	"trimEnd",
	"time",
]);

const REQUIREMENTS = new Set(["validation", "placement-policy"]);

interface LoadContext {
	readonly file: string;
	readonly contract: ContractSurface;
	vectorId?: string;
}

function fail(args: {
	code: TransactionVectorError["code"];
	message: string;
	context: LoadContext;
	field?: string;
}): never {
	throw new TransactionVectorError({
		code: args.code,
		message: args.message,
		file: args.context.file,
		vectorId: args.context.vectorId,
		field: args.field,
	});
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function requireRecord(
	value: unknown,
	field: string,
	context: LoadContext,
): Record<string, unknown> {
	if (!isRecord(value)) {
		fail({
			code: "schema",
			message: `${field} must be an object`,
			context,
			field,
		});
	}
	return value;
}

function requireString(
	value: unknown,
	field: string,
	context: LoadContext,
): string {
	if (typeof value !== "string" || value.length === 0) {
		fail({
			code: "schema",
			message: `${field} must be a non-empty string`,
			context,
			field,
		});
	}
	return value;
}

function requireInteger(
	value: unknown,
	field: string,
	context: LoadContext,
): number {
	if (typeof value !== "number" || !Number.isFinite(value)) {
		fail({
			code: "wire-safety",
			message: `${field} must be a finite number`,
			context,
			field,
		});
	}
	if (!Number.isInteger(value)) {
		fail({
			code: "wire-safety",
			message: `${field} must be an integer`,
			context,
			field,
		});
	}
	return value;
}

function requireTick(
	value: unknown,
	field: string,
	context: LoadContext,
): number {
	const ticks = requireInteger(value, field, context);
	if (ticks < 0) {
		fail({
			code: "wire-safety",
			message: `${field} must be a non-negative tick count`,
			context,
			field,
		});
	}
	return ticks;
}

/**
 * Walk arbitrary published data and reject anything that could not survive a
 * JSON round trip, plus any tick-named field that is not a whole tick count.
 */
function assertWireSafe(args: {
	value: unknown;
	path: string;
	context: LoadContext;
}): void {
	const { value, path, context } = args;
	if (value === null || typeof value === "string" || typeof value === "boolean") {
		return;
	}
	if (typeof value === "number") {
		if (!Number.isFinite(value)) {
			fail({
				code: "wire-safety",
				message: `${path} must be a finite number`,
				context,
				field: path,
			});
		}
		return;
	}
	if (Array.isArray(value)) {
		value.forEach((entry, index) =>
			assertWireSafe({ value: entry, path: `${path}[${index}]`, context }),
		);
		return;
	}
	if (!isRecord(value)) {
		fail({
			code: "wire-safety",
			message: `${path} carries a ${typeof value}, which cannot travel on the wire`,
			context,
			field: path,
		});
	}
	for (const [key, entry] of Object.entries(value)) {
		if (TICK_FIELDS.has(key)) requireTick(entry, `${path}.${key}`, context);
		assertWireSafe({ value: entry, path: `${path}.${key}`, context });
	}
}

function readSeedDocument(
	value: unknown,
	context: LoadContext,
): VectorSeedDocument {
	const document = requireRecord(value, "initialDocument", context);
	const project = requireRecord(document.project, "initialDocument.project", context);
	requireString(project.id, "initialDocument.project.id", context);
	requireString(project.name, "initialDocument.project.name", context);
	for (const key of ["tracks", "clips", "assets", "markers"] as const) {
		if (!Array.isArray(document[key])) {
			fail({
				code: "schema",
				message: `initialDocument.${key} must be an array`,
				context,
				field: `initialDocument.${key}`,
			});
		}
	}
	assertWireSafe({ value: document, path: "initialDocument", context });
	return document as unknown as VectorSeedDocument;
}

function readBatch(value: unknown, path: string, context: LoadContext): VectorBatch {
	const batch = requireRecord(value, path, context);
	if (!Array.isArray(batch.operations)) {
		fail({
			code: "schema",
			message: `${path}.operations must be an array`,
			context,
			field: `${path}.operations`,
		});
	}
	batch.operations.forEach((operation, index) => {
		const record = requireRecord(
			operation,
			`${path}.operations[${index}]`,
			context,
		);
		const kind = requireString(
			record.kind,
			`${path}.operations[${index}].kind`,
			context,
		);
		if (!context.contract.operationKinds.includes(kind)) {
			fail({
				code: "unknown-member",
				message: `${path}.operations[${index}] uses operation kind "${kind}", which the contract does not export`,
				context,
				field: `${path}.operations[${index}].kind`,
			});
		}
	});
	if (batch.expectedRevisionOffset !== undefined) {
		requireInteger(
			batch.expectedRevisionOffset,
			`${path}.expectedRevisionOffset`,
			context,
		);
	}
	if (batch.idempotencyKey !== undefined) {
		requireString(batch.idempotencyKey, `${path}.idempotencyKey`, context);
	}
	if (batch.unknownKindProbe !== undefined) {
		const probe = requireString(
			batch.unknownKindProbe,
			`${path}.unknownKindProbe`,
			context,
		);
		if (context.contract.operationKinds.includes(probe)) {
			fail({
				code: "schema",
				message: `${path}.unknownKindProbe must name a kind the contract does NOT export`,
				context,
				field: `${path}.unknownKindProbe`,
			});
		}
	}
	assertWireSafe({ value: batch, path, context });
	return batch as unknown as VectorBatch;
}

/**
 * How many independent claims this expectation makes. Used only to refuse an
 * expectation that claims nothing — the runner counts the comparisons it
 * actually executes rather than trusting this number.
 */
export function declaredAssertionCount(expect: VectorExpectation): number {
	let count = 0;
	if (typeof expect.outcome === "string") count += 1;
	if (typeof expect.revisionDelta === "number") count += 1;
	if (typeof expect.watchDelta === "number") count += 1;
	if (typeof expect.errorCode === "string") count += 1;
	if (expect.createdIds) count += 1;
	if (expect.changedIds) count += 1;
	if (typeof expect.valid === "boolean") count += 1;
	count += expect.issueCodes?.length ?? 0;
	count += expect.reads?.length ?? 0;
	count += expect.clones?.length ?? 0;
	return count;
}

function readExpectation(
	value: unknown,
	path: string,
	context: LoadContext,
): VectorExpectation {
	const expect = requireRecord(value, path, context);
	if (Object.keys(expect).length === 0) {
		fail({
			code: "empty-expectation",
			message: `${path} asserts nothing`,
			context,
			field: path,
		});
	}
	const outcome = requireString(expect.outcome, `${path}.outcome`, context);
	if (!["accepted", "rejected", "replayed"].includes(outcome)) {
		fail({
			code: "schema",
			message: `${path}.outcome must be accepted, rejected or replayed`,
			context,
			field: `${path}.outcome`,
		});
	}
	requireInteger(expect.revisionDelta, `${path}.revisionDelta`, context);
	requireInteger(expect.watchDelta, `${path}.watchDelta`, context);
	if (outcome === "rejected") {
		const code = requireString(expect.errorCode, `${path}.errorCode`, context);
		if (!context.contract.errorCodes.includes(code)) {
			fail({
				code: "unknown-member",
				message: `${path}.errorCode "${code}" is not a member of the contract's error-code union`,
				context,
				field: `${path}.errorCode`,
			});
		}
	}
	for (const code of (expect.issueCodes as string[] | undefined) ?? []) {
		if (!context.contract.issueCodes.includes(code)) {
			fail({
				code: "unknown-member",
				message: `${path}.issueCodes carries "${code}", which the engine does not export`,
				context,
				field: `${path}.issueCodes`,
			});
		}
	}
	const parsed = expect as unknown as VectorExpectation;
	if (declaredAssertionCount(parsed) === 0) {
		fail({
			code: "empty-expectation",
			message: `${path} asserts nothing`,
			context,
			field: path,
		});
	}
	assertWireSafe({ value: expect, path, context });
	return parsed;
}

function readRequirements(
	value: unknown,
	context: LoadContext,
): readonly string[] {
	if (value === undefined) return [];
	if (!Array.isArray(value)) {
		fail({
			code: "schema",
			message: "requires must be an array",
			context,
			field: "requires",
		});
	}
	for (const entry of value) {
		if (typeof entry !== "string" || !REQUIREMENTS.has(entry)) {
			fail({
				code: "schema",
				message: `requires carries unknown capability ${String(entry)}`,
				context,
				field: "requires",
			});
		}
	}
	return value as readonly string[];
}

function readDocumentVector(
	value: unknown,
	context: LoadContext,
): DocumentVector {
	const vector = requireRecord(value, "vector", context);
	context.vectorId = typeof vector.id === "string" ? vector.id : undefined;
	requireString(vector.id, "id", context);
	requireString(vector.title, "title", context);
	const requires = readRequirements(vector.requires, context);
	const initialDocument = readSeedDocument(vector.initialDocument, context);
	const batch = readBatch(vector.batch, "batch", context);
	const expect = readExpectation(vector.expect, "expect", context);
	return {
		id: vector.id as string,
		title: vector.title as string,
		...(requires.length > 0 && {
			requires: requires as DocumentVector["requires"],
		}),
		initialDocument,
		batch,
		expect,
	};
}

function readScenarioVector(
	value: unknown,
	context: LoadContext,
): ScenarioVector {
	const vector = requireRecord(value, "vector", context);
	context.vectorId = typeof vector.id === "string" ? vector.id : undefined;
	requireString(vector.id, "id", context);
	requireString(vector.title, "title", context);
	const requires = readRequirements(vector.requires, context);
	if (!Array.isArray(vector.steps) || vector.steps.length === 0) {
		fail({
			code: "empty-expectation",
			message: "a scenario vector must declare at least one step",
			context,
			field: "steps",
		});
	}
	const steps: ScenarioStep[] = vector.steps.map((step, index) => {
		const record = requireRecord(step, `steps[${index}]`, context);
		return {
			id: requireString(record.id, `steps[${index}].id`, context),
			intent: requireString(record.intent, `steps[${index}].intent`, context),
			batch: readBatch(record.batch, `steps[${index}].batch`, context),
			expect: readExpectation(record.expect, `steps[${index}].expect`, context),
		};
	});
	const stepIds = new Set(steps.map((step) => step.id));
	if (stepIds.size !== steps.length) {
		fail({
			code: "duplicate-id",
			message: "scenario step ids must be unique inside a vector",
			context,
			field: "steps",
		});
	}
	return {
		id: vector.id as string,
		title: vector.title as string,
		...(requires.length > 0 && {
			requires: requires as ScenarioVector["requires"],
		}),
		steps,
	};
}

function readManifest(text: string, contract: ContractSurface): VectorManifest {
	const context: LoadContext = { file: "manifest.json", contract };
	let parsed: unknown;
	try {
		parsed = JSON.parse(text);
	} catch {
		fail({ code: "schema", message: "manifest is not valid JSON", context });
	}
	const manifest = requireRecord(parsed, "manifest", context);
	if (manifest.schema !== TRANSACTION_VECTOR_SCHEMA) {
		fail({
			code: "schema",
			message: `manifest declares schema ${String(manifest.schema)}`,
			context,
			field: "schema",
		});
	}
	requireInteger(manifest.corpusVersion, "corpusVersion", context);
	requireInteger(manifest.declaredVectorCount, "declaredVectorCount", context);
	requireString(manifest.corpusDigest, "corpusDigest", context);
	requireString(manifest.generatedBy, "generatedBy", context);
	if (!Array.isArray(manifest.files) || manifest.files.length === 0) {
		fail({
			code: "schema",
			message: "manifest must list at least one corpus file",
			context,
			field: "files",
		});
	}
	for (const entry of manifest.files) {
		const record = requireRecord(entry, "files[]", context);
		requireString(record.path, "files[].path", context);
		requireString(record.sha256, "files[].sha256", context);
		requireInteger(record.vectorCount, "files[].vectorCount", context);
		if (record.family !== "document" && record.family !== "scenario") {
			fail({
				code: "schema",
				message: `files[].family must be document or scenario, got ${String(record.family)}`,
				context,
				field: "files[].family",
			});
		}
	}
	return manifest as unknown as VectorManifest;
}

/** The digest the manifest publishes over the whole corpus. */
export function corpusDigestOf(files: readonly VectorManifestEntry[]): string {
	return sha256Hex(
		[...files]
			.map((entry) => `${entry.path}:${entry.sha256}`)
			.sort()
			.join("\n"),
	);
}

export interface LoadTransactionVectorsArgs {
	readonly manifestText: string;
	/** Corpus file text keyed by the manifest's `path`. */
	readonly files: Readonly<Record<string, string>>;
	readonly contract: ContractSurface;
}

/**
 * Parse and validate a published corpus, or throw a structured
 * {@link TransactionVectorError}.
 */
export function loadTransactionVectorCorpus(
	args: LoadTransactionVectorsArgs,
): TransactionVectorCorpus {
	const manifest = readManifest(args.manifestText, args.contract);
	const manifestContext: LoadContext = {
		file: "manifest.json",
		contract: args.contract,
	};

	const suppliedPaths = Object.keys(args.files).sort();
	const manifestPaths = manifest.files.map((entry) => entry.path).sort();
	if (suppliedPaths.join("|") !== manifestPaths.join("|")) {
		fail({
			code: "drift",
			message:
				`manifest lists ${manifestPaths.join(", ") || "no file"} but the corpus supplied ` +
				`${suppliedPaths.join(", ") || "no file"}`,
			context: manifestContext,
			field: "files",
		});
	}
	const recomputedDigest = corpusDigestOf(manifest.files);
	if (recomputedDigest !== manifest.corpusDigest) {
		fail({
			code: "drift",
			message: `manifest corpus digest ${manifest.corpusDigest} does not match ${recomputedDigest}`,
			context: manifestContext,
			field: "corpusDigest",
		});
	}

	const documentVectors: DocumentVector[] = [];
	const scenarioVectors: ScenarioVector[] = [];
	const seenIds = new Set<string>();

	for (const entry of manifest.files) {
		const text = args.files[entry.path];
		const context: LoadContext = { file: entry.path, contract: args.contract };
		const digest = sha256Hex(text);
		if (digest !== entry.sha256) {
			fail({
				code: "drift",
				message: `${entry.path} hashes to ${digest} but the manifest declares ${entry.sha256}`,
				context,
				field: "sha256",
			});
		}
		let parsed: unknown;
		try {
			parsed = JSON.parse(text);
		} catch {
			fail({ code: "schema", message: `${entry.path} is not valid JSON`, context });
		}
		const file = requireRecord(parsed, entry.path, context);
		if (file.schema !== TRANSACTION_VECTOR_SCHEMA) {
			fail({
				code: "schema",
				message: `${entry.path} declares schema ${String(file.schema)}`,
				context,
				field: "schema",
			});
		}
		if (file.corpusVersion !== manifest.corpusVersion) {
			fail({
				code: "drift",
				message: `${entry.path} declares corpus version ${String(file.corpusVersion)}`,
				context,
				field: "corpusVersion",
			});
		}
		if (file.family !== entry.family) {
			fail({
				code: "drift",
				message: `${entry.path} declares family ${String(file.family)}, manifest says ${entry.family}`,
				context,
				field: "family",
			});
		}
		if (!Array.isArray(file.vectors) || file.vectors.length === 0) {
			fail({
				code: "schema",
				message: `${entry.path} publishes no vector`,
				context,
				field: "vectors",
			});
		}
		if (file.vectors.length !== entry.vectorCount) {
			fail({
				code: "drift",
				message: `${entry.path} holds ${file.vectors.length} vectors, manifest declares ${entry.vectorCount}`,
				context,
				field: "vectorCount",
			});
		}
		for (const raw of file.vectors) {
			const vector =
				entry.family === "document"
					? readDocumentVector(raw, context)
					: readScenarioVector(raw, context);
			if (seenIds.has(vector.id)) {
				fail({
					code: "duplicate-id",
					message: `vector id ${vector.id} appears more than once in the corpus`,
					context,
					field: "id",
				});
			}
			seenIds.add(vector.id);
			if (entry.family === "document") {
				documentVectors.push(vector as DocumentVector);
			} else {
				scenarioVectors.push(vector as ScenarioVector);
			}
			context.vectorId = undefined;
		}
	}

	const total = documentVectors.length + scenarioVectors.length;
	if (total !== manifest.declaredVectorCount) {
		fail({
			code: "drift",
			message: `corpus holds ${total} vectors, manifest declares ${manifest.declaredVectorCount}`,
			context: manifestContext,
			field: "declaredVectorCount",
		});
	}

	return {
		schema: TRANSACTION_VECTOR_SCHEMA,
		corpusVersion: manifest.corpusVersion,
		declaredVectorCount: manifest.declaredVectorCount,
		corpusDigest: manifest.corpusDigest,
		documentVectors,
		scenarioVectors,
	};
}
