# Review cycle: s02-storage-port

Date: 2026-08-02  
Tier: A (native Codex leaf workers)  
Status: **ESCALATED**  
Regular rounds: **3/3**  
Material strategy attempts: **3/3**

The cycle may not report clean: one Major remains after both configured budgets were exhausted.
Section 11 final verification, cleanup, ship, archive, and all downstream portfolio children remain
blocked.

## Regular review rounds

| Round | Findings (B/Ma/Mi/Test-gap) | Fix authors | Independent confirmer | Result |
| --- | --- | --- | --- | --- |
| 1 | 3/6/3/10 | migration, cascade, library-concurrency, and residual fixer leaves | `standards_overlap` round 2 | Original findings closed; 2/5/0/7 cross-cluster findings opened |
| 2 | 2/5/0/7 | migration lifecycle, cascade/control-plane, and preset fixer leaves | `standards_overlap` round 3 | Round-2 findings closed; 0/2/0/2 recovery/capability findings opened |
| 3 | 0/2/0/2 | no fourth regular fix loop permitted | `standards_overlap` round 3 | Max regular rounds reached; strategy ladder required |

Reports: `review-round1.md`, `review-round2.md`, and `review-round3.md` with matching reviewer
handoffs. Every implementation cluster was also checked by the non-author `adversarial_pr45`
integration verifier before the next independent review.

## Material strategy ladder

| Attempt | Material variable | Authors | Independent confirmation | Result |
| --- | --- | --- | --- | --- |
| 1 | Planner-led attachment precedence and media-owner coverage state machines | `spec_scope` planner; migration/cascade implementers | `standards_overlap` strategy-1 review + `adversarial_pr45` material gate | Original round-3 Majors closed; 0/2/1/2 new compatibility findings |
| 2 | Different planner; versioned tombstone staging and per-binding physical-configuration history | `adversarial_pr45` planner; migration/cascade implementers | `standards_overlap` strategy-2 review + independent material gate | Planned axes closed; 1/0/0/1 exact-library retry finding |
| 3 | Domain-complete v3 exact-target journal with dedicated library authorization | `spec_scope` planner; cascade implementer | `standards_overlap` strategy-3 review + independent material gate | Planned axes closed; 0/1/0/1 authorization-store alias finding remains |

The material gates were independently green on every named acceptance axis. The final reviewer
found the remaining alias configuration outside those axes in real Chromium, so the broader review
result takes precedence over the scoped gate.

## Open finding

**Major — a configured library target may alias a durable authorization store.**

If `libraryDatabase` equals `projectsDatabase` and `libraryStore` equals
`<projectsStore>-library-clear-bindings`, `clear(all)` clears its own exact-target authorization.
A crash after the library clear but before journal deletion leaves a v3 journal that can never
reauthorize. Reload and same-ID save remain permanently `unavailable`.

Required resolution if the user grants additional strategy authority:

1. Before logical commit, reject any physical library/media target that aliases a durable store
   needed to authorize or retry the pending journal (projects, cascade maintenance, migration
   maintenance, media ownership, and library-clear authorization stores).
2. Add a real-Chromium alias + post-library/pre-journal-delete crash regression proving either
   atomic precommit refusal with all data unchanged or successful convergence with same-ID reuse.
3. Obtain independent non-author confirmation; then rerun the entire final Section 11 tail.

Authoritative report: `strategy-attempt-3-review.md` and
`../handoff/strategy-attempt-3-reviewer.md`.

## Latest scoped evidence

- Chromium C5 configuration: 3/3; store 19/19; migration lifecycle 16/16; all named strategy
  matrices green.
- C4 public-store-first stress: green.
- Focused Bun: 48/48, 216 expectations.
- Type: Vite 0 diagnostics; repository exact inherited ceiling 3.
- ESLint: 0 errors / 0 warnings on the strategy write set.
- Port, storage, Host, and session-state positive/negative boundaries: green.
- Prettier and Windows-aware diff check: green.
- Strict Rasen validation: 1/1 valid.
- Disposable Chromium databases/OPFS and test listeners: cleaned by each verifier.

These are scoped review-cycle gates, not Section 11 final verification. The final fresh Vite/Next,
parity, source/provenance, WASM, protected-hash, and full-regression tail is still intentionally
unchecked.

## Tree identity

- HEAD: `0ef35459f685d5d41a25d0ef959aff691b7519cd`
- HEAD tree: `286272307b05d23826ffa7223a76695365194dba`
- Uncommitted working-set fingerprint at escalation: `4c2897c06ac1fa37e3259a6d344a9a596f9bdd0f`
- Tracked-diff blob fingerprint: `a4b708920f5dfd8f5102de50f7f958733763b8ec`
- Worktree entries: 86 (59 untracked files); no C5 commit exists.

## Termination

The review-loop stage is parked as `escalated`. It is not complete, clean, shipped, integrated, or
archived. C6 cannot rebase on a landed C5 tree; C7 depends on C6; E1 remains serialized behind the
same overlap boundary. Resumption requires an explicit user decision to grant another material
strategy attempt or to redesign/abandon the C5 storage identity model.
