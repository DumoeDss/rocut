# Group 8 — the electron agent ledger against the checker's nine predicates (task 8.2)

The checker (`script/check-agent-evidence.mjs`) still reads the archived
original Vite/Next pair and is **not repointed** — task 8.2 validates the
desktop Host's fresh ledger against the same nine predicates by hand, exactly
as P1 did for its regression runs. `apps/electron-host/scripts/validate-agent-ledger.mjs`
makes that repeatable: the checker's nine rule bodies and its
`NODE_DRIVER_ASSERTIONS` pin are copied verbatim into it, and it applies them
to a caller-given ledger path.

Ledger validated: `evidence/agent-ledger-electron.json` (written by the 8.1
run; run log with the real exit code: `evidence/logs/group-8-agent-electron.log`,
`REAL_EXIT_CODE:0`, `1 passed (4.5s)`).

```
$ node apps/electron-host/scripts/validate-agent-ledger.mjs \
    rasen/changes/s05-second-host/evidence/agent-ledger-electron.json
  PASS  electron ledger-present: the Host emitted an apply ledger with the agent schema
  PASS  electron plan-executed: the executed plan is the declared plan, step for step
  PASS  electron every-step-asserted: no step reached a verdict without asserting something
  PASS  electron apply-passed: the apply phase reported no failure code
  PASS  electron reopen-bound-to-commit: a fresh session reported the exact revision committed before the reload
  PASS  electron stale-control-failed: the stale-reopen control failed its step, proving the assertion can fail
  PASS  electron assertions-match-node: every step asserted exactly what the Node drivers assert, step for step
  PASS  electron no-console-error: the run produced no browser console or page error
  PASS  electron metadata-only: the run claims asset metadata only, never attachment bytes
        electron committed revision 6 over 9 step(s), 87 assertion(s), build marker s05-electron-20260815
AGENT LEDGER VALIDATION PASSED: all nine predicates
REAL_EXIT_CODE:0
```

## Negative control (the predicates are not vacuous)

A copy of the same ledger with four corruptions applied — one step's
`assertionCount` zeroed, `totalAssertions` off by one, the stale control's
verdict flipped to `passed`, one console error injected — fails exactly the
four corresponding predicates and no others, exit 1:

```
  FAIL  electron every-step-asserted
  FAIL  electron stale-control-failed
  FAIL  electron assertions-match-node
  FAIL  electron no-console-error
AGENT LEDGER VALIDATION FAILED: 4 predicate(s) failed
```

`assertions-match-node` is the comparison that matters most here: the desktop
Host's browser driver asserted **87 assertions across 9 steps, step-for-step
identical counts to the Node drivers** (`build-structure` 23, `move-clip` 8,
`trim-clip` 9, `split-clip` 12, `patch-project` 9, `keyed-commit` 8,
`keyed-replay` 6, `keyed-reuse-different-payload` 5, `stale-expected-revision` 7)
— the same totals the browser Hosts and the Node drivers report.
