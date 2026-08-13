# R2 implementation report — final-source dual-Host closure

## Closure identity

| item | value |
| --- | --- |
| Final build marker | `r2-final-source-20260812-aa` (both Hosts) |
| Pre-build source manifest | `pre-browser-source-hashes.sha256`, **64 paths**, derived from the write set (not a hand-maintained list) |
| Post-browser re-hash | **64 / 64 equal** — no source moved across the four browser runs |
| Vite Host | `vite build` → `apps/vite-example/dist`, served by owned `vite preview` on `127.0.0.1:4173`, `reuseExistingServer: false` |
| Next Host | `next build` → `apps/web/.next` (24 routes incl. `/surface-evidence`), served by owned `next start` on `127.0.0.1:3017`, `reuseExistingServer: false` |
| Artifact manifest | `artifact-hashes.sha256`, 27 entries, all verify |

Every gate below was run by the LEAD on this exact source. Marker `-aa` is the tenth rebuild-and-rerun cycle of this session; each earlier cycle was invalidated by a real fix
(§"Defects found during final verification"), never by a gate adjustment.

## Verification ledger

| gate | result |
| --- | --- |
| Focused Bun Surface suites | **48 pass / 0 fail, 259 expectations, 10 files** |
| `check-type-baseline.mjs` | **PASS — 3 diagnostics now vs 13 at pin `cf5e79e9`, 0 outside the pin** |
| Vite typecheck (`tsc --noEmit`) | PASS |
| Changed-file ESLint | **8 errors, each proven present on the pristine HEAD blob** (+1 warning, +4 accepted-known Vite-test warnings); 0 R2-attributable **in substance** — see the attribution reading below |
| Boundary checkers, normal | surface (15 modules), CSS (1 source + 1 emitted), portal (13 files), private-drag (**749 files**, editor tree), react-singleton (3 manifests + lock + 2,934 modules + probe shape), transaction (31 modules), port (53 modules) — all clean, all non-empty |
| Boundary checkers, negative controls | 9/9 caught their deliberate violation |
| Boundary checkers, converse controls | 5/5 accepted the legitimate case |
| `check-next-imports.mjs` | PASS |
| `check-distributable-boundary.mjs` | **2,934 modules, 10/10 exclusions clean**; composition 635 `apps/web/src` + 15 example host + 2,280 dependencies + 4 other |
| Vite Surface matrix | **PASS 2/2** — 10 steps, 16 assertions, 0 step errors |
| Next Surface matrix | **PASS 2/2** — 10 steps, 16 assertions, 0 step errors |
| axe WCAG2A/AA, both Hosts | visual root **15 rules**, owned portal host **14 rules**, **0 violations** |
| S02 disposal oracle, both Hosts | `clean: true` |
| Full parity scenario | Vite 1/1, Next 1/1; all 10 interactions asserted on both Hosts |
| c5-storage suite (incl. C4 forced-none) | **5/5** — added to the gate set after B1 |
| Parity attribution | **28 / 19 / 9**, equal to authoritative R1 — but see the reconciliation below, which is about movement, not equality |
| Whitespace (EOL-aware) | **0 real trailing-whitespace lines across all changed/new source files**, and every file that is LF at HEAD is LF in the worktree |
| 17-spec falsification sweep | 165 requirements / 381 SHALL / 56 MUST — none falsified |

`git diff --check` is *not* clean, and that is expected rather than waived:
`number-field.tsx` and `tooltip.tsx` are stored CRLF **at HEAD**, so git reports every added
line as "trailing whitespace". The EOL-aware scan above is the real check and finds nothing.
Both files also fail `biome format` on their pristine HEAD blobs for the same reason; biome is
not in this pipeline's gate set and R2 does not convert either file's line endings.

## Delta-scenario evidence

All 41 scenarios of the R2 delta spec, mapped to the evidence that exercises them.

### R2 scopes editor CSS to Surface-owned roots

| scenario | evidence |
| --- | --- |
| Default and custom namespaces own complete token sets | `r2-css-portal-react-a11y-error-resize-drag` step, both Hosts: owned-root token snapshot for default + custom namespace |
| Two Surface themes do not cross | same step: second Surface retains its computed values while the first's theme changes |
| Surface root is contained and bounded | same step asserts `contain: layout style paint` (Chromium serializes it as `content`; the equivalence is asserted, not the literal string) and bounds inside the 720×420 Host box |
| Editor stylesheet causes zero outside delta | `measurements-<host>.json` `beforeMount`/`afterMount`/`afterFocus`/`afterR2`/`afterHideShow`/`afterUnmount` snapshots of `html`, `body`, chrome and outside sentinels — zero R2-attributable delta on both Hosts |
| Host-owned reset remains outside the claim | `check-surface-css-boundary --converse-control`: a Host `body { margin: 0 }` is not classified as editor ownership |

The emitted distributable sheet is built as a direct Rollup input by
`apps/vite-example/vite.surface-css.config.ts` (119 kB) and scanned by the checker's own
recursive `readdirSync`, with a `missing-emitted-utility` rule so a namespace-only artifact
cannot pass vacuously.

### Editor portals remain owned by their initiating Surface

| scenario | evidence |
| --- | --- |
| Representative overlays mount under the Surface owner | browser step asserts owned-dialog DOM ancestry under the Surface portal host, not `document.body` |
| Overlay focus remains local and restorable | same step: open → focus enters → Escape → focus restored to the trigger |
| Two Surfaces do not exchange portals | same step: two-Surface isolation of node, namespace and focus target |
| Host overlays retain Host ownership | `check-surface-portal-boundary --converse-control`; Host toaster is not counted as an editor escape |
| Unowned editor portal is detected | `check-surface-portal-boundary --negative-control` |
| — | `surface-portal.test.ts` additionally pins owner-preference resolution, the initial-safe `{owner ? children : null}` gate, absence of `document.body`, and that all nine wrappers plus the direct `createPortal` site route through the owner |

Every inherited R1 selector needed `:not([data-editor-surface-portal])`, because the portal
host deliberately carries the same `data-editor-surface` value as the visual root.

### Both Hosts and the Surface share one React 18 runtime

| scenario | evidence |
| --- | --- |
| Dependency metadata pins one React 18 line | `check-react-singleton.mjs` over 3 manifests + lock resolution |
| Runtime identity crosses the Host-Surface seam | `SurfaceReactIdentityProbe` compares the Host entry's React module object with the Surface-imported one and exercises context + state + effect; asserted `identity/context/state/effect === true` in both production Hosts |
| Emitted Vite graph proves singleton and exclusions | 2,934-module authoritative graph: exactly one React and one ReactDOM package root, all ten exclusions clean |
| Duplicate React control fails closed | `check-react-singleton --negative-control`; `--converse-control` accepts many modules sharing one resolved root |

Next 16 on React 18 is demonstrated by a real marker-bearing production build (24 routes) plus
the browser run, not by dependency-resolution warnings.

**The probe deliberately carries no `consoleErrors` field.** An in-page probe cannot observe
React's invalid-hook-call / #321 logging, so such a field could only ever report an empty array
while reading as evidence. Console coverage is owned by the run itself: `surface.pw.ts`
registers `page.on("console")` and `page.on("pageerror")` and fails on any error other than the
deliberately injected `R2 deterministic render failure`. Both Hosts recorded zero unexpected
console/page errors.

### The public Surface seam contains render failures accessibly

| scenario | evidence |
| --- | --- |
| Child render failure shows one bounded diagnostic | browser step: one visible `role="alert"` with heading and normalized message, inside Surface bounds, no raw stack |
| Host siblings and another Surface survive | same step: second Surface and Host siblings remain mounted and interactive; no session disposed |
| Strict-Mode-shaped rendering does not duplicate reports | `surface-error-boundary.test.ts` pins that the same `Error` reports once through the latest callback (`WeakSet` dedupe) |
| Failure outside the Surface remains Host-owned | Vite Host's outer boundary retained as defense in depth; the Surface boundary does not claim it |
| React boundary limitations are explicit | stated in the delta spec and repeated here: **event-handler and detached asynchronous throws are not claimed as contained** |

### R2 accessibility is executable at the Surface seam

| scenario | evidence |
| --- | --- |
| Named region preserves focus modes | root is `role="region"` named "Video editor"; `passive/-1`, `focused/0`, `full/0` re-asserted on both Hosts |
| Owned overlay is keyboard operable | dialog role/name/state, visible focus, Escape close, focus restoration |
| Error fallback is announced | named alert asserted in the error step |
| Automated scan covers visual and portal roots | axe on **both** owned roots after content is open: 15 + 14 rules, 0 violations, both Hosts; a zero-rule run fails |
| Accessibility claim remains bounded | **R2 claims only the Surface seam and the interactions it exercises — not whole-application or whole-editor WCAG conformance** |

### Surface layout responds to bounded container resize

| scenario | evidence |
| --- | --- |
| Grow and shrink remain within Host bounds | 5-step matrix — compact, wide, tall, repeated-same, original — asserted on both Hosts |
| Resize does not alter lifecycle ownership | mount count and session/root identity unchanged across the matrix; resource ledger unchanged |
| Same-size notifications do not loop | repeated-same-size step is part of the matrix and does not grow the callback ledger |
| Resize cleanup is deterministic | unmount/replacement path asserted; no stale entry mutates a replacement |
| Viewport-resize control is rejected | `check-surface-boundary --negative-control` (`no-viewport-ownership`) |

### Provider-private document drag continuation is owner-bounded

| scenario | evidence |
| --- | --- |
| Active drag alone owns temporary listeners | `data-listeners` reads `coordinator.inspect().listenerCount`: 0 when idle, and `surface-drag-coordinator.test.ts` pins **mouse 2 / pointer 3 / native 3** while live |
| Drag can finish beyond the bounded root | browser step drags past the Surface bounds and releases over Host chrome: `finished: 1`, Host control not activated |
| Two Surfaces isolate drag ownership | same step: second Surface unchanged; focused test covers two independent coordinators |
| Cancel and unmount prevent stale mutation | `staleFinish: 0`; unmount mid-drag cancels; focused tests cover cancel/replacement/returned-cleanup |
| Private types remain private | `check-surface-boundary` `no-public-provider-type-leak` over 15 Surface modules |
| Persistent or ownerless global drag control fails | `check-surface-private-drag --negative-control`; `--converse-control` accepts a live owner-checked drag |

Post-drag `listeners: 0` on both Hosts is the drain evidence.

### R2 closure is final-source, dual-Host, and boundary-preserving

| scenario | evidence |
| --- | --- |
| Final source identity encloses both Host runs | 60-path manifest equal before builds and after all four browser runs; each Host verifies its own build marker with ambient reuse disabled |
| Mechanical checks prove their own sensitivity | 25 checker invocations: 7 normal, 7 negative, 4 converse, plus next-imports, distributable and type baseline — every scan non-empty |
| Both Hosts execute the complete R2 matrix | 10 steps / 16 assertions / 0 step errors per Host; no omitted step or Host profile |
| Type, build, and distributable gates remain bounded | 3 diagnostics, 0 outside pin; both production builds pass; 10/10 exclusions plus one React/ReactDOM root |
| Existing parity and ownership remain green | both parity runs pass; both disposal oracles `clean: true`; see the reconciliation below |
| Capability falsification and claims stop at R2 | `spec-falsification-sweep.md` |

## Parity reconciliation

Final cross-host attribution is **28 / 19 / 9**, equal to the authoritative R1 count. The stale
`25 / 16 / 9` line at the archived R1 `spec-falsification-sweep.md:55` is not used.

**That equality is not the evidence.** Across five cross-host pairings during this session the
semantic total ran 20, 19, 20, 19 with no source, build or host change explaining the movement.
What establishes the claim is a control that ran the identical scenario twice against the
*same* Host and the *same* build:

| comparison | total | semantic | incidental | key | fingerprint | createdIds | other |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| R1 authoritative | 28 | 19 | 9 | 8 | 8 | 3 | 0 |
| R2 canonical (`-z`) | 28 | 19 | 9 | 8 | 8 | 3 | 0 |
| **R2 control, vite vs itself** | **18** | **18** | **0** | **8** | **8** | **2** | **0** |

A host compared against itself still produces all 16 key/fingerprint rows, so those are pure
run-nondeterminism (fresh per-run idempotency UUIDs). The `createdIds` rows count how many of
five `<id:N>` ordinal positions coincide, and `snapshot.ts:141` assigns those ordinals by
first-encounter order during its walk; that count was observed at **2, 3, 3, 4, 4, 3** across six
comparisons with no source, build, or host change. **Zero semantic rows exist outside the T3
idempotency envelope in any comparison**, the persisted track/clip/placement/trim summary is
byte-identical to R1's archived table, and blocked third-party requests (1) and console errors
(2, both from the deliberately blocked `cdn.databuddy.cc`) match R1 exactly. Full detail:
`parity-nondeterminism-control.md`.

## Defects found during final verification

Found by this session's verification rather than inherited from the handoff. Each forced a full
rebuild-and-rerun of both Hosts under the fail-closed protocol.

1. **`tooltip.tsx` had been silently converted CRLF → LF** by an implementer's tooling,
   inflating its diff to 83/76 whole-file. Restored to CRLF (matching HEAD): **31/25**. One
   gratuitous `extends` line-split was also reverted.
2. **Four R2-attributable ESLint errors in new test files** — `prefer-object-params` and three
   `no-unsafe-type-assertion`. The handoff reported "0 errors" because the sweep had covered
   only *tracked* modified files and silently omitted every untracked new file. Fixed at the
   source: the event helper now takes one destructured object and returns `Event` (the generic
   existed only to host the assertion), and the portal fixtures take their type from a declared
   return type instead of an `as` narrowing. No rule was disabled.
3. **`SurfaceDragCoordinator.inspect()` under-reported `listenerCount` for `native` drags** —
   it returned 2 where `addListeners` installs 3 (`dragover`/`dragend`/`drop`). This is the
   oracle the dual-Host drag evidence reads through `data-listeners`, and `native` is reachable
   in production from the assets drag overlay. Fixed, and a new focused test pins all three
   kinds so the two cannot drift.
4. **The React identity probe asserted a field that could never fail** — `consoleErrors` was
   declared as an empty local array, filtered, and returned, so `consoleErrors: []` was
   vacuously true. Removed rather than left as decorative evidence; real coverage is the
   Playwright-level console/pageerror capture.
5. **The frozen hash manifest hashed a dead artifact** — `dist-surface-css/apps/vite-example/surface-css-evidence.html`,
   the 330-byte shell left by the abandoned wrapper approach. The stray output was deleted, the
   path dropped from the manifest (61 → 60), and `dist-surface-css/` added to `.gitignore`;
   all four scan counts are unchanged by that ignore rule.

## Task closure — 47 / 49

`rasen validate s0304-surface-css-react-a11y --strict --project rocut --json` reports
**`valid: true`, 1/1 passed, 0 issues**.

Two tasks are left unchecked rather than claimed on adjacent evidence:

- **2.5 focused CSS tests** — every behaviour it names is proven by the dual-Host browser
  matrix and `check-surface-css-boundary.mjs` with its controls, but no focused Bun CSS suite
  exists. Behaviour covered; requested artifact absent.
- **6.3 focused resize tests** — they would exercise the private root `ResizeObserver` that
  6.1/6.2 authorise only on a demonstrated need. The matrix ran first and no descendant needed
  one, so **R2 added no `ResizeObserver` and no `window.resize` listener** (verified by
  `git diff` over `apps/web/src` and by `no-viewport-ownership`). With no observer there is no
  callback-bounds, same-size-loop or cleanup behaviour to unit test; session identity and the
  absence of lifecycle/resource side effects across the five-step matrix are asserted in both
  Hosts.

## Behaviour changes that evidence depends on — explicit disclosure

Surfaced by independent review, which correctly objected that an assertion made green by
silently altering the component under test must be disclosed rather than presented as a
property the component already had.

**Four Radix focus handlers were removed**, changing production focus behaviour:

| file | removed | effect |
| --- | --- | --- |
| `dialog.tsx` `DialogContent` | `onCloseAutoFocus` → `preventDefault()` + `stopPropagation()` | focus now returns to the trigger on close |
| `dropdown-menu.tsx` `DropdownMenuContent` | same | same |
| `select.tsx` `SelectContent` | same | same |
| `sheet.tsx` `SheetContent` | `onOpenAutoFocus` → `preventDefault()` + `stopPropagation()` | focus now enters the sheet on open |

These are deliberate and **required** by the delta spec, which states that an owned overlay
"restores focus to the invoking control" and that focus "enters the overlay according to its
semantic primitive". `preventDefault()` on `onCloseAutoFocus` suppresses exactly the focus
restoration the scenario demands, so the pre-R2 handlers made that requirement unsatisfiable.
The evidence assertion `await expect(trigger).toBeFocused()` is therefore green *because of*
this change, and the change is the point rather than an accident — but it is a real behaviour
change to every editor dialog, dropdown and select, and it is recorded here for that reason.

**`DialogContent` also gained `text-popover-foreground`.** It previously set `bg-popover`
without a paired foreground, so Host foreground colour leaked in at 3.94:1 and 1.23:1. That is
what the axe WCAG AA contrast rule was reporting, and pairing the token is what clears it.

## Evidence quality defects found by independent review

Each was a case where evidence could not have failed. All are fixed, not annotated.

1. **`staleFinish: 0` was a literal.** `surface-r2-evidence.ts` wrote the drag block as a
   hard-coded object, and the surrounding post-unmount assertions read `data-finishes` /
   `data-listeners` *after a remount* — but those counters are `useState` inside
   `SurfaceEvidenceSeams`, destroyed by unmount, and `SurfaceDragProvider` memoises a fresh
   coordinator. Both read 0 by construction whether or not the stale event fired. Fixed with a
   module-scoped `__r2SurfaceDragTallies` that outlives the Surface, so a `finish` delivered to
   a retired registration is observable; the spec now asserts the tally is unchanged across the
   unmount and that cancel fired exactly once, and every field in the emitted `drag` block is
   read back from the run.
2. **A gate carried a whole-file exemption.** `check-surface-boundary.mjs` exempted
   `surface-drag-coordinator.tsx` from *every* global input listener rule, so a `keydown` or
   `wheel` added to that file later would have passed. Now scoped to the five drag events it
   legitimately owns, and to `document` only — with two new negative controls (a `keydown` in
   that file, and a `window`-scoped `mousemove` in that file) proving the narrowing.
3. **The anti-drift `listenerCount` test could not detect drift.** It compared `inspect()`
   against hard-coded numbers, so dropping an event from `addListeners` would leave it passing.
   It now counts real `addEventListener`/`removeEventListener` calls on the document stub and
   asserts `real === reported` per kind plus full drain on cancel. Verified by injecting the
   drift — deleting the `pointercancel` registration makes the test fail.

## Coverage gap closed: two editor drags were never migrated

Independent review found that `timeline/controllers/playhead-controller.ts` and
`selection/hooks/use-box-select.ts` still installed `window` `mousemove`/`mouseup` pairs. The
delta spec's own scenario names this case — *"a timeline drag/trim/**scrub** begins inside the
Surface, moves beyond its bounds, and releases over Host chrome"* — and the scrub path **is**
the playhead controller, so R2's central ownership claim was partly false.

Two checker defects had made it structurally uncatchable: `check-surface-private-drag.mjs`
scanned only `apps/web/src/editor/surface/embedding/` (24 files), and its pattern matched only
`document.addEventListener`, never `window.`.

Both are fixed:

- The playhead controller now takes `startMouseDrag` through its config and registers with the
  Surface coordinator, matching the pattern already used by the resize, element-interaction and
  keyframe controllers.
- `use-box-select` prefers `useOptionalSurfaceDragCoordinator()` and keeps its `window` pair
  only as a fallback for callers rendering it outside a Surface, mirroring `number-field` and
  its existing `useOptionalEditorSession()`.
- The checker now matches `window` as well as `document`, and scans the whole editor tree —
  **749 files instead of 24** — excluding only Host/product-shell paths (`app/`, `landing/`,
  `site/`, `blog/`, `changelog/`), which are outside the editor claim. It passes clean at that
  scope, which is what establishes no ungoverned editor drag continuation remains. Two new
  negative controls pin the `window`-scoped and outside-`embedding/` cases.

## Cancel now commits, in both migrated controls

Independent review found `number-field`'s `handlePointerCancel` did not call `onScrubEnd?.()`
and `color-picker`'s cancel did not call `onChangeEnd`. Pre-R2 neither had a cancel path at all
(HEAD registers only `pointerup`), but R2 makes one **newly reachable**: the coordinator holds
one drag per Surface, so a second drag starting on the same Surface pre-empts an in-flight
scrub through `cancel`. Since `onScrub`/`onChange` have already applied every intermediate value
to the model, ending without the paired commit would strand an applied value with nothing
closing it.

### The cancel invariant, stated once

Independent review pointed out that this rule was being restated in three separate comments and
never named, leaving the next reader to re-derive it from eight call sites. Named here:

> **Cancel commits if and only if `move` already wrote through to the model and `finish` is the
> only thing that would persist or close it. Otherwise cancel discards.**

All eight coordinator cancel sites obey it:

| site | does `move` write to the model? | `cancel` does | rule |
| --- | --- | --- | --- |
| `number-field.tsx` | yes — `onScrub` | commits `onScrubEnd` | commit |
| `color-picker.tsx` | yes — `onChange` | commits via `handleMouseUp` | commit |
| `playhead-controller.ts` | yes — `scrub()` calls `seek` | `seek` + `setTimelineViewState` | commit |
| `resize-controller.ts` | preview only | `discardPreview()` + finish session | discard |
| `element-interaction-controller.ts` | session state only | reset flag + finish session | discard |
| `keyframe-drag-controller.ts` | session state only | reset + finish session | discard |
| `use-bookmark-drag.ts` | local React state only | `clear`, no `moveBookmark` | discard |
| `use-box-select.ts` | `updateSelection` applies, but `finish` adds no commit — only click-suppression bookkeeping | `setSelectionBox(null)` | discard |

The playhead cancel deliberately omits the ruler-click snap (`didStartFromRuler && !hasMoved`),
which is a click-not-drag affordance with no meaning under pre-emption.

Ruling: **cancel commits**, exactly like finish, in the three controls whose `move` writes
through. The focused test that had frozen the old behaviour (`onScrubEnd` pinned at one
occurrence) now asserts the new semantics and extracts each handler body instead of matching
`[\s\S]*` across the whole file.

## Ownership and contract confirmation

- `EditorSurfaceProps`, `FocusMode`, `SurfaceCommitBinding` and the opaque commit slot are
  unchanged. Every new owner (portal, drag, error, evidence seams) is a private context.
- No Rust/WASM, Host-port contract, transaction contract or engine, persistence
  implementation, headless entry, session lifecycle, or canonical save path is touched.
- Evidence seams render only on the `/surface-evidence` route and are not exported from the
  public barrel.
- **R1 defect repaired in passing:** `installSurfaceFocusScope` called `stopPropagation()` on
  every `pointerdown` in the Surface root's bubble phase. React 18 delegates at a root container
  *above* the Surface, so no descendant `onPointerDown` in the editor subtree ever ran. It now
  stops propagation only when the root itself is the target, and `surface-focus.test.ts` pins
  `childPointer.propagationStopped === false`. R1 missed this because it probed only the root.

## Limitations retained

- **Bounded accessibility claim.** axe covers the Surface visual root and owned portal host with
  representative content open. Host/page findings outside those roots are out of scope; no
  whole-application conformance is claimed.
- **React boundary scope.** Render/commit containment only; event-handler and detached async
  throws are explicitly not claimed.
- **Parity classifier.** The causation-blind one-frame rule and the "semantic"-classified
  run-nondeterministic idempotency envelope are both inherited and unchanged — the diff exits
  non-zero on every run, so its exit code alone cannot gate parity and a human must read the
  rows. R2 does not modify the parity harness (`design.md` non-goal).
- **Inherited lint debt — and the attribution reading used.** 8 changed-file ESLint errors
  remain: `color-picker` ×3, `dropdown-menu` ×2, `number-field` ×1, `playhead-controller`'s
  `event.target as Node`, and `c4-forced-none-harness.tsx`'s `react-hooks/refs`. Every one is
  present on the pristine HEAD blob. The last two entered the changed set only because R2
  began modifying those files (the B1 fix pulled the harness in).

  **The reading matters and is stated explicitly:** under *"no new lint error in substance"* —
  the reading R2 uses — zero are attributable, because none is a construct R2 wrote. Under a
  stricter *"no lint error on any line R2 touched"*, the harness one **is** attributable,
  because the B1 provider wrapping re-indented that line so it appears as `+`/`-` in the diff.
  R2 does not repair either; it neither claims an inherited-defect repair nor hides that the
  stricter reading would count one.
- **Body-portal-outside-Surface.** Primitives used outside a Surface keep their existing
  body-portal behaviour by design; R2's guarantee covers editor-owned calls under the provider.
- **No physical no-rasterizer environment.** This machine has WebGPU and both Hosts run under
  SwiftShader flags, so R2 says nothing about a genuinely rasterizer-free environment. Inherited
  from the E1 spike and still open.
- **Only a Dialog is exercised in the browser portal evidence.** Menus, selects, popovers and
  tooltips are proven to route through the owner by source-level checks and the portal checker,
  but are never opened in either Host. They are the overlays most exposed to the new portal
  host, which sits inside a root with `contain: layout style paint` and `overflow: hidden` and
  carries `transform: translateZ(0)` — an edge-adjacent dropdown will now clip to the Surface
  box. Whether that clipping is desirable is Surface-ownership policy that R2 asserts by design
  (`design.md` D2: "positioning overlays relative to the root … Do not escape to body") but
  does not measure.
- **Single drag per Surface.** The coordinator holds one active registration, so genuinely
  concurrent multi-pointer drags (for example a stylus scrub plus a mouse drag) that previously
  used independent listener sets now pre-empt one another. Accepted as the cost of exact
  ownership; not previously stated.
- **axe fails only on `critical`/`serious`.** Moderate and minor findings are written to the
  evidence and do not fail the run. The reported "0 violations" is nonetheless literal — both
  hosts' `visual.violations` and `portal.violations` arrays are empty at 15 and 14 rules.
- **The resize matrix is `compact, wide, tall, wide, original`.** The two `wide` steps are not
  adjacent, so no genuinely repeated same-size notification is delivered. That step is
  described as "repeated-same" in places; it is not. Moot in practice because R2 adds no
  `ResizeObserver`, so there is no coalescing loop to provoke, but the description overstated
  what ran.
- **Several focused "tests" are source-text scans.** `surface-drag-integrations.test.ts` and
  parts of `surface-portal.test.ts` grep the source rather than exercise behaviour, and
  `check-surface-portal-boundary.mjs`'s `body-portal` regex cannot match a realistic
  `createPortal` call whose first argument contains commas. Independent review verified the
  underlying property by hand — all nine wrappers pass `container` to their single
  `*Primitive.Portal` site, and `draggable-item.tsx` uses `portalOwner` — so the conclusion
  holds, but this class of evidence is weak and should be replaced with behavioural tests
  before anyone relies on it.
- **Diff noise.** `use-bookmark-drag.ts`, `keyframe-drag-controller.ts`, `resize-controller.ts`,
  `color-picker.tsx` and `sheet.tsx` carry pure reformatting/renaming unrelated to R2, which
  inflates the review surface.
- **Single review authorship of this document.** The gates and this report were produced by the
  same LEAD. An independent non-author review **was** run and returned FAIL with one blocker,
  seven major and eight minor findings; everything above marked "found by independent review"
  came from it. A re-review of the delta is the next stage.
