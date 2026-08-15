/**
 * The port-conformance requirement index (S05 P3).
 *
 * A conformance report names its cases; a reader who is not this repository has
 * no way to know which frozen requirement a failed case violates. This module
 * is that bridge, published beside the suite at `./conformance/requirements`:
 * every case name `runPortConformance` can report, mapped to the frozen
 * requirement (spec name + requirement title, with the anchoring scenario where
 * one exists) that case exercises, plus a formatter that renders a report's
 * failures requirement-first.
 *
 * The index is authored by READING the suite, never by editing it — the suite
 * modules are frozen and must stay diff-empty over this change. Drift is
 * guarded fail-closed in-repository: `__tests__/requirements-index.test.ts`
 * runs the suite against the in-memory reference implementation and refuses any
 * reported case name that has no index row, so a case added or renamed in the
 * suite without a row here fails the test, not the reader.
 *
 * Mapping conventions:
 * - An id is `"<spec> / <requirement title>"` — both halves are verbatim from
 *   the frozen spec tree, so the id greps straight to its requirement.
 * - Where a case exercises a port role's basic contract rather than a deeper
 *   frozen decision, it is indexed to the requirement that mandates one
 *   conformance case matrix over every port role — that mandate is the decision
 *   the case exists to enforce.
 * - `"the suite covers this port"` is a synthetic sentinel the suite reports
 *   (as a failure) when a port role has no cases at all; it is indexed here so
 *   the guard accepts it, and so its rare appearance also reads as a
 *   requirement violation.
 */
import type { ConformanceReport } from "./index";

/** One index row: the frozen requirement a case exercises, and its anchor. */
export interface PortRequirementIndexEntry {
	/** `"<spec name> / <requirement title>"`, both verbatim from the spec tree. */
	readonly requirement: string;
	/** The requirement scenario the case exercises, when one is a clean anchor. */
	readonly scenario?: string;
}

const HP = "host-port-contract";
const COHERENT = `${HP} / The Host contract is one coherent surface`;
const OPAQUE_PORTS = `${HP} / No port signature exposes an editor-internal or storage-mechanism type`;
const WORKER = `${HP} / A worker is expressed so that a same-origin Host can implement it`;
const GRAPHICS = `${HP} / Graphics capability is negotiated, and the report is produced by the runtime`;
const MATRIX = `${HP} / Every port has an in-memory reference implementation and a conformance suite`;
const STORAGE_FAIL = `${HP} / Storage operations have explicit failure and cancellation semantics`;
const SCOPES = `${HP} / Durable storage scopes are isolated while intentional sharing remains visible`;
const MIGRATION = `editor-session-runtime / Schema migration is owned by the store implementation and run once per session creation`;
const DEGRADE = `host-service-boundary / Unavailable server-backed features degrade visibly and non-blockingly`;

/**
 * Every case name the port conformance suite can report, mapped to the frozen
 * requirement it exercises. Guarded against suite drift by the committed index
 * test; the suite itself is never edited to carry this mapping.
 */
export const PORT_CONFORMANCE_REQUIREMENTS: Readonly<
	Record<string, PortRequirementIndexEntry>
> = {
	"declares a schema version": {
		requirement: MIGRATION,
		scenario: "The store declares its schema version and its migration",
	},
	"a known edit round-trips without losing opaque nested fields": {
		requirement: OPAQUE_PORTS,
		scenario: "Persisted project content crosses the boundary opaquely",
	},
	"project values are defensively cloned in both directions": {
		requirement: MATRIX,
		scenario: "The reference implementation is working, not stubbed",
	},
	"list reports the saved summary": {
		requirement: OPAQUE_PORTS,
		scenario: "Persisted project content crosses the boundary opaquely",
	},
	"list carries no project content": {
		requirement: OPAQUE_PORTS,
		scenario: "Persisted project content crosses the boundary opaquely",
	},
	"missing project, attachment, and library values return null": {
		requirement: STORAGE_FAIL,
		scenario: "Missing data is not an infrastructure failure",
	},
	"record and summary identities match or fail before commit": {
		requirement: STORAGE_FAIL,
	},
	"attachments save, load, list, replace, and remove exactly": {
		requirement: OPAQUE_PORTS,
		scenario: "Attachments and libraries remain mechanism-neutral",
	},
	"attachment scope and project cascade are isolated": {
		requirement: SCOPES,
		scenario: "Equal attachment keys in different projects do not collide",
	},
	"libraries save, load, list, replace, remove, and isolate namespaces": {
		requirement: SCOPES,
		scenario: "Equal keys in different library namespaces do not collide",
	},
	"capacity zero is distinct from unavailable storage": {
		requirement: MATRIX,
	},
	"an uncloneable opaque value is a typed corrupt failure": {
		requirement: STORAGE_FAIL,
		scenario: "Platform failures do not cross the port by name",
	},
	"typed failures happen before attachment replacement commits": {
		requirement: STORAGE_FAIL,
		scenario: "Attachment replacement is all-or-previous",
	},
	"pre-aborted reads and writes do no work": {
		requirement: STORAGE_FAIL,
		scenario: "A pre-aborted operation cannot mutate storage",
	},
	"same-key mutations serialize while distinct keys progress": {
		requirement: STORAGE_FAIL,
		scenario: "Durable command ordering is preserved",
	},
	"hierarchical mutations preserve invocation order without identity collisions":
		{
			requirement: STORAGE_FAIL,
			scenario: "Durable command ordering is preserved",
		},
	"clear scopes preserve their documented boundary": {
		requirement: SCOPES,
	},
	"migration brings the store to its declared version": {
		requirement: MIGRATION,
		scenario: "Migration runs once, before any project load",
	},
	"remove deletes the record and the summary": {
		requirement: MATRIX,
	},
	/** Synthetic: reported only when a port role has no cases at all. */
	"the suite covers this port": {
		requirement: MATRIX,
	},
	"resolves a logical path to a location": {
		requirement: MATRIX,
	},
	"does not hard-code a root-absolute location": {
		requirement: OPAQUE_PORTS,
	},
	"reports a missing asset as an error": {
		requirement: MATRIX,
	},
	"the host constructs the worker and returns a handle": {
		requirement: WORKER,
	},
	"the worker handle delivers messages": {
		requirement: WORKER,
	},
	"a rewritten worker location is conforming": {
		requirement: WORKER,
	},
	"an audio context is created and closable": {
		requirement: MATRIX,
	},
	"an object URL is created and revocable": {
		requirement: MATRIX,
	},
	"declares whether it can export": {
		requirement: MATRIX,
	},
	"an unsupported export says so rather than failing": {
		requirement: DEGRADE,
	},
	"accepts a log record": {
		requirement: MATRIX,
	},
	"accepts a session-scoped event": {
		requirement: MATRIX,
	},
	"ids are unique within a scope": {
		requirement: MATRIX,
	},
	"scopes are independent": {
		requirement: MATRIX,
	},
	"declares a graphics mode": {
		requirement: GRAPHICS,
	},
	"the host declares but never asserts the report": {
		requirement: GRAPHICS,
	},
	"a forced no-rasterizer declaration yields a zero limit": {
		requirement: GRAPHICS,
	},
};

/** The index row for a reported case name, or `undefined` (index drift). */
export function portRequirementOf(
	caseName: string,
): PortRequirementIndexEntry | undefined {
	return PORT_CONFORMANCE_REQUIREMENTS[caseName];
}

const UNINDEXED = "(no requirement index row — report this case name upstream)";

/**
 * Render a report's failures requirement-first: the frozen requirement, then
 * the case, then the detail. Deliberately rendered from `detail` alone — the
 * suite records `Error.message`, never a stack — so a reader of the rendering
 * sees the violated requirement before the mechanism that broke it.
 *
 * Worked example (a store that replaces the opaque payload on load, captured
 * from the drift-guard test; see the change's evidence for the capture):
 *
 * ```
 * conformance failures: json-normalizing store — 2 failed of 36
 * [host-port-contract / No port signature exposes an editor-internal or storage-mechanism type]
 *   port: store, case: a known edit round-trips without losing opaque nested fields
 *   detail: project payload is not an object
 * [host-port-contract / Every port has an in-memory reference implementation and a conformance suite]
 *   port: store, case: project values are defensively cloned in both directions
 *   detail: project payload is not an object
 * ```
 */
export function formatConformanceFailures(report: ConformanceReport): string {
	const failed = report.results.filter(
		(result) => result.status === "failed",
	);
	const lines: string[] = [
		`conformance failures: ${report.label} — ${failed.length} failed of ${report.results.length}`,
	];
	for (const result of failed) {
		const entry = PORT_CONFORMANCE_REQUIREMENTS[result.name];
		lines.push(`[${entry ? entry.requirement : UNINDEXED}]`);
		lines.push(
			`  port: ${result.port}, case: ${result.name}`,
		);
		lines.push(`  detail: ${result.detail ?? "(no detail recorded)"}`);
	}
	return lines.join("\n");
}
