# R2 implementer successor #9 handoff — 2026-08-11

## Status

**HANDOFF.** I added dedicated fail-closed checker/probe source for the remaining CSS, portal, private-drag, and React singleton milestones. Normal command execution required approval throughout this relay, so none of the new checkers, focused tests, type gates, lint, builds, whitespace gates, or dependency installation could run. I attempted the exact React 18 manifest pin, but `bun install` was denied; I atomically reverted all six manifest edits rather than leave a half migration. `bun.lock` was not changed. `tasks.md` remains 0/49 because no newly mapped gate was fully proven.

## Receipt

- Worktree: `E:/AI/ChatAI/Agents/VibeCodingProjects/elftia/_others/rocut`
- Branch: `recovery/s0304-ui-commit-routing-final`
- Inherited HEAD: `cdfae229ebe8ea393807cce0b7a9617083625f78`
- Read implementer-8, implementer-7, tasks, design, current manifests, lock resolution excerpts, Surface CSS/portal/drag modules, portal call sites, and existing boundary/distributable checks.
- No subagent/workflow/new worktree/commit/index/push/archive/T4/server/browser/parity or `.rasen/**` run-state mutation.

## React outcome

The exact intended atomic line was prepared as:

- `react`: `18.3.1`
- `react-dom`: `18.3.1`
- `@types/react`: `18.3.28`
- `@types/react-dom`: `18.3.7`

across root, Web, and Vite. `bun install` required approval and did not run. Every attempted manifest edit was then reverted, leaving manifests and lock on the inherited React 19 declarations/resolutions. In particular, `apps/web/package.json` still preserves `rehype-stringify: ^10.0.1`; no unrelated dependency was intentionally changed.

The installed `node_modules/next/package.json` was inspected directly. Its installed version is `16.2.4`, and its declared peers explicitly accept:

```json
"react": "^18.2.0 || 19.0.0-rc-de68d2f4-20241204 || ^19.0.0",
"react-dom": "^18.2.0 || 19.0.0-rc-de68d2f4-20241204 || ^19.0.0"
```

Therefore the hypothesis “Next 16 categorically rejects React 18” is eliminated at package-peer metadata level. This is not install/build proof: normal install output and production compatibility remain required.

Added but **unexecuted/unverified**:

1. `script/check-react-singleton.mjs`
   - exact manifest checks;
   - lock resolution cardinality/version checks;
   - emitted graph React/ReactDOM package-root checks;
   - non-empty emitted graph requirement;
   - runtime probe shape checks;
   - duplicate-root negative and same-root converse controls.
2. `apps/web/src/editor/surface/embedding/surface-react-identity-probe.tsx`
   - Host-entry React object compared with Surface-module React object;
   - context, state, and effect exercised across the module seam;
   - result includes identity/context/state/effect and invalid-hook error shape.

These files must be type/lint/runtime reviewed before being treated as evidence. The probe is not exported from the public Surface barrel and is not yet wired into either Host evidence entry.

## Dedicated boundary checkers added

All are retained but **unexecuted/unverified** because `node ...` commands required approval:

1. `script/check-surface-css-boundary.mjs`
   - scans tracked plus uncommitted Surface source CSS;
   - requires a non-empty emitted Vite CSS scan;
   - rejects editor-owned `:root`, `html`, and `body` selectors;
   - requires namespace, containment, and isolation markers;
   - contains negative and Host/owned-selector converse controls.
2. `script/check-surface-portal-boundary.mjs`
   - scans the required UI wrappers and direct overlay sites plus public Surface barrel/types;
   - requires private owner resolution;
   - rejects direct body escape and public owner leakage;
   - contains missing-owner/body negative and Host/private-owner converse controls.
3. `script/check-surface-private-drag.mjs`
   - scans tracked plus uncommitted embedding files;
   - rejects document drag listeners outside the coordinator;
   - requires paired listener registration/removal, owner and pointer discrimination, and synchronous cleanup shape;
   - rejects public private-drag leakage;
   - contains persistent/unpaired/public-leak negative and root-listener converse controls.

Because these scripts could not execute, syntax, rule precision, expected file counts, and control behavior are not proven. Run and repair them before checking tasks 1.3–1.6 or 8.3.

## Gates attempted and blocked

Every following command required approval and did not run:

```powershell
bun test apps/web/src/editor/surface/embedding/__tests__/surface-drag-integrations.test.ts
bun install
node script/check-surface-css-boundary.mjs
node script/check-surface-css-boundary.mjs --negative-control
node script/check-surface-portal-boundary.mjs
node script/check-surface-portal-boundary.mjs --negative-control
node script/check-surface-private-drag.mjs
node script/check-surface-private-drag.mjs --negative-control
git status --short
git diff --numstat -- apps/web/src/components/ui/number-field.tsx
git -c core.whitespace=cr-at-eol diff --check
git diff --check -- . :(exclude)apps/web/src/components/ui/number-field.tsx
```

Thus the LEAD-verified inherited baseline remains the only authoritative execution evidence:

- number-field intended 27/1 semantic diff in baseline CRLF convention;
- targeted drag tests PASS 9/9, 39 expectations;
- all Surface suites PASS 46/46, 232 expectations across 9 files;
- canonical type baseline PASS 3/0 outside pin;
- Surface boundary normal/negative/converse PASS.

No statement above upgrades that inherited evidence to cover the new checker/probe files.

## Tasks and final evidence

- `tasks.md`: unchanged, **0/49 checked**.
- No final owned-server browser/parity/disposal work started, per milestone ordering.
- React 18 atomic manifest/lock migration, normal install output, singleton checker execution, Host wiring, runtime identity evidence, Vite typecheck/build, and Next production proof remain.
- Dedicated CSS/portal/private-drag scripts require syntax/control/normal execution and likely refinement from their first results.
- Changed-file lint, canonical type baseline, focused suites, all checker controls, EOL-aware whitespace checks, and exact dirty receipt must be rerun after these additions.
- All dual-Host final-source browser, axe, keyboard/focus, resize, drag, disposal, parity 28/19/9, hashes/artifacts, 17-spec falsification, strict validation, and evidence mapping remain.

## Dirty receipt

The inherited product/test dirty set from the LEAD baseline remains, including the true minimal CRLF-aware number-field diff and all previously listed Surface/CSS/portal/drag files. This relay additionally created:

- `apps/web/src/editor/surface/embedding/surface-react-identity-probe.tsx`
- `script/check-react-singleton.mjs`
- `script/check-surface-css-boundary.mjs`
- `script/check-surface-portal-boundary.mjs`
- `script/check-surface-private-drag.mjs`
- this handoff

The React manifest edits were reverted before handoff; `bun.lock` was not modified. Exact `git status`/diff receipt could not be refreshed because the command required approval. Pre-existing `.rasen/` remains unrelated and untouched.

## Exact next sequence

1. Run syntax/normal/negative/converse controls for the four new checkers and fix all failures.
2. Run focused Surface suites and canonical type baseline to ensure the new probe has not raised the 3-diagnostic ceiling.
3. Run changed-file lint and EOL-aware whitespace gates.
4. Atomically apply the exact React 18 pins across all three manifests and run normal `bun install`; inspect complete peer output and unrelated lock/manifests diff.
5. Run React checker normal/negative/converse, Vite typecheck/build, emitted distributable boundary, and Next focused compatibility. If the real install/build contradicts the inspected peer metadata, document the exact blocker and return to Direction without an island/alias/duplicate/ignored peer.
6. Wire the shared identity probe into both Host evidence paths without exporting it publicly; assert identity plus context/state/effect and no #321/invalid-hook errors.
7. Only after product/check/test/lock bytes stabilize, begin final owned-server browser/parity/disposal evidence.

## Eliminated hypotheses / constraints

1. Next 16's package metadata does not categorically forbid React 18; installed 16.2.4 declares `^18.2.0` peers. Real install/build proof still decides acceptance.
2. A denied lock regeneration cannot be papered over by manifest-only changes; the attempted pin was fully reverted.
3. Runtime identity evidence cannot be reduced to Vite dedupe or manifest equality; it must cross Host-entry and Surface-module boundaries and exercise hooks/context/effect.
4. Dedicated checkers must refuse empty source/emitted scans and include both violation and allowed controls; source-only assertions are insufficient.
5. Retain the optional number-field coordinator semantics and CRLF-aware 27/1 patch; do not normalize the whole file.
6. Preserve frozen public/lifecycle/transaction/Host boundaries, parity 28/19/9, ceiling 3, and no T4/commit/index/push/archive/.rasen mutation.
