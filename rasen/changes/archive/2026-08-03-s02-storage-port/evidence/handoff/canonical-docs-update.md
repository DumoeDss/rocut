# C5 canonical documentation update

Date: 2026-08-02  
Scope: task 12.3 normative documentation only; no product code, tests, task checkboxes, run-state,
review report, proposal/design/delta spec, or commit changes

## Changed paths

- `BOUNDARIES.md`
  - Added section 3's private physical-topology boundary at actual mutation granularity: exact
    library `(database, store)` pair, whole media database plus exact OPFS root, and whole migration
    databases.
  - Recorded the five reserved projects/control pairs, current and strictly retained protected
    media/library/stage/legacy domains, and the valid shared projects-database/distinct-library-store
    positive configuration.
  - Distinguished current precommit refusal from historical retain-without-rewrite/no-partial-I/O
    behavior, including same-project-ID consequences and same-owner idempotent retry.
  - Recorded complete migration-batch preauthorization, including all possible v1 transformer
    timeline/media sources before transformer I/O, and stated that source access does not confer
    cleanup deletion authority.
  - Added mechanism-neutral `unavailable`, fixed nonretryable maintenance phase, and non-leaking
    diagnostic requirements.
- `apps/web/src/editor/ports/DECISIONS.md`
  - Updated the document count to eight decisions and appended decision 8 using the established
    `What forced it / What it rules out / What it does not claim` structure.
  - Explained why authentic durable identity alone cannot prove whole-database/root isolation, why
    the centralized topology policy remains private, and why neither a new public port nor a global
    durable topology registry is introduced.
- `FEATURE_HANDLING.md`
  - Extended only the `store` row with the user-observable generic-unavailable-before-mutation
    behavior and a link to `BOUNDARIES.md` section 3; no physical names are duplicated there.
- `PARITY.md`
  - Intentionally unchanged by this documentation patch.

## Intentionally deferred measured fields

- Do not replace `BOUNDARIES.md`'s Vite module, source-graph, copied-asset, emitted-asset, or byte
  counts until tasks 11.3 and 11.7 produce fresh authoritative outputs.
- Do not edit `PARITY.md`'s generated difference/leaf rows or counts before tasks 11.5 and 11.6.
  Any real update must come only from `script/diff-parity-snapshots.mjs` against the protected rerun.
- This patch makes no claim that product review, build, parity, regression, provenance, or final
  cleanup gates are clean.

## Checks

- `bunx prettier --write FEATURE_HANDLING.md` - exit 0.
- `bunx prettier --write <handoff>/canonical-docs-update.md` - exit 0.
- `bunx prettier --check BOUNDARIES.md FEATURE_HANDLING.md apps/web/src/editor/ports/DECISIONS.md PARITY.md <handoff>/canonical-docs-update.md` - exit 0, all matched files formatted.
- `git diff --check -- BOUNDARIES.md FEATURE_HANDLING.md PARITY.md apps/web/src/editor/ports/DECISIONS.md` - exit 0; only Git's existing LF-to-CRLF working-copy notices were emitted.
- `rasen validate s02-storage-port --project rocut --strict` - exit 0, change valid.
