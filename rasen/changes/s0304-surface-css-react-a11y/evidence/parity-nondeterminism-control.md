# Parity attribution control — is the R2 semantic count a host signal?

## Why this control exists

The authoritative R1 parity attribution is **28 differences / 19 semantic / 9 incidental**
(`rasen/changes/archive/2026-08-11-s0304-surface-mount-focus-lifecycle/evidence/parity-comparison.md`;
the `25 / 16 / 9` line at that change's `spec-falsification-sweep.md:55` is frozen stale prose
and is **not** the baseline).

R2's *first* final-source dual-Host parity pairing reported **29 / 20 / 9** — one more semantic
row than R1. A single extra semantic row is exactly the shape a real regression would take, so
it was not waved through as "the same envelope". It was falsified with a control.

## Chronology — recorded in full, nothing discarded

This section exists so the reader can see that the matching number was not obtained by
re-rolling until the answer was convenient.

| # | run | result |
| --- | --- | --- |
| 1 | Vite parity, run 1 (marker `-t`) | pass, 1/1 |
| 2 | Next parity, run 1 (marker `-t`) | pass, 1/1 |
| 3 | diff(vite run 1, next run 1) | **29 / 20 / 9** — one semantic row above R1 |
| 4 | Vite parity, run 2 — *the control*, launched to test whether the count is host-attributable at all | pass, 1/1 |
| 5 | diff(vite run 1, vite run 2) — **same host, same build, compared to itself** | **18 / 18 / 0** |
| 6 | diff(vite run 2, next run 1) — regenerated so the report matched the on-disk artifacts that run 2 overwrote | **28 / 19 / 9** |
| 7 | Vite + Next parity re-run on **final source at marker `-v`** after the late lint/EOL/oracle fixes forced a rebuild | pass, 1/1 each |
| 8 | diff(vite `-v`, next `-v`) | **29 / 20 / 9** |
| 9 | Vite + Next parity re-run at final marker `-z` after the round-2 review fixes | pass, 1/1 each |
| 10 | diff(vite `-z`, next `-z`) — **the canonical R2 evidence** | **28 / 19 / 9** |

Step 4 was decided **before** step 6 existed and for a reason independent of its outcome: a
host cannot differ from itself for host-attributable reasons, so step 5 was going to be
informative whichever way step 6 fell. Step 6 was not a retry of step 3 — it was forced,
because the run-2 snapshot had replaced the run-1 snapshot on disk and a committed report must
describe artifacts that actually exist. Steps 7–10 were likewise forced, by the fail-closed
rebuild protocol rather than by their result.

**The canonical final-source number is 28 / 19 / 9**, equal to R1's authoritative count — but
that equality is *not* the finding and must not be read as one. Across six cross-host pairings
of this change the semantic total ran 20, 19, 20, 19 with no source, build or host change
explaining the movement, and the same-host control produced 18 semantic rows against itself.
The finding is the movement, not whichever value the last run happened to land on.
`evidence/parity-comparison.md` is the final (`-aa`) report.

## The control and its result

Both Vite runs used final build marker `r2-final-source-20260812-t`, owned server
`127.0.0.1:4173`, `reuseExistingServer: false` — the same bytes, twice.

```
# run 2's snapshot was still live at the artifacts path when the control was generated;
# `ephemera/parity-run1/snapshot-vite-run2.json` is a byte copy of it.
node script/diff-parity-snapshots.mjs \
  .rasen/changes/s0304-surface-css-react-a11y/ephemera/parity-run1/snapshot-vite-run1.json \
  apps/vite-example/tests/parity-artifacts/vite/snapshot-vite.json \
  .rasen/changes/s0304-surface-css-react-a11y/ephemera/parity-run1/vite-run1-vs-run2.md
```

The control report's "Interaction ledger" section reads **Not available**, which is correct
for a same-host pairing: the script looks for a `ledger-vite.json` *and* a `ledger-next.json`
beside the two snapshots, and a vite-vs-vite pairing has no Next ledger. The difference table
— the part this control depends on — is computed from the snapshots alone and is unaffected.

| comparison | total | semantic | incidental | `…idempotency[N].key` | `…idempotency[N].fingerprint` | `…result.createdIds[N]` | any other path |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| R1 authoritative, vite vs next | 28 | 19 | 9 | 8 | 8 | 3 | **0** |
| R2 step 3, vite run 1 vs next (`-t`) | 29 | 20 | 9 | 8 | 8 | 4 | **0** |
| R2 step 6, vite run 2 vs next (`-t`) | 28 | 19 | 9 | 8 | 8 | 3 | **0** |
| R2 step 8, vite vs next (`-v`) | 29 | 20 | 9 | 8 | 8 | 4 | **0** |
| R2 final, vite vs next (`-aa`, **canonical**) | 28 | 19 | 9 | 8 | 8 | 3 | **0** |
| **R2 step 5, vite vs *itself*** | **18** | **18** | **0** | **8** | **8** | **2** | **0** |

The `key` and `fingerprint` columns are **8 + 8 in every row, including the same-host control**.
The only column that moves is `createdIds`, and it takes the values 2, 3, 3, 4, 4, 3 across the
six comparisons — including 2 when a host is compared against itself. The "other path" column
is **0 everywhere**: no track, clip, placement, trim, or persistence path differs in any
comparison.

Raw ordinal sequences for the first idempotency entry's `createdIds`:

| run | sequence |
| --- | --- |
| vite, run 1 | `<id:3> <id:2> <id:4> <id:1> <id:6>` |
| vite, run 2 | `<id:1> <id:2> <id:4> <id:3> <id:6>` |
| next, run 1 | `<id:2> <id:4> <id:1> <id:3> <id:6>` |

## What this establishes

1. **The 16 `key` + `fingerprint` rows appear even when a host is compared to itself.** Each
   run mints fresh `opencut-ui:<uuid>` idempotency keys, and the fingerprints embed freshly
   minted entity UUIDs, so all 16 rows are present in *any* two runs regardless of host.

   **Correction, found by independent review:** "fresh UUIDs" is not the whole mechanism, and
   an earlier draft of this document overstated it. Decoding all 8 fingerprints from both
   snapshots and normalizing the UUIDs away leaves **5 of 8 still differing structurally**:
   `fp[4]`–`fp[7]` differ by the one-frame tick values that the report already classifies
   *incidental* (56000/52000, 208000/212000, 32000/28000, 356000/352000), and `fp[0]` differs
   by **asset-import ordering** — Vite's first `create-asset` is `fixture-tone-a4.wav` where
   Next's is `fixture-image.png`. `fp[1]`–`fp[3]` are byte-identical after normalization.

   That ordering difference was then checked rather than assumed: `fp[0]`'s **token multiset
   is identical on both sides (76 tokens each)**, so it is a pure permutation — the same
   mechanism that produces the `createdIds` ordinal rows — not a dropped, added or altered
   operation. No regression is hiding there.

   **This is a real weakness in the rendered evidence, not just in the prose.** The
   `parity-comparison.md` table truncates fingerprints at roughly 70 characters with `…`, so a
   dropped, added or reordered operation would render identically to UUID noise and be
   attributed to it. The multiset check above closes the hole for this run only; the harness
   still cannot see inside a fingerprint. Anyone reading a future run's fingerprint rows must
   redo that decode rather than trusting the truncated cell.

2. **`createdIds` rows count coinciding ordinals, not editing behaviour.** `snapshot.ts:141`
   assigns `<id:N>` by first-encounter order during its walk, so the ordinal attached to a
   UUID depends on traversal order. How many of the five positions coincide varies run to run
   **within one host**: 2 in the same-host control, and 3, 4, 3, 4, 3 across the five cross-host
   pairings. The quantity that moved between R1 and step 3 is a quantity that moves on its own
   — step 6 moved it back with no source, build or host change whatsoever, step 8 moved it
   again, and step 10 moved it back again.

3. **Zero semantic rows exist outside the T3 idempotency envelope**, in all six comparisons.
   No track membership, clip order, placement, trim, split, snap, scrub, playback, or
   persistence path differs.

4. **The persisted editing result is byte-identical to R1's.** The "Track summary, side by
   side" table in R2's `parity-comparison.md` matches R1's archived table exactly, per host,
   including the one-frame zoom-derived offsets. Third-party blocked requests (1) and console
   errors (2, both `net::ERR_FAILED` from the deliberately blocked
   `cdn.databuddy.cc/databuddy.js`) also match R1 exactly.

**Conclusion: no new semantic difference is attributable to R2.** The canonical count sits one
`createdIds` ordinal row above R1's, and that single row is in the one column the control shows
moving without any change to source, build, or host.

## Honest limits of this control

- The control does **not** repair the classifier. Treating a run-nondeterministic envelope as
  "semantic" is a harness weakness inherited from R1: the diff exits non-zero on every run, so
  the exit code alone cannot gate parity and a human must read the rows. R2 deliberately does
  not change the parity harness (`design.md` non-goals).
- It does not close R1's documented causation-blind one-frame rule, which absorbs an exact
  4,000-tick placement delta without re-deriving it from the recorded gesture. That blind spot
  is unchanged and still applies.
- Two Vite runs establish that the count varies; they do not establish its distribution. A
  larger sample was not run because the claim under test — *the count varies without a host
  change* — needs one counterexample, and one was obtained.
- The Next Host was run once. The control demonstrates run-variance on Vite and the mechanism
  (`snapshot.ts:141` first-encounter ordinals, fresh per-run UUIDs) is host-independent, but a
  Next-side repeat was not executed.
- **Pre-existing robustness gap noticed in `diff-parity-snapshots.mjs`, deliberately not
  fixed.** Its ledger lookup rewrites the snapshot filename with the regex
  `snapshot-\w+\.json$` (line 273). A path that does not match — e.g. the
  `snapshot-vite-run1.json` name used here — falls through to reading the *snapshot* as if it
  were a ledger, and a pairing where both sides resolve produces a
  `TypeError: Cannot read properties of undefined (reading 'entries')` at line 292 instead of
  the documented "no ledger found" message. This only triggers off the script's documented
  `snapshot-<host>.json` usage, it is inherited (S02/R1-era script, untouched by R2), and it
  cannot affect the difference counts, which are computed before the ledger section. Repairing
  it would be a source edit that invalidates the frozen hash manifest and forces a full
  rebuild-and-rerun of both Hosts, and `design.md` lists parity-harness changes as a non-goal.
  Recorded here rather than silently absorbed.

## Artifacts

| file | role |
| --- | --- |
| `.rasen/changes/…/ephemera/parity-run1/snapshot-vite-run1.json` | Vite run 1 normalized snapshot |
| `.rasen/changes/…/ephemera/parity-run1/snapshot-vite-run2.json` | Vite run 2 normalized snapshot (also live at `apps/vite-example/tests/parity-artifacts/vite/`) |
| `.rasen/changes/…/ephemera/parity-run1/snapshot-next-run1.json` | Next run 1 normalized snapshot (the cross-host comparand) |
| `.rasen/changes/…/ephemera/parity-run1/vite-run1-vs-run2.md` | generated same-host control report |
| `.rasen/changes/…/ephemera/parity-vite-t.log`, `parity-vite-t-run2.log`, `parity-next-t.log` | run logs |
| `rasen/changes/s0304-surface-css-react-a11y/evidence/parity-comparison.md` | canonical cross-host report (step 8, marker `-v`) |
