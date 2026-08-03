# Handoff - C5 strategy attempt 3 implementer

Date: 2026-08-02  
Worktree: `E:\AI\ChatAI\Agents\VibeCodingProjects\elftia\_others\rocut-wt-c5`  
Branch/base: `feat/s02-storage-port` / `0ef35459`, uncommitted  
Evidence: `evidence/strategy-attempt-3-implementation.md`

## Completed

Selected Candidate A is implemented and green. New clear journals are strict
revision 3 with domain-complete `{media, library}` targets. Projects scope
requires zero library targets; all scope requires one exact target. New records
never write `clearLibrary`.

The new dedicated `<projectsStore>-library-clear-bindings` store retains an
immutable descriptor for the exact projects-control-plane plus library tuple.
The descriptor, its row key, and the journal target are coupled by a canonical
domain-tagged SHA-256 fingerprint that is recomputed on decode. Different
reopening wrapper library fields are deliberately ignored after commit.

All-clear now commits project clear, cascade rows, and the descriptor in one
three-store transaction. The transaction rereads an existing exact descriptor
and aborts a conflict. Cleanup rereads and validates every attempt-2 media
authorization plus every library descriptor/target before any physical I/O,
then clears the journaled database/store only. The exact journal is retained
through media, library, post-library, and journal-delete failures.

Ambiguous v1/v2 `clearLibrary:true` fails closed with
`project-cascade-library-binding-required` and no physical I/O. The optional
trusted `previousLibraryBinding` path is implemented for v2 only: strict media
validation precedes an atomic cascade+descriptor compare-and-swap to the same-ID
v3 record. Legacy false remains media-only.

## Chromium acceptance

The RED probe initially returned false for exactly seven new groups while every
old field stayed green. Final Chrome 151 returns true for all seven:

- exact old-library retry across changed media/library configuration;
- projects-clear zero-library behavior across reload;
- descriptor tamper fail-closed with media and both libraries preserved;
- v2 boolean fail-closed without trusted history;
- trusted v2 atomic promotion and convergence;
- post-library/pre-journal-delete idempotent exact retry;
- strict v3 codec/cardinality/extra-key rejection.

Focused browser is 1/1. Full Chromium is 3/3; shared store is 19/19,
lifecycle is 16/16, corrupt/abort matrices are 6/6 and 7/7, and all attempt-2
M1/M2 plus strategy-1 fields remain green. C4 forced-none stress is 5/5.

## Mechanical tail

- focused Bun: 48/48, 216 expectations;
- Vite TypeScript clean; exact-three baseline clean;
- port/storage/session/Host positive and negative boundaries clean;
- focused product ESLint 0/0; harness/spec and product Prettier clean;
- CR-at-EOL diff check clean;
- strict Rasen validation 1/1, zero issues;
- disposable database/OPFS cleanup proof present;
- ports 4175/43551/43552 released and Playwright marker removed;
- public port/Host/session/consumer/tasks/review artifacts untouched by this
  attempt;
- commit: none.

## Next

Assign a non-author reviewer, then a non-author verifier. They must reproduce
the original old/new two-library counterexample, inspect exact-key/fingerprint
decoding and both atomic helpers, verify that preflight completes before all
physical I/O, and rerun the complete Chrome/static/cleanup gates. The
implementing role cannot close B1; it remains open until independent
confirmation.

