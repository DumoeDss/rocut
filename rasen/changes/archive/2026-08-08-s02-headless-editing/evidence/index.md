# C7 implementation evidence index

This index separates evidence classes so planning, negative controls, ordinary Host regressions, review, and delivery cannot be mistaken for one another. A row is `pending` until its referenced command has actually run and the durable record exists.

| Class | Status | Durable record |
| --- | --- | --- |
| baseline | active | `baseline-20260805.md` |
| RED | active | `red-implementation.md` |
| GREEN | active | `green-implementation.md` |
| negative controls | active | `negative-controls.md`; failed-attempt reclamation is recorded separately in `failed-build-attempts-20260805.md` |
| headless Hosts | active | `headless-hosts.md` plus raw graph/result JSON |
| ordinary Host regressions | active | `ordinary-host-regression.md` |
| full regression/provenance | active | `final-regression.md`; rollup `final-manifest.md` |
| capability sweep | active | `capability-sweep.md` |
| independent review | active, round 1 blocked | `review-report.md`, `verification-report.md`, and `cso-report.md`; fix/re-review rounds remain append-only follow-up work |
| ship | reserved for separate Luna-xhigh leaf | no implementation claim |
| integration | reserved for LEAD | no child implementation claim |
| archive | reserved for a different Luna-xhigh leaf | no child implementation claim |

Planning artifacts and `planning-audit.md` are inputs only. They do not satisfy any implementation or runtime row above.

Round-1 Sol remediation is now active in `review-round1-fixes.md`; the fixer disposition and
remaining independent-review gate are in `review-cycle-report.md`. The complete `14`-requirement /
`62`-scenario map is `scenario-realization-map.md`. The independent review row remains blocked
until task 12.6 receives a fresh non-author Sol verdict; no ship/integration/archive status changed.
