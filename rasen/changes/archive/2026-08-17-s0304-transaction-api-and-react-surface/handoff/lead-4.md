# Handoff: s0304-transaction-api-and-react-surface — LEAD #4

## Original intent

User said (verbatim intent): "阅读交接文档 lead-3.md，进入对应的 worktree，了解当前的任务和进度" then "由你作为 lead 继续推进 rasen-auto，我们现在使用的是 ClaudeCode，不要使用 codex，模型都是 opus，上下文是 250k。开始任务吧."

This session's mandate: continue the `auto-decompose` portfolio as LEAD, switching all workers from the prior Codex-only directive to **Claude Code Opus, 250k context, no Codex**. Do not create a new worktree — use the existing registered rocut worktree. Serialize all rocut-mutating workers.

## Position

- Repository/worktree: `E:/AI/ChatAI/Agents/VibeCodingProjects/elftia/_others/rocut` (the ONLY registered rocut worktree; never create another)
- Branch: `recovery/s0304-ui-commit-routing-final`
- Parent pipeline: `auto-decompose`, Tier A, gate policy `off (global)`
- Parent run-state: `.rasen/changes/s0304-transaction-api-and-react-surface/ephemera/portfolio-run.json`
- Runtime directive (updated this session): **all roles Claude/Opus/250k; no Codex**. The old Codex planner `/root/r1_planner` is retired across the session+runtime change.

Portfolio status: **7/9 children done**. R2 in progress; T4 waiting (serial guardrail).

```
done:    T0, R0, T1, T2, C1, T3, R1(s0304-surface-mount-focus-lifecycle)
in-prog: R2(s0304-surface-css-react-a11y) — apply stage
pending: T4(s0304-agent-transaction-evidence)
```

## Done / Remaining

### Done this session

**R1 complete lifecycle (review-loop → ship → archive):**
- Fresh Claude Opus non-author Round 2 re-review: PASS, 5/5 findings resolved, 0 open.
- LEAD ran fresh focused suite: 37/37 PASS, 172 expectations (eliminated reviewer's "couldn't run tests" limitation).
- Static gates: surface/transaction/port/type-baseline/distributable all PASS.
- Local-only ship: product commit `fb14b5b1` (46 paths) + ship-evidence commit `a239a86f`. No push/PR.
- Archive: commit `cdfae229`, transaction `674a2851`, spec sync +6 requirements. No EPERM.
- R1 accepted-known preserved through archive: `spec-falsification-sweep.md:55` stale 25/16/9; authoritative 28/19/9.

**R2 propose:**
- Fresh Claude Opus planner: 49 tasks, 8 requirements, 41 scenarios. Strict valid 1/1.
- LEAD direction review: aligned, no frozen-boundary widening.

**R2 apply — 9 implementer relays + extensive LEAD mechanical unblocks:**
The exec-bridge (`rasen agent dispatch --runtime claude`) denies most shell commands (formatter, install, tests, checkers, typecheck) via its approval policy. This forced a LEAD-as-executor pattern for every executable gate. Verified-green core state at handoff:
- Surface focused suites: **46/46 PASS, 232 expectations, 9 files**.
- Targeted drag suites: **9/9 PASS, 39 expectations**.
- Canonical type baseline: **3 diagnostics, 0 outside pin** (BEFORE React 18 migration).
- Surface boundary: normal PASS, 4/4 negative, 4/4 converse.
- Portal boundary checker: normal + 2/2 negative + 2/2 converse PASS.
- Private-drag checker: normal + 3/3 negative + converse PASS.
- React singleton checker: correctly fail-closed pre-migration, then PASS post-migration + negative/converse.
- Number-field: true minimal 27/1 semantic patch in its baseline CRLF convention.

**R2 React 18 atomic migration (LEAD-executed):**
- Root/Web/Vite manifests pinned: `react/react-dom 18.3.1`, `@types/react 18.3.28`, `@types/react-dom 18.3.7`.
- `bun.lock` regenerated: single React 18 line, no unrelated dependency drift (lock diff = 34 lines, all React-family).
- **Bun 1.2.2 hangs on dependency resolution** behind the `127.0.0.1:7890` proxy — resolved by using the project-required `npx bun@1.2.18` instead. Lockfile generation took ~100 min first time; frozen install then took 906ms.
- `node_modules` now has single React/ReactDOM 18.3.1.

### Remaining

**R2 apply — immediate blocker (9 React 18 type-compat regressions):**
React 18 types are stricter than React 19. Canonical `check-type-baseline` now reports 9 new diagnostics (ceiling was 3, now 13):
- `RefObject<HTMLDivElement | null>` not assignable to `LegacyRef<HTMLDivElement>` — 4 sites: `timeline/components/index.tsx:651-652`, `timeline-element.tsx:817`, `timeline-playhead.tsx:109`.
- `boolean | null` not assignable to `boolean` — 4 sites: `use-preview-interaction.ts:34`, `use-transform-handles.ts:35`, `use-element-interaction.ts:49`, `use-timeline-playhead.ts:39`, `use-timeline-resize.ts:39`.
- Read-only `current` assignment — 1 site: `preview/components/index.tsx:111`.
These are narrow source adaptations, NOT Next-16 incompatibility. Next 16.2.4 peers explicitly accept `^18.2.0`.

**R2 apply — after type-compat fix:**
- CSS boundary checker `check-surface-css-boundary.mjs`: refuses empty emitted scan; needs a Vite build to produce emitted CSS first.
- Run changed-file ESLint, full focused suites, Vite typecheck/build, Next marked build.
- React runtime identity probe wiring into both Host evidence entries.
- All remaining R2 tasks (CSS emitted proof, portal browser bounds, a11y axe, resize, drag browser evidence, disposal oracle, full parity 28/19/9, 17-spec falsification, implementation report, artifact manifest, strict validation).

**After R2 ships+archives:** T4 `s0304-agent-transaction-evidence` (serial), then one parent portfolio delivery.

## Key decisions (and why)

- **Claude-only runtime override:** User explicitly switched from Codex-only to Claude/Opus/250k. All new workers use `rasen agent dispatch --runtime claude --model opus`. The old Codex planner is retired. Do not revive Codex.
- **LEAD-as-executor for bridge-blocked commands:** The Claude exec-bridge (`claude-print`) denies shell commands (install, test, formatter, checker) via approval policy. Workers could only edit files. LEAD ran every executable gate himself after each worker handoff. This is a Tier-C-like degradation recorded in run-state, not a design choice. Successor LEADs must continue this pattern OR find a way to pre-authorize the bridge commands.
- **`npx bun@1.2.18` not system `bun` (1.2.2):** System Bun 1.2.2 hangs indefinitely at `[PackageManager] waiting for 80 tasks` behind the `127.0.0.1:7890` proxy. Bun 1.2.18 (the project's `packageManager` field) resolves correctly. Always use `npx --yes bun@1.2.18 install ...` for this repo.
- **Number-field CRLF:** `apps/web/src/components/ui/number-field.tsx` has a CRLF baseline (`git ls-files --eol` = `i/crlf`). Default `git diff --check` falsely flags new CRLF lines as trailing-whitespace. Use `git -c core.whitespace=cr-at-eol diff --check` for that file, default check for everything else. Never normalize the whole file to LF (creates 318-line churn).
- **R2 milestone split:** Apply was split into core-static (implementation + focused/static gates) and final-evidence (production builds + browser/parity/disposal). This prevented each 250k worker from exhausting its window on both implementation AND evidence.
- **No half-migration:** React manifest edits were fully reverted whenever `bun install` couldn't run, never leaving manifests inconsistent with lock.

## Dead ends & gotchas

- **Native `Agent` tool creates worktrees:** The first reviewer dispatch via the built-in Agent tool with `isolation: "worktree"` silently created a new git worktree, violating the "no new worktree" constraint. Immediately killed. All subsequent dispatches use `rasen agent dispatch --cwd <existing worktree>` which does NOT create worktrees. NEVER use the native Agent tool with worktree isolation for this repo.
- **Bridge verbose mode leaks tokens:** `bun install --verbose` printed the npm Bearer token into the task output file. That token should be considered compromised and rotated. Never use `--verbose` with install.
- **`rasen-review`/`rasen-apply-change`/`rasen-handoff` skills unavailable in exec-bridge:** Workers report `Unknown skill`. They fall back to following the proposal/design/tasks directly. Do not waste dispatch budget retrying skill names.
- **Manifest restore on Windows:** `git restore --source=HEAD` leaves CRLF noise on Windows autocrlf. Use `git show HEAD:<path> > <path>` for byte-exact baseline restore, or `python` to convert LF→CRLF.
- **`rasen new change --pipeline` refuses existing stubs:** R2 had a pre-created stub directory. `rasen new change` correctly refused. LEAD hand-wrote the minimal `auto-run.json` (recorded as `missing-initial-child-run-state` degradation) and validated with `pipeline resume`.
- **Context probe returns `no-transcript`:** `rasen agent context --latest` from the elftia cwd cannot find the rocut session transcript. Non-blocking; proceed without pct if needed. This session's probe from the elftia cwd DID return a valid reading (318k/1M) because the session transcript lives under the elftia project slug.

## Eliminated hypotheses

- "Next 16 categorically rejects React 18" — ruled out: installed `next@16.2.4` peers declare `react: "^18.2.0 || ..."`. Real install/build proof still required but peer metadata is favorable.
- "Bun resolution hang is a React peer conflict" — ruled out: it was Bun 1.2.2 + proxy `127.0.0.1:7890`. Bun 1.2.18 resolved the same dep graph in one pass.
- "Containment alone fixes R2 CSS" — ruled out: Vite imports all of `globals.css` (`:root`/body/universal selectors). Real Host/Surface stylesheet split required.
- "Vite `resolve.dedupe` proves shared React 18" — ruled out: all three manifests declared React 19. Exact pin + lock + graph + runtime identity required.

## Working set

**Parent run-state:** `.rasen/changes/s0304-transaction-api-and-react-surface/ephemera/portfolio-run.json`
- hostRuntime updated to `claude`, runtimeDirective all-claude/opus/250k.
- R1 child marked `done`/`archived` with ship/archive commits.
- sessionHandoff will point to this document (n=4).

**R2 run-state:** `.rasen/changes/s0304-surface-css-react-a11y/ephemera/auto-run.json`
- apply `in_progress`, handoffs[1..9] recorded, leadGateResults recorded.
- propose `done` (planner sessionId `8e52c9db`).

**R2 handoff series:** `rasen/changes/s0304-surface-css-react-a11y/handoff/implementer-{1..9}.md`

**R2 dirty product scope (all uncommitted, on branch `recovery/s0304-ui-commit-routing-final`):**
- CSS: `apps/web/src/editor/surface/surface.css` (new), `apps/web/src/app/globals.css` (split), `apps/vite-example/src/styles.css`.
- Portal: `surface-portal.tsx` (new), `surface-error-boundary.tsx` (new), 9 Radix wrappers + tooltip + 2 direct portals migrated.
- Drag: `surface-drag-coordinator.tsx` (new), number-field (minimal 27/1), color-picker, bookmark, 3 timeline controllers + 3 hooks.
- Checkers: `check-surface-boundary.mjs` (modified), `check-react-singleton.mjs`/`check-surface-css-boundary.mjs`/`check-surface-portal-boundary.mjs`/`check-surface-private-drag.mjs` (new), `surface-react-identity-probe.tsx` (new).
- Tests: `surface-{portal,error-boundary,drag-coordinator,drag-integrations}.test.ts` (new).
- Manifests+lock: `package.json`, `apps/web/package.json`, `apps/vite-example/package.json`, `bun.lock` — all React 18.

**Key commands:**
```powershell
# Always use Bun 1.2.18, not system bun 1.2.2:
npx --yes bun@1.2.18 install --frozen-lockfile --no-progress --network-concurrency 4

# Canonical type gate ( authoritative, not raw tsc ):
node script/check-type-baseline.mjs

# Whitespace (CRLF-aware for number-field):
git -c core.whitespace=cr-at-eol diff --check
git diff --check -- . ':(exclude)apps/web/src/components/ui/number-field.tsx'

# R2 resume:
rasen pipeline resume s0304-surface-css-react-a11y --project rocut --json
rasen pipeline resume s0304-transaction-api-and-react-surface --project rocut --json
```

## Next action

1. **Fix the 9 React 18 type-compat regressions** (listed above) — dispatch a fresh Claude Opus implementer (leaf, `rasen agent dispatch --runtime claude --model opus --sandbox workspace-write --cwd <rocut worktree>`) with the exact 9 file:line:code list. These are narrow `RefObject` nullability and `boolean | null` convergence fixes. Do NOT revert to React 19.
2. After type baseline returns to ≤3: run full focused suites + Vite typecheck/build + CSS boundary checker (needs emitted CSS from Vite build).
3. Continue R2 apply through remaining checkers, React runtime probe wiring, then the final-evidence milestone (production builds, dual-Host browser/axe/parity/disposal, 17-spec falsification, reports, hashes, strict validation).
4. R2 ship (local-only) + archive. Then T4 serial. Then one parent portfolio delivery.

**Generation cap note:** This is session generation 4 (maxRelays default 3). Do NOT auto-spawn a successor. Resume manually: start a fresh Claude session and run `rasen-auto s0304-transaction-api-and-react-surface` (or manually `rasen pipeline resume s0304-transaction-api-and-react-surface --project rocut --json`), then read THIS document first.
