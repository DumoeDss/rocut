# S08 Agent automation and Creator Studio integration progress

Date: 2026-09-28

Status: source integration complete for the high-level rocut CLI/host API and
both plugin producers. G8 remains open because the rocut plugin's upstream pin,
vendored runtime, dist artifact, and installed-artifact end-to-end exercise
have not been updated. The normal installed-WASM sync is also still awaiting
authorization; no installed binary or `node_modules` file was modified.

## Ownership boundary

The public automation path now accepts source material and editing intent, not
a caller-authored resolved plan:

- Rust/WASM parses plain text or LRC, imports JIZURA v1 JSON, chooses presets,
  resolves cuts, applies domain mutations, and creates variation candidates.
- The CLI host generates stable sequence/clip/optional track IDs, validates
  project and sequence revisions, and submits existing transaction operations.
- The transaction engine remains the only persistence writer and commits a
  created sequence plus its visible clip (and generated graphic track) as one
  project revision.
- React remains outside the API path. A headless host can catalog, read,
  create, mutate, import, preview a variation candidate, and apply a variation.
  Pixel rendering and export still require an attached editor pane.
- Creator Studio calls rocut. It does not write `project.json`, construct a
  motion-text sequence, or expose a separate JIZURA tool/workspace.

`@opencut/editor-classic/motion-text/factory` is the new React-free provider
entry. It publishes the typed Rust/WASM factory wrappers plus the exact Classic
renderer support manifest and the 889-entry drawable JIZURA catalog. The CLI
therefore cannot plan against presets its renderer does not advertise.

## Public CLI

The additive verbs are:

```text
rocut motion-text catalog
rocut motion-text list
rocut motion-text create <spec.json>
rocut motion-text mutate <sequence-id> <mutation.json>
rocut motion-text vary <sequence-id> <variation.json> [--apply]
```

Every verb reuses the existing `--target <id|auto>` and `--project <dir>`
routing. `catalog` is target-scoped so the response describes the runtime that
will execute the mutation, rather than a developer checkout.

`rocut read` remains backward-compatible at its top level: `tracks` is still a
count and `project` is still the project name. It now adds counts for clips,
assets, markers and motion-text sequences, the full project as
`projectEntity`, and full stable entities under:

```json
{
	"entities": {
		"tracks": [],
		"clips": [],
		"assets": [],
		"markers": [],
		"motionTextSequences": []
	}
}
```

This closes the previous contradiction in the rocut skill, which told agents
to read IDs even though the CLI returned only a track count.

## Create request

Plain text and LRC use the following shape:

```json
{
	"source": "LIGHTS RISE\nWE MOVE",
	"sourceFormat": "plain",
	"language": "en",
	"duration": 360000,
	"startTime": 0,
	"trackId": "optional-existing-graphic-track",
	"trackName": "Motion text",
	"starterPreset": "impact-title",
	"seed": 7,
	"expectedRevision": 0,
	"idempotencyKey": "creator:motion-text:lights-rise:v1"
}
```

`expectedRevision` and `idempotencyKey` are required. If `trackId` is absent,
the host creates a graphic track in the same atomic transaction. Sequence,
clip and generated-track IDs are derived from the idempotency key, so retrying
the identical request reports the original revision and IDs instead of
creating duplicates.

JIZURA import uses `sourceFormat: "jizura"` with the inert source JSON text in
`source`. It rejects unrelated plain/LRC fields rather than silently ignoring
them. Rust determines the imported duration, language, seed, fonts, timing and
resolved plan, and the response includes its compatibility report, missing
resources and diagnostics.

The create response returns:

- project and sequence revisions;
- stable sequence, clip and track IDs;
- transaction `createdIds`/`changedIds`;
- affected cue/cut IDs;
- Rust diagnostics and, for JIZURA, compatibility/resource details.

## Mutation and synchronization

`motion-text mutate` accepts only one existing canonical
`MotionTextSequenceMutation`, plus both concurrency tokens:

```json
{
	"mutation": {
		"kind": "update-planning-controls",
		"controls": {
			"presetSets": { "horror": false, "typo": true, "kinetic": true },
			"unify": true,
			"centerFree": true,
			"centerDirection": "tb"
		}
	},
	"expectedRevision": 1,
	"expectedSequenceRevision": 0,
	"idempotencyKey": "creator:motion-text:planning:v1"
}
```

The public kind set covers planning controls, defaults, cue edits, cue/cut and
preset/parameter locks, cut boundaries, tap timing, audio binding, explicit
audio-timing synchronization, manual beat override and binding removal. Rust
validates the complete per-kind payload and returns the replacement sequence;
the host alone turns that replacement into an
`update-motion-text-sequence` transaction.

The result calculates affected cue/cut IDs by comparing the committed source
and Rust result. A stale entity revision returns HTTP 409 with stable code
`motion-text-sequence-conflict`, `sequenceId`,
`expectedSequenceRevision`, and `actualSequenceRevision`. A stale project
revision continues to use the transaction contract's `conflict` code and
expected/actual project revisions.

The host also keeps a request-fingerprint journal for its lifetime. An exact
create/mutate/applied-variation retry returns the original high-level response
with `replayed: true`, before stale revision checks; reusing the same key for a
different intent fails with `motion-text-idempotency-conflict`. The transaction
engine remains the durable idempotency authority. After a host restart, a
late domain retry that can no longer reconstruct its original Rust input fails
closed on sequence revision or transaction-key conflict and must be read back,
not silently applied again.

## Variation protocol

A variation request contains a stable salt, optional cue IDs, the preset
groups to reroll, and the expected sequence revision. Without `--apply`, Rust
returns a candidate with base/candidate revisions, exact affected IDs and the
candidate sequence; project state does not change. Applying requires the same
request plus current `expectedRevision` and a new `idempotencyKey`:

```text
rocut motion-text vary <sequence-id> variation.json --apply
```

The host regenerates the candidate against the currently committed sequence
inside its mutation queue. It refuses a stale base before transaction apply,
so an agent cannot apply a candidate after either the user or another agent
has changed the sequence.

## Error shape

Motion-text request errors are JSON objects with `accepted: false`, a stable
`code`, a message and applicable diagnostic/revision fields. Factory rejection
uses HTTP 422 and `motion-text-factory-rejected`; not-found uses HTTP 404;
entity concurrency uses HTTP 409. The CLI preserves its human `rocut:` line
and adds a second machine-readable JSON details line for failed HTTP requests.
Reusing a high-level idempotency key for a changed request uses HTTP 409 and
`motion-text-idempotency-conflict`.

## Producer integration

The rocut plugin producer's `rocut-studio` skill now:

- documents schema version 32 and the actual unambiguous `--target auto`
  behavior;
- uses `read.entities` and `motion-text list` as ID/revision sources;
- gives real catalog/create/mutate/vary commands and JIZURA import rules;
- requires high-level motion-text commands instead of generic sequence apply;
- describes project/sequence conflict recovery and old-plugin fail-closed
  behavior.

Creator Studio's system prompt, creation doctrine, `/edit`, and `/status` now
treat motion typography, subtitles and lyrics as rocut-native work. They
require read-back of both revisions and stable cue/cut IDs, keep visual choice
with the user, and explicitly refuse to emulate a missing old-plugin capability
by hand-writing project data.

No `upstream.json`, `vendor/`, `dist/`, installed plugin, release, or host
resource was modified in this slice. The producer source pipeline now validates
every retained surface `asset-manifest.json` path, byte count and SHA-256 after
the branding rewrite; focused fixtures prove motion-text TTF/OFL entries survive
unchanged, tampered copied bytes fail, and an orphan motion-text file outside the
manifest is rejected before provenance/dist assembly. A conditional licence
gate also prevents a future font-bearing surface from being vendored until the
producer NOTICE explicitly discloses `motion-text/fonts` and OFL-1.1; the old
font-free pin does not trigger a false attribution.

## Verification

Passed:

```text
bun test apps/cli/src/__tests__/motion-text.test.ts
  2/2 tests, 45 assertions

bun test apps/cli/src/__tests__/cli-verbs.test.ts \
         apps/cli/src/__tests__/host.test.ts \
         apps/cli/src/__tests__/motion-text.test.ts \
         apps/cli/src/__tests__/motion-text-routing.test.ts \
         apps/cli/src/__tests__/motion-text-restart.test.ts \
         apps/cli/src/__tests__/motion-text-cli-errors.test.ts \
         apps/cli/src/__tests__/motion-text-mixed-edit.test.ts \
         apps/cli/src/__tests__/motion-text-stress.test.ts
  23/23 tests, 201 assertions

cd apps/cli && bun run typecheck
  PASS

bun run check:packages
  PASS

bun run check:surface-labels
  PASS

npm test  # elftia-plugin-rocut
  52/52

$env:ROCUT_TEST_REAL_VENDOR = "0"; npm test  # clean-clone source mode
  47/47 source tests; 5 real-vendor assertions skipped

npm run typecheck && npm test && npm run test:runtime-abi  # elftia-plugin-creator-studio
  PASS; 26/26 behavior tests; 10/10 runtime-ABI tests
```

The canonical integration test injects the generated
`rust/wasm/pkg/opencut_wasm_sync.js` cores without copying them into an
installed dependency. It proves:

- the target runtime reports 889 drawable JIZURA catalog entries;
- create commits sequence+clip+track in one project revision;
- identical idempotent replay returns the same revision and IDs;
- planning-control mutation advances project and sequence revisions once;
- exact mutation and applied-variation retries replay their original result,
  while changed intent under the same key is rejected;
- stale sequence revision returns structured conflict fields with no write;
- variation preview leaves the project unchanged and apply advances once;
- JIZURA v1 import returns compatibility/resource information;
- the real CLI exercises `catalog`, `create`, `list`, `mutate`, variation
  preview and `vary --apply` through the authenticated host;
- CLI variation preview does not advance either stored revision, while apply
  advances both revisions and `rocut read` exposes the same stable
  track/clip/sequence IDs afterward;
- two concurrent project hosts may safely reuse the same intent key: explicit
  `--project` routing keeps their request journals, languages and revisions
  isolated while one project is mutated;
- a combined routing fixture starts from two schema-v31 projects with distinct
  opaque provider fields, migrates them through the published v31-to-v32
  chain, creates `zh-Hans` and `ja` sequences while both Hosts are live, then
  closes/reopens both projects and proves stable IDs, text, language,
  revisions, provider fields and durable idempotent replay remain isolated;
- after a Host restart, a repeated create is recovered by the durable
  transaction journal without duplicating entities, while a late mutation retry
  with an obsolete sequence revision fails closed and requires read-back;
- the real CLI preserves its human-readable HTTP 409 stderr summary and emits a
  second JSON line containing the method, status, stable
  `motion-text-sequence-conflict` code and expected/actual sequence revisions;
- a transaction-produced external editor record advances both project and
  sequence state; a stale Agent mutation then fails without writing, and its
  read-back/retry preserves the user's cue edit while applying the Agent intent;
- canonical F04/F05 sequences containing 120 and 600 cues persist together,
  reopen without identity drift and durably replay the large F05 create without
  advancing project revision or duplicating entities.

## Remaining G8 work

G8 is not closed. The remaining ordered work is:

1. Obtain authorization for the normal dependency sync so installed root and
   web WASM match the canonical binary; rerun the full WASM gates.
2. From a verified rocut commit, update the rocut plugin upstream pin and run
   its normal vendor pipeline. Do not copy source or binary files by hand.
3. Run the prepared manifest/provenance gates against the new vendored runtime
   and verify it contains this CLI, canonical WASM, surface, fonts and catalog
   closure; build and verify plugin dist.
4. Exercise the installed artifact with no sibling checkout: create, local
   mutation, user edit, stale conflict/read/retry, variation apply, structural
   read-back and export.
5. Keep the existing zh-Hans font-resource failure explicit; it is an S07/S09
   delivery blocker and must not be hidden by weakening glyph validation.
