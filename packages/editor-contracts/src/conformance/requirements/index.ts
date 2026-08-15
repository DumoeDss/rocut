/**
 * @opencutSurface experimental — requirement-index legibility layer over the frozen suites; test infrastructure, may be reorganized as suites evolve
 */
/**
 * The transaction-family requirement index (S05 P3).
 *
 * Four suites live in this package — transaction (T0), engine (T1), Draft
 * editing (T2) and the transaction vectors — and each reports case names a
 * reader outside this repository cannot map to the frozen requirement that was
 * violated. This module, published at `./conformance/requirements`, is the
 * bridge: every case name (and, for the vectors suite, every corpus vector id)
 * each suite can report, mapped to the frozen requirement it exercises, plus a
 * formatter that renders a report's failures requirement-first.
 *
 * The index is authored by READING the suites, never by editing them — the
 * suite modules are frozen and must stay diff-empty over this change. Drift is
 * guarded fail-closed in-repository: the committed index test runs every suite
 * against its reference implementation and refuses any reported name that has
 * no index row, so a case added or renamed in a suite without a row here fails
 * the test, not the reader.
 *
 * Mapping conventions:
 * - An id is `"<spec> / <requirement title>"` — both halves verbatim from the
 *   frozen `transaction-automation-api` spec, so the id greps to its
 *   requirement.
 * - The engine suite re-runs the transaction suite with every case name
 *   prefixed `T0: `; those rows are generated from the transaction rows at
 *   module scope rather than hand-duplicated, so the two spellings cannot
 *   drift apart.
 * - The vectors suite reports corpus vector ids, not prose case names; its rows
 *   are keyed by the corpus's stable vector ids.
 */
import type { ConformanceReport } from "../index";
import type { VectorRunReport } from "../../vectors";

/** One index row: the frozen requirement a case exercises, and its anchor. */
export interface RequirementIndexEntry {
	/** `"<spec name> / <requirement title>"`, both verbatim from the spec tree. */
	readonly requirement: string;
	/** The requirement scenario the case exercises, when one is a clean anchor. */
	readonly scenario?: string;
}

const TX = "transaction-automation-api";
const R_READ = `${TX} / The read interface queries project content`;
const R_APPLY = `${TX} / The apply interface submits atomic batches`;
const R_REVISIONS = `${TX} / Revisions are monotonic and conflicts are detected`;
const R_IDEM = `${TX} / Idempotency keys deduplicate applies`;
const R_ERRORS = `${TX} / Structured errors report failure detail`;
const R_CONTEXT = `${TX} / The getContext interface probes transaction metadata`;
const R_WATCH = `${TX} / The watch interface subscribes to revision changes`;
const R_T0_SUITE = `${TX} / A conformance suite validates any implementation`;
const R_ENGINE_PORT = `${TX} / A durable transaction engine consumes the frozen Host port`;
const R_DURABLE = `${TX} / Apply commits one ordered durable batch`;
const R_VALIDATE = `${TX} / Validation and dry-run are structured and non-mutating`;
const R_PLACEMENT = `${TX} / Placement policy enforces deterministic timeline validity`;
const R_FEATURES = `${TX} / Engine behavior is discoverable through typed features`;
const R_SNAPSHOT = `${TX} / Draft sessions capture isolated consistent base snapshots`;
const R_SAVEPOINT = `${TX} / Each Draft tool call has an atomic savepoint`;
const R_MODES = `${TX} / Draft approval modes and reviews are explicit`;
const R_APPROVAL = `${TX} / Approval is one conflict-checked transaction and one undo unit`;
const R_CLASSIFICATION = `${TX} / Draft-safe and immediate operations are formally separated`;
const R_RETENTION = `${TX} / Applied Draft resources survive source-package removal`;
const R_PROJECT = `${TX} / Project metadata updates are typed end-to-end transactions`;

/**
 * Every case name the transaction suite (T0) can report, mapped to the frozen
 * requirement it exercises.
 */
export const TRANSACTION_CONFORMANCE_REQUIREMENTS: Readonly<
	Record<string, RequirementIndexEntry>
> = {
	"read returns tracks and clips after mutations": {
		requirement: R_READ,
		scenario: "Read returns tracks and clips after mutations",
	},
	"apply creates entities and increments revision monotonically": {
		requirement: R_REVISIONS,
		scenario: "Revision increments monotonically",
	},
	"expected revision match succeeds": {
		requirement: R_REVISIONS,
		scenario: "Expected revision match succeeds",
	},
	"expected revision mismatch rejects with conflict": {
		requirement: R_REVISIONS,
		scenario: "Expected revision mismatch is rejected",
	},
	"idempotency dedup returns same result without revision change": {
		requirement: R_IDEM,
		scenario: "Same key and same operations returns the original result",
	},
	"idempotency collision with different operations is rejected": {
		requirement: R_IDEM,
		scenario: "Same key with different operations is rejected",
	},
	"an apply without a key is never deduplicated": {
		requirement: R_IDEM,
		scenario: "An apply without a key is never deduplicated",
	},
	"batch atomicity rolls back on failure": {
		requirement: R_APPLY,
		scenario: "A batch with one failing operation rolls back entirely",
	},
	"watch fires on successful apply": {
		requirement: R_WATCH,
		scenario: "Watch fires on a successful apply",
	},
	"watch does not fire on rejected apply": {
		requirement: R_WATCH,
		scenario: "Watch does not fire on a rejected apply",
	},
	"watch does not fire on idempotency dedup": {
		requirement: R_WATCH,
		scenario: "Watch does not fire on a rejected apply",
	},
	"unsubscribe prevents further callbacks": {
		requirement: R_WATCH,
		scenario: "Unsubscribe prevents further callbacks",
	},
	"getContext reports the current revision": {
		requirement: R_CONTEXT,
		scenario: "GetContext reports the current revision",
	},
	"getContext lists supported operation kinds": {
		requirement: R_CONTEXT,
		scenario: "GetContext lists supported operation kinds",
	},
	"Project updates execute atomically and idempotently": {
		requirement: R_PROJECT,
		scenario: "Project patches participate completely in idempotency",
	},
	"getContext returns a capabilities object": {
		requirement: R_CONTEXT,
	},
	"read results are defensively cloned": {
		requirement: R_READ,
		scenario: "Read results are defensively cloned",
	},
	"update operations apply partial patches": {
		requirement: R_APPLY,
		scenario: "Update operations apply partial patches",
	},
	"a case that executed no assertion is skipped": {
		requirement: R_T0_SUITE,
	},
	"not-found error identifies the failing operation index": {
		requirement: R_ERRORS,
		scenario: "A not-found error identifies the failing operation",
	},
	"a fresh store reports initial revision 0": {
		requirement: R_REVISIONS,
	},
};

/**
 * Every case name the engine suite (T1) can report: the T0 leg re-runs the
 * transaction suite with each name prefixed `T0: ` (generated from the
 * transaction rows so the spellings cannot drift), plus the engine's own
 * `T1: ` cases.
 */
export const TRANSACTION_ENGINE_CONFORMANCE_REQUIREMENTS: Readonly<
	Record<string, RequirementIndexEntry>
> = {
	...Object.fromEntries(
		Object.entries(TRANSACTION_CONFORMANCE_REQUIREMENTS).map(
			([name, entry]) => [`T0: ${name}`, entry] as const,
		),
	),
	"T1: zero-assertion control is skipped": {
		requirement: R_T0_SUITE,
	},
	"T1: one save atomically publishes one batch": {
		requirement: R_DURABLE,
	},
	"T1: delayed concurrent applies retain invocation order": {
		requirement: R_DURABLE,
		scenario: "Concurrent applies commit in invocation order",
	},
	"T1: rejected middle batch does not poison the queue": {
		requirement: R_DURABLE,
		scenario: "A rejected middle batch does not poison ordering",
	},
	"T1: save failure publishes nothing and the queue recovers": {
		requirement: R_DURABLE,
		scenario: "One durable failure publishes nothing",
	},
	"T1: revision and canonical keyed replay survive reopen": {
		requirement: R_DURABLE,
		scenario: "Revision and keyed replay survive reopen",
	},
	"T1: validation and dry-run are structured and pure": {
		requirement: R_VALIDATE,
		scenario: "Dry-run predicts a later successful apply",
	},
	"T1: validation waits for an earlier durable commit": {
		requirement: R_VALIDATE,
		scenario: "Validation waits for an earlier queued commit",
	},
	"T1: placement rejects collision and accepts adjacency": {
		requirement: R_PLACEMENT,
		scenario: "Adjacent clips are accepted",
	},
	"T1: provider policy adds issues without waiving base rejection": {
		requirement: R_PLACEMENT,
		scenario: "Provider policy composes without weakening the base policy",
	},
	"T1: provider policy receives a frozen disposable candidate": {
		requirement: R_PLACEMENT,
	},
	"T1: opaque provider fields survive adapter round-trip": {
		requirement: R_ENGINE_PORT,
		scenario: "Opaque provider fields survive a transaction",
	},
	"T1: Project dry-run/apply/replay/reopen preserves one durable candidate": {
		requirement: R_PROJECT,
		scenario: "A changed Project patch commits once and survives reopen",
	},
	"T1: Project frame-rate validates the complete final placement": {
		requirement: R_PROJECT,
		scenario: "Frame-rate changes validate the complete final placement",
	},
	"T1: queued and failed Project saves remain atomic": {
		requirement: R_PROJECT,
		scenario: "A changed Project patch commits once and survives reopen",
	},
	"T1: base and configured optional capabilities are honest": {
		requirement: R_FEATURES,
		scenario: "Base guarantees are probeable",
	},
	"T1: reserved base capability names are rejected": {
		requirement: R_FEATURES,
		scenario: "The current store limitation is reported honestly",
	},
};

/**
 * Every case name the Draft editing suite (T2) can report, mapped to the
 * frozen requirement it exercises.
 */
export const DRAFT_EDITING_CONFORMANCE_REQUIREMENTS: Readonly<
	Record<string, RequirementIndexEntry>
> = {
	"T2: zero-assertion control is skipped": {
		requirement: R_MODES,
	},
	"T2: opening captures an immutable consistent snapshot": {
		requirement: R_SNAPSHOT,
		scenario: "Opening captures one revision-consistent document",
	},
	"T2: torn snapshots retry and exhaustion is structured": {
		requirement: R_SNAPSHOT,
		scenario: "Opening retries a torn snapshot",
	},
	"T2: Draft ids are stable, non-empty, and unique": {
		requirement: R_SNAPSHOT,
		scenario: "Concurrent Drafts remain isolated",
	},
	"T2: sibling Drafts isolate working state and durable effects": {
		requirement: R_SNAPSHOT,
		scenario: "Concurrent Drafts remain isolated",
	},
	"T2: dependent calls accumulate and failed calls restore their savepoint": {
		requirement: R_SAVEPOINT,
		scenario: "Mid-sequence failure rolls back only that call",
	},
	"T2: provider policy rejection and throw leave the queue usable": {
		requirement: R_SAVEPOINT,
		scenario: "Mid-sequence failure rolls back only that call",
	},
	"T2: reviews are structured, ordered, and journal-derived": {
		requirement: R_MODES,
		scenario: "Review is derived from the journal",
	},
	"T2: manual approve and reject enforce terminal states": {
		requirement: R_MODES,
		scenario: "Manual Draft accumulates until an explicit decision",
	},
	"T2: auto mode applies once and never changes mode": {
		requirement: R_MODES,
		scenario: "Auto Draft uses the normal approval path",
	},
	"T2: same-Draft invocation order and terminal queue observation are stable":
		{
			requirement: R_MODES,
			scenario: "Mode fallback is forbidden",
		},
	"T2: empty and mode-incompatible approval are structured and non-terminal": {
		requirement: R_MODES,
		scenario: "Manual Draft accumulates until an explicit decision",
	},
	"T2: approval is one flattened apply with a stable receipt": {
		requirement: R_APPROVAL,
		scenario: "Manual approval commits one durable batch",
	},
	"T2: one sibling wins and a stale sibling conflicts without rebase": {
		requirement: R_APPROVAL,
		scenario: "Only one sibling Draft can win",
	},
	"T2: compensating transaction restores content and later work makes it stale":
		{
			requirement: R_APPROVAL,
			scenario: "Undo refuses to overwrite later work",
		},
	"T2: compensation stays inside the affected policy surface and is preflighted":
		{
			requirement: R_APPROVAL,
			scenario: "Compensation is minimal and policy-closed before apply",
		},
	"T2: Project patches review, roll back, apply once, compensate, and reject stale or invalid timebases":
		{
			requirement: R_PROJECT,
			scenario: "Drafts classify, review, and roll back Project patches",
		},
	"T2: every operation kind has an inverse and track cascades restore": {
		requirement: R_APPROVAL,
		scenario: "Receipt supplies one compensating batch",
	},
	"T2: undo restores complete ordering and absent optional properties exactly":
		{
			requirement: R_APPROVAL,
			scenario: "Ordered repair preserves exact base representation",
		},
	"T2: retention preflight blocks referenced assets before apply": {
		requirement: R_RETENTION,
		scenario: "Missing retained content blocks apply",
	},
	"T2: classification is exhaustive and immediate input is rejected before mutation":
		{
			requirement: R_CLASSIFICATION,
			scenario: "Immediate operation is rejected before Draft mutation",
		},
	"T2: optional engine feature literals remain observable": {
		requirement: R_FEATURES,
		scenario: "Optional provider features retain literal key types",
	},
};

/**
 * Every corpus vector id the vectors suite can report, mapped to the frozen
 * requirement the vector's subject exercises. Keyed by the corpus's stable
 * vector ids; the index test runs the suite over both reference target
 * factories so a corpus vector added without a row here fails the guard.
 */
export const TRANSACTION_VECTOR_REQUIREMENTS: Readonly<
	Record<string, RequirementIndexEntry>
> = {
	"document/create-track-and-clone": {
		requirement: R_READ,
		scenario: "Read results are defensively cloned",
	},
	"document/update-track": {
		requirement: R_APPLY,
		scenario: "Update operations apply partial patches",
	},
	"document/delete-track-cascade": {
		requirement: R_APPLY,
	},
	"document/create-asset-track-and-clip": {
		requirement: R_APPLY,
		scenario: "A batch of create operations applies atomically",
	},
	"document/update-clip-move": {
		requirement: R_APPLY,
		scenario: "Update operations apply partial patches",
	},
	"document/delete-clip": {
		requirement: R_APPLY,
	},
	"document/delete-asset": {
		requirement: R_APPLY,
	},
	"document/create-marker": {
		requirement: R_APPLY,
	},
	"document/update-marker": {
		requirement: R_APPLY,
		scenario: "Update operations apply partial patches",
	},
	"document/delete-marker": {
		requirement: R_APPLY,
	},
	"document/update-project": {
		requirement: R_PROJECT,
		scenario: "Patch keys and the resulting Project are validated",
	},
	"document/atomic-batch-rejection": {
		requirement: R_APPLY,
		scenario: "A batch with one failing operation rolls back entirely",
	},
	"document/stale-expected-revision": {
		requirement: R_REVISIONS,
		scenario: "Expected revision mismatch is rejected",
	},
	"document/not-found-apply": {
		requirement: R_ERRORS,
		scenario: "A not-found error identifies the failing operation",
	},
	"document/validation-not-found-issue": {
		requirement: R_VALIDATE,
		scenario: "Validation reports every attributable issue without mutation",
	},
	"document/validation-duplicate-id": {
		requirement: R_VALIDATE,
		scenario: "Validation reports every attributable issue without mutation",
	},
	"document/validation-missing-relation": {
		requirement: R_VALIDATE,
		scenario: "Validation reports every attributable issue without mutation",
	},
	"document/validation-invalid-entity": {
		requirement: R_VALIDATE,
		scenario: "Validation reports every attributable issue without mutation",
	},
	"document/validation-empty-batch": {
		requirement: R_VALIDATE,
		scenario: "Validation reports every attributable issue without mutation",
	},
	"document/validation-unsupported-operation": {
		requirement: R_VALIDATE,
		scenario: "Validation reports every attributable issue without mutation",
	},
	"document/validation-expected-revision-conflict": {
		requirement: R_VALIDATE,
		scenario: "Expected revision and idempotency are evaluated without reservation",
	},
	"document/placement-collision": {
		requirement: R_PLACEMENT,
		scenario: "A same-track collision is rejected atomically",
	},
	"document/placement-lane-incompatible": {
		requirement: R_PLACEMENT,
		scenario: "Asset and lane kinds must be compatible",
	},
	"document/placement-non-positive-duration": {
		requirement: R_PLACEMENT,
	},
	"document/placement-timebase-misaligned": {
		requirement: R_PLACEMENT,
		scenario: "Timebase misalignment is rejected",
	},
	"document/placement-source-out-of-bounds": {
		requirement: R_PLACEMENT,
		scenario: "Source bounds are enforced when duration is known",
	},
	"scenario/keyed-replay-and-reuse": {
		requirement: R_IDEM,
		scenario: "Same key and same operations returns the original result",
	},
	"scenario/keyed-reuse-issue": {
		requirement: R_IDEM,
		scenario: "Same key with different operations is rejected",
	},
	"scenario/agent-transaction-walk": {
		requirement: R_PROJECT,
		scenario: "Agent evidence exercises the twelfth operation without inference",
	},
};

const CONTRACT_INDEXES = [
	TRANSACTION_ENGINE_CONFORMANCE_REQUIREMENTS,
	DRAFT_EDITING_CONFORMANCE_REQUIREMENTS,
	TRANSACTION_CONFORMANCE_REQUIREMENTS,
] as const;

/**
 * The index row for a reported case name across the transaction-family suites
 * (engine first: its `T0: `-prefixed spellings are the strictest), or
 * `undefined` (index drift).
 */
export function requirementOf(
	caseName: string,
): RequirementIndexEntry | undefined {
	for (const index of CONTRACT_INDEXES) {
		const entry = index[caseName];
		if (entry !== undefined) return entry;
	}
	return undefined;
}

/** The index row for a reported vector id, or `undefined` (index drift). */
export function vectorRequirementOf(
	vectorId: string,
): RequirementIndexEntry | undefined {
	return TRANSACTION_VECTOR_REQUIREMENTS[vectorId];
}

const UNINDEXED = "(no requirement index row — report this case name upstream)";

/**
 * Render a report's failures requirement-first: the frozen requirement, then
 * the case (or vector), then the detail. Accepts the transaction-family
 * `ConformanceReport` (transaction, engine and Draft suites) and the vectors
 * `VectorRunReport`. Deliberately rendered from recorded `detail`/`failures`
 * strings alone — the suites record `Error.message`, never a stack — so the
 * rendering names the violated requirement before the mechanism that broke it.
 *
 * Worked example (the in-memory store with a `revision()` that never advances,
 * captured from the drift-guard test; the change's evidence log has the full
 * six-failure render, this is its head):
 *
 * ```
 * conformance failures: stale-revision target — 6 failed of 21
 * [transaction-automation-api / Revisions are monotonic and conflicts are detected]
 *   case: apply creates entities and increments revision monotonically
 *   detail: result.revision (2) !== read.revision() (0)
 * ```
 */
export function formatConformanceFailures(
	report: ConformanceReport | VectorRunReport,
): string {
	if ("results" in report && "families" in report) {
		return formatVectorFailures(report as VectorRunReport);
	}
	const typed = report as ConformanceReport;
	const failed = typed.results.filter(
		(result) => result.status === "failed",
	);
	const lines: string[] = [
		`conformance failures: ${typed.label} — ${failed.length} failed of ${typed.results.length}`,
	];
	for (const result of failed) {
		const entry = requirementOf(result.name);
		lines.push(`[${entry ? entry.requirement : UNINDEXED}]`);
		lines.push(`  case: ${result.name}`);
		lines.push(`  detail: ${result.detail ?? "(no detail recorded)"}`);
	}
	return lines.join("\n");
}

function formatVectorFailures(report: VectorRunReport): string {
	const lines: string[] = [
		`vector conformance failures: ${report.target} — verdict ${report.verdict} (${report.failureCodes.join(", ") || "none"})`,
	];
	for (const result of report.results) {
		if (result.failures.length === 0) continue;
		const entry = vectorRequirementOf(result.id);
		lines.push(`[${entry ? entry.requirement : UNINDEXED}]`);
		lines.push(`  vector: ${result.id} (${result.family}, ${result.status})`);
		for (const failure of result.failures) {
			lines.push(`  detail: ${failure}`);
		}
	}
	return lines.join("\n");
}
