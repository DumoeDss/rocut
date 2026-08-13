/**
 * The published conformance-vector schema (S03 T4, design D1/D2).
 *
 * Every type here describes **data at rest**. A published vector is plain JSON:
 * `MediaTime` is an integer tick count, identities are strings, operation kinds
 * and error codes are members of the contract's closed unions. Nothing at rest
 * needs a branded constructor, a TypeScript declaration, or a module import to
 * interpret — that is what makes the corpus consumable by an implementation
 * that is not this repository.
 *
 * The two families exist because the two kinds of target exist. A **document**
 * vector supplies its own starting document, which needs a target that can be
 * opened over one. A **scenario** vector asserts only relative outcomes, so it
 * also runs against a target whose document is whatever the loaded project
 * already holds — the real Host, which is the only target that proves the agent
 * claim.
 */

/** The schema identifier carried by every corpus file and every report. */
export const TRANSACTION_VECTOR_SCHEMA = "transaction-vectors/v1";

/** The two declared families. */
export type VectorFamily = "document" | "scenario";

/**
 * A capability a vector requires of its target, spelled with the engine's own
 * base-feature names. A target that does not advertise the capability is not
 * required to satisfy the vector: the runner reports it `skipped` with the
 * missing capability named, and refuses a `skipped` whose capability the target
 * *does* advertise.
 */
export type VectorRequirement = "validation" | "placement-policy";

/** A wire-safe entity as it appears at rest. Ticks are plain integers. */
export interface WireTrack {
	readonly id: string;
	readonly kind: string;
	readonly name: string;
	readonly hidden: boolean;
}

export interface WireClip {
	readonly id: string;
	readonly trackId: string;
	readonly startTime: number;
	readonly duration: number;
	readonly trimStart: number;
	readonly trimEnd: number;
	readonly assetId?: string;
}

export interface WireAsset {
	readonly id: string;
	readonly kind: string;
	readonly name: string;
	readonly duration?: number;
	readonly width?: number;
	readonly height?: number;
}

export interface WireMarker {
	readonly id: string;
	readonly time: number;
	readonly note?: string;
	readonly color?: string;
}

export interface WireFrameRate {
	readonly numerator: number;
	readonly denominator: number;
}

export interface WireProject {
	readonly id: string;
	readonly name: string;
	readonly frameRate: WireFrameRate;
	readonly canvasWidth: number;
	readonly canvasHeight: number;
}

/** An operation exactly as the frozen union spells it, with integer ticks. */
export type WireOperation = Readonly<Record<string, unknown>> & {
	readonly kind: string;
};

/**
 * The document a document-family vector starts from. `project` is separate from
 * the entity lists because no operation creates a Project: a target is opened
 * *over* a Project and mutates it with `update-project`.
 */
export interface VectorSeedDocument {
	readonly project: WireProject;
	readonly tracks: readonly WireTrack[];
	readonly clips: readonly WireClip[];
	readonly assets: readonly WireAsset[];
	readonly markers: readonly WireMarker[];
}

/** A batch as published: relative revision, explicit key, integer ticks. */
export interface VectorBatch {
	readonly operations: readonly WireOperation[];
	/**
	 * Offset from the target's own base revision, so the same vector is precise
	 * about conflict without assuming the target starts at zero. `0` asserts the
	 * current revision; `-1` is the stale-conflict case.
	 */
	readonly expectedRevisionOffset?: number;
	readonly idempotencyKey?: string;
	/**
	 * A kind outside the frozen union, appended as the batch's last operation.
	 * The loader rejects an unknown kind inside `operations`; this field is the
	 * one declared, reviewable way to exercise `unsupported-operation`.
	 */
	readonly unknownKindProbe?: string;
}

/** A field-by-field read-back assertion performed after a step. */
export interface VectorReadExpectation {
	readonly entity: "track" | "clip" | "asset" | "marker" | "project";
	readonly id: string;
	/** Present-with-these-values. Absent fields are not constrained. */
	readonly fields?: Readonly<Record<string, unknown>>;
	/** When `true`, the entity must NOT be present. */
	readonly absent?: boolean;
}

/**
 * A mutation probe: read an entity, mutate the returned value, read again, and
 * require the second read unchanged. Proves defensive cloning without naming
 * any internal storage.
 */
export interface VectorCloneExpectation {
	readonly entity: "track" | "clip" | "asset" | "marker";
	readonly id: string;
	readonly field: string;
	readonly mutateTo: unknown;
}

/** What a batch (or scenario step) must produce. */
export interface VectorExpectation {
	readonly outcome: "accepted" | "rejected" | "replayed";
	/** Required for `rejected`; a member of the contract's error-code union. */
	readonly errorCode?: string;
	/** Revision movement relative to the step's own base revision. */
	readonly revisionDelta: number;
	/** Watcher notifications observed across the step. */
	readonly watchDelta: number;
	/** Identities the step itself introduced, compared as a set. */
	readonly createdIds?: readonly string[];
	/** Identities the step modified or removed, compared as a set. */
	readonly changedIds?: readonly string[];
	/** Read-backs performed after the step settles. */
	readonly reads?: readonly VectorReadExpectation[];
	/** Clone probes performed after the step settles. */
	readonly clones?: readonly VectorCloneExpectation[];
	/**
	 * Engine issue codes `validate` must report for this batch. Checked only on
	 * a target advertising `validation`; a vector carrying this must declare the
	 * requirement.
	 */
	readonly issueCodes?: readonly string[];
	/** When present, `validate` must report this validity. */
	readonly valid?: boolean;
}

export interface DocumentVector {
	readonly id: string;
	readonly title: string;
	readonly requires?: readonly VectorRequirement[];
	readonly initialDocument: VectorSeedDocument;
	readonly batch: VectorBatch;
	readonly expect: VectorExpectation;
}

export interface ScenarioStep {
	readonly id: string;
	readonly intent: string;
	readonly batch: VectorBatch;
	readonly expect: VectorExpectation;
}

export interface ScenarioVector {
	readonly id: string;
	readonly title: string;
	readonly requires?: readonly VectorRequirement[];
	readonly steps: readonly ScenarioStep[];
}

export type TransactionVector = DocumentVector | ScenarioVector;

export interface DocumentVectorFile {
	readonly schema: typeof TRANSACTION_VECTOR_SCHEMA;
	readonly corpusVersion: number;
	readonly family: "document";
	readonly vectors: readonly DocumentVector[];
}

export interface ScenarioVectorFile {
	readonly schema: typeof TRANSACTION_VECTOR_SCHEMA;
	readonly corpusVersion: number;
	readonly family: "scenario";
	readonly vectors: readonly ScenarioVector[];
}

export type VectorFile = DocumentVectorFile | ScenarioVectorFile;

export interface VectorManifestEntry {
	readonly path: string;
	readonly sha256: string;
	readonly family: VectorFamily;
	readonly vectorCount: number;
}

export interface VectorManifest {
	readonly schema: typeof TRANSACTION_VECTOR_SCHEMA;
	readonly corpusVersion: number;
	readonly generatedBy: string;
	readonly declaredVectorCount: number;
	readonly files: readonly VectorManifestEntry[];
	readonly corpusDigest: string;
}

/** The parsed, validated corpus the runner and the coverage gate consume. */
export interface TransactionVectorCorpus {
	readonly schema: typeof TRANSACTION_VECTOR_SCHEMA;
	readonly corpusVersion: number;
	readonly declaredVectorCount: number;
	readonly corpusDigest: string;
	readonly documentVectors: readonly DocumentVector[];
	readonly scenarioVectors: readonly ScenarioVector[];
}

/** A structured load failure. Every refusal names the offending file/vector. */
export class TransactionVectorError extends Error {
	readonly code:
		| "schema"
		| "drift"
		| "duplicate-id"
		| "empty-expectation"
		| "wire-safety"
		| "unknown-member";
	readonly file?: string;
	readonly vectorId?: string;
	readonly field?: string;

	constructor(args: {
		code: TransactionVectorError["code"];
		message: string;
		file?: string;
		vectorId?: string;
		field?: string;
	}) {
		super(args.message);
		this.name = "TransactionVectorError";
		this.code = args.code;
		this.file = args.file;
		this.vectorId = args.vectorId;
		this.field = args.field;
	}
}

export function isDocumentVector(
	vector: TransactionVector,
): vector is DocumentVector {
	return "initialDocument" in vector;
}

export function isScenarioVector(
	vector: TransactionVector,
): vector is ScenarioVector {
	return "steps" in vector;
}
