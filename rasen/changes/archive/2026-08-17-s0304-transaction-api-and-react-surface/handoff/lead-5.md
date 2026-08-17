# Handoff: s0304-transaction-api-and-react-surface — LEAD #5

## Original intent

Continuation of the `auto-decompose` portfolio as LEAD. User directive carried from lead-4: **all workers Claude Code Opus, 250k context, never Codex; never create another worktree; serialize every rocut-mutating worker; children ship local-only; never push a partial portfolio.**

This session's mandate (from lead-4's "Next action"): fix the 9 React 18 type-compat regressions, then drive R2 `s0304-surface-css-react-a11y` through its remaining apply work and final dual-Host evidence.

## Position

- Repository/worktree: `E:/AI/ChatAI/Agents/VibeCodingProjects/elftia/_others/rocut` (the ONLY registered rocut worktree)
- Branch: `recovery/s0304-ui-commit-routing-final`, HEAD `cdfae229` (nothing committed this session — all work is dirty worktree state)
- Parent run-state: `.rasen/changes/s0304-transaction-api-and-react-surface/ephemera/portfolio-run.json`
- R2 run-state: `.rasen/changes/s0304-surface-css-react-a11y/ephemera/auto-run.json`

Portfolio status: **7/9 children archived**. R2 in `apply`, close to complete. T4 still waiting (serial guardrail).

```
done:    T0, R0, T1, T2, C1, T3, R1
in-prog: R2 (s0304-surface-css-react-a11y) — apply, Vite evidence GREEN, Next evidence NOT YET RUN
pending: T4 (s0304-agent-transaction-evidence)
```

## Done this session

### 1. React 18 type-compat closed (implementer-10 + LEAD)

All 9 diagnostics gone. Canonical `node script/check-type-baseline.mjs` = **3 diagnostics, 0 outside pin** (the R2 ceiling). Nine narrow source adaptations recorded in `rasen/changes/s0304-surface-css-react-a11y/handoff/implementer-10.md`:
`useRef<T | null>` for callback-assigned refs, `isShiftHeldRef.current ?? false` (5 sites), `React.RefObject<HTMLDivElement>` prop narrowing (4 sites).

**LEAD repair on top:** the worker's tool rewrote 5 `i/lf` files as `w/crlf`, inflating the diff to 905/905. Byte-level CRLF→LF restore reduced them to exactly **1/1 semantic each**. Always check `git ls-files --eol` after a worker edits a file.

### 2. R2 final-evidence source (implementer-11, interrupted; LEAD completed + repaired)

implementer-11 was cut off mid-run: it produced unverified source and never wrote its handoff. LEAD audited the dirty diff, then fixed everything below.

**Dependency:** `@axe-core/playwright` added to `apps/vite-example`; `bun.lock` regenerated. **`npx --yes bun@1.2.18 install` took 5,712 s (~95 min)** on dependency resolution — matches lead-4's ~100 min note. It is NOT hung; wait it out. `--frozen-lockfile` afterwards is <1 s.

**Real defects found and fixed (product/checker, not test noise):**

1. **`check-surface-css-boundary.mjs` could never pass.** It enumerated emitted CSS with `git ls-files --others --exclude-standard <dist>`, but `dist/` is gitignored, so the emitted scan was always 0 → fail-closed forever. Replaced with a direct recursive `readdirSync` of the dist tree, keeping empty-scan fail-closed. Also added a `missing-emitted-utility` rule so a *vacuous* artifact (namespace-only, no utilities) cannot pass.
2. **Surface CSS was not attributable.** `surface.css` began with `@import "tailwindcss"`, which injects Tailwind **preflight** (`html`, `:host`) and **theme** (`:root`) into the distributable sheet. Split: `surface.css` now imports only `tailwindcss/utilities.css` with `source("../../")` plus `@reference "tailwindcss/theme.css"`; **both Hosts** (`globals.css`, `vite-example/src/styles.css`) explicitly import `tailwindcss/theme.css` + `tailwindcss/preflight.css` themselves. New `apps/vite-example/vite.surface-css.config.ts` builds canonical `surface.css` **directly as the Rollup input** (no HTML wrapper) into `dist-surface-css/`. Result: 119 kB emitted, contains `.size-full`/`.bg-background`/`.flex{`, zero `:root`/`html`/`body`. An earlier wrapper-based attempt produced a 4.1 kB shell with **no utilities at all** — it passed the checker while proving nothing; that is why the utility-marker rule exists now.
3. **`installSurfaceFocusScope` broke every descendant React pointer handler.** It called `event.stopPropagation()` on *all* `pointerdown` in the Surface root's bubble phase. React 18 delegates at the root container **above** the Surface, so no descendant `onPointerDown` in the whole editor subtree ever ran. Fixed: only stop propagation when `event.target === root`. `surface-focus.test.ts` now pins `childPointer.propagationStopped === false`. **R1 never caught this** because it only probed the root itself.
4. **Owned dialog failed WCAG AA contrast.** axe found 93 serious violations: `DialogContent` set `bg-popover` without `text-popover-foreground`, so Host foreground leaked in (3.94:1 and 1.23:1). Fixed on the shared `DialogContent` wrapper. This is the R2 a11y gate finding a genuine product defect.
5. **Evidence assertion was unobservable (my own bug, last blocker).** `data-listeners` renders `coordinator.inspect().listenerCount`, but `coordinator.start()` mutates a class field and triggers **no React re-render** — so the attribute stayed at the previous render's `0` forever. Fixed by having `startDrag` also bump a `starts` counter in state. This single bug caused ~8 consecutive red runs that looked like input-dispatch problems.

**Evidence harness/spec now covers:** build-marker equality (`R2_EXPECTED_BUILD_MARKER`), shared React identity (context+state+effect across the Host↔Surface module seam), named region + all three tabIndex modes, owned portal DOM/namespace/token/focus/Escape/two-Surface isolation, bounded axe WCAG2A/AA on **both** the visual root and the owned portal host, resize matrix (compact/wide/tall/same/original) with unchanged mount+lifecycle identity, private drag continuation beyond bounds with exact-once finish + listener drain + second-Surface isolation + unmount cancellation, contained render failure with one named alert, plus zero unexpected console errors.

### 3. Verified gate state (all run by LEAD)

| Gate | Result |
| --- | --- |
| Focused Surface suites | **47 pass / 0 fail, 242 expectations, 10 files** |
| Canonical type baseline | **PASS — 3 diagnostics, 0 outside pin** |
| Vite typecheck | PASS |
| Surface / portal / private-drag / React-singleton / CSS checkers | PASS normal **and** all negative + converse controls |
| Transaction + Host-port boundary | PASS |
| Emitted distributable graph | **2,934 modules, 10/10 exclusions clean** |
| Next production build | PASS, 20 routes incl. `/surface-evidence` |
| Changed-file ESLint | 0 errors (3 Vite test files remain outside the root ESLint config → warning-only, same accepted-known as R1) |
| Whitespace (EOL-aware) | PASS |
| **Vite Surface browser matrix** | **PASS 2/2** — 10 asserted steps, 0 step errors, marker `r2-final-source-20260812-s`, identity all true, S02 disposal oracle `clean: true` |

## Remaining for R2

1. **Run the Next Host matrix.** The Next build currently on disk is from marker `-i`; the passing source is `-s`. Rebuild Next from the *current* source with the same marker, then run:
   ```powershell
   # from apps/vite-example
   $env:PARITY_HOST='next'; $env:R2_EXPECTED_BUILD_MARKER='<marker>'
   npx --yes bun@1.2.18 x playwright test --config playwright.surface.config.ts
   ```
   Next server is owned at `127.0.0.1:3017`, `reuseExistingServer: false`, placeholders already in `playwright.surface.config.ts` + `NEXT_PUBLIC_R2_BUILD_MARKER`.
2. **Full dual-Host parity** (`PARITY_SPEC=parity`, once per host) + `script/diff-parity-snapshots.mjs`. Attribution **starts from the authoritative 28/19/9**, never the stale 25/16/9 in R1's `spec-falsification-sweep.md:55`.
3. **Post-browser hash equality.** Current manifest: `rasen/changes/s0304-surface-css-react-a11y/evidence/pre-browser-source-hashes.sha256`, 61 paths, receipt `c168a38a745d77d9eb928a6e87d972709bd07444e97c7615f5f988fc2102eaf0`. Re-hash after both Hosts and require equality; hash all ledgers/screenshots/results into an artifact manifest.
4. **Reports:** implementation report mapping every delta scenario to evidence, 17-spec falsification sweep, then `rasen validate s0304-surface-css-react-a11y --strict --project rocut --json`.
5. **`tasks.md` is still 0/49 checked.** Tick only what is genuinely evidenced.
6. Then R2 review-loop (author != verifier) → local-only ship → archive. **Then** T4, then one parent portfolio delivery.

## Key decisions

- **Never weaken a gate to make it pass.** Every red this session was resolved by fixing the product, the checker, or a genuinely wrong assertion — never by exemption, `force: true`, or filtering axe findings.
- **Fail-closed rebuild protocol.** Any source edit invalidates the frozen hash + build marker. Markers ran `-a` … `-s`; each cycle = format → lint → typecheck → rebuild both Hosts → re-hash → rerun. Slow but it is what makes the evidence attributable.
- **Split Host reset from distributable Surface CSS** rather than exempting `html`/`body` inside a merged bundle.
- **Evidence seams are `/surface-evidence`-route-only**, private, never exported from the public barrel; `EditorSurfaceProps` unchanged.

## Dead ends & gotchas (do not repeat)

- **`rasen agent dispatch` has no `--prompt`.** Use `--prompt-file <path>` (+ `--contract leaf --sandbox workspace-write --cwd <worktree>`). My first dispatch died instantly on `unknown option`.
- **`bun install` ~95 min** on first resolution. Never `--verbose` (leaks the npm token). Never system `bun` 1.2.2 — it hangs behind the proxy.
- **Do not chase input-dispatch APIs when a DOM attribute won't move.** I burned 8 runs cycling `dispatchEvent` → `page.mouse` → keyboard → native listener → CustomEvent. The attribute was stale because nothing re-rendered. **Check whether the observable can update at all before blaming the event.**
- **The portal host carries the same `data-editor-surface` value as the visual root.** Every inherited R1 selector needed `:not([data-editor-surface-portal])`, otherwise strict-mode violations and a `toHaveCount(2)` that sees 4.
- **R1's `full-dynamic-tab-cycle` step permanently `inert`-ed the Surface's children** and never cleaned up, poisoning later steps. It now restores the DOM it mutated.
- **Chromium serializes `contain: layout style paint` as `content`.** Assert the equivalence, not the literal string.
- **Worker tools may rewrite whole files to CRLF.** Verify `git ls-files --eol` + `git diff --numstat` after every relay.

## Eliminated hypotheses

- "Next 16 rejects React 18" — ruled out by a real marker-bearing production build: 20/20 routes on React 18.3.1.
- "The CSS checker just needs a build" — ruled out: its dist enumeration was structurally incapable of seeing gitignored output.
- "Containment/namespace alone makes emitted CSS attributable" — ruled out: Tailwind's own preflight/theme re-inject globals; the import graph had to be split.
- "The drag evidence failures are an input-synthesis problem" — ruled out: it was a missing re-render on the observable.
- "R1's focus scope was correct" — ruled out: it suppressed every descendant React pointer handler in the editor.

## Working set

- R2 planning: `rasen/changes/s0304-surface-css-react-a11y/{proposal,design,tasks,planning-context}.md` + `specs/embeddable-react-surface/spec.md`
- R2 evidence: `rasen/changes/s0304-surface-css-react-a11y/evidence/` (`pre-browser-source-hashes.sha256`, `browser-surface/vite/*`)
- Build logs: `.rasen/changes/s0304-surface-css-react-a11y/ephemera/*-final-build-*.log`
- Successor prompts: `.rasen/changes/s0304-surface-css-react-a11y/ephemera/implementer-1{0,1}-*.md`
- Worker handoffs: `rasen/changes/s0304-surface-css-react-a11y/handoff/implementer-{1..10}.md` (11 never wrote one — this document covers its scope)

## Next action

1. Rebuild Next from current source with a fresh marker; run the Next Surface matrix. Expect it to pass — the fixes were Host-neutral — but treat any delta as real.
2. Full parity both Hosts + snapshot diff against 28/19/9.
3. Post-browser hash equality + artifact manifest.
4. Implementation report + 17-spec falsification sweep + strict validation + `tasks.md`.
5. R2 review-loop → local ship → archive. Then T4. Then one parent delivery.

**Generation note:** this is LEAD generation 5. Resume with a fresh Claude session; read THIS document first, then `rasen pipeline resume s0304-surface-css-react-a11y --project rocut --json`.
