# C6 Scenario 52 durable reopen evidence (FINAL3)

Date: 2026-08-04  
Product worktree: `E:/AI/ChatAI/Agents/VibeCodingProjects/elftia/_others/rocut-wt-c6`  
Exact base/HEAD: `d6ed4166b5ffb13257d1924851f2fa57d73d349f`

## Verdict

**PASS.** On both production Host compositions, one private project record and one attachment are
written through the public `ProjectStore`, the first session is fully disposed, and the same Host
object reopens the same project through a distinct second public session. The known project edit,
private sentinel, raw project bytes, attachment metadata, and attachment body digest all survive.
Both sessions are then absent from the Host registry and all five runtime-resource classes are
terminal. No native IndexedDB/OPFS access, private React/fiber inspection, or emitted-bundle rewrite
is used by the oracle.

This closes delta-spec Scenario 52. It is implementation evidence, not the independent artifact
review required by task 11.10.

## Accepted browser records

| Host | Accepted JSONL                                                                                              | Build marker                    | Build tree SHA-256                                                 | Server PID / port | Records                                       |
| ---- | ----------------------------------------------------------------------------------------------------------- | ------------------------------- | ------------------------------------------------------------------ | ----------------- | --------------------------------------------- |
| Vite | `.rasen/probes/s02-session-disposal/scenario52-durable-reopen/c6-s52-final3-vite-accepted-20260804-1.jsonl` | `c6-s52-final3-vite-20260804-1` | `a515cbcb336946dd0a565e6720bd3e82a02d4fe5e12bce05a6070d3ac8128bb8` | `17496 / 41953`   | three controls, durable reopen, clean summary |
| Next | `.rasen/probes/s02-session-disposal/scenario52-durable-reopen/c6-s52-final3-next-attempt2-20260804-1.jsonl` | `c6-s52-final3-next-20260804-1` | `4fada1582be20cfdfadc102e3dcc7009a8ac42752930d775d2dc4fd983d149e7` | `66124 / 31953`   | three controls, durable reopen, clean summary |

The accepted Vite JSONL is 121,606 bytes with SHA-256
`1c8b374893545b36a35254adccc1ac542414ac9c658eb0f5735bc602bb501d59`. The accepted Next JSONL is
122,239 bytes with SHA-256
`4814beaf725b43f9d49cf6e33fa25b96eb73576caf410247873e5d0d4783edde`. Each has exactly five JSONL
records, a `clean: true` summary, all three evaluator controls, 18 ordinary/missing/leak cycles, and
`durableReopen: true`. Both owned processes were gone and both ports were closed after capture.

The Next filename retains `attempt2` intentionally: it is the first fully clean Next run after the
regular production server received an explicit page-and-client-chunk readiness check. It was not
renamed after capture.

## Durable identity and data proof

Both accepted reports record:

- exact same Host object across the two sessions;
- exact same Host project ID, `c6-disposal-ordinary-1`;
- exact same public store object;
- distinct process-lifetime session IDs, `session-1` then `session-2`;
- first and second session removed, with `activeSessions: 0` at the end;
- known edit `Scenario 52 known edit` after reopen;
- `rawEqual: true` and `privateSentinelEqual: true`;
- attachment key `scenario-52-attachment`, equal metadata, and equal body;
- expected/first/reopened attachment SHA-256
  `bdc3eaacc133fc08118f8e69a969417403735f8441000061d3018bb02fdc1ea4`;
- no browser console errors and no page errors.

The project raw digest is host-specific because the records contain host-specific private sentinel
data, but it is byte-identical before and after reopen within each Host:

- Vite: `0fdc2a529447d00f3a0ae7600382881a0146f35fe386a83584e6cafb5f3bbdd8`;
- Next: `4e5efedaf5723bbba3775060aad47f7b894ee4f747f5ff5ed5b84378032c23f1`.

Store attribution is mechanical, not a stable string or constructor-name assertion. The Vite entry
and Next client page each import the exact production `BrowserProjectStore` implementation and
inject `store => store instanceof BrowserProjectStore` into the shared implementation-neutral
harness. Both reports require `instanceOfBrowserProjectStore: true` and provenance
`session.host.store`. The minified constructor names (`CY` for Vite and `j` for Next) are retained
only as diagnostics. Focused tests also prove a renamed `BrowserProjectStore` subclass is accepted
and `InMemoryProjectStore` is rejected.

The original production defect found by this scenario was a fresh-Host session-ID collision: each
Host factory created a fresh deterministic ID generator, so two Hosts could both publish
`session-1`. Vite and Next now each retain one module-stable `DeterministicIdGenerator` while still
creating fresh non-ID roles. The production composition suite proves distinct IDs across fresh Host
objects and exact stability only for the intended IDs/store/diagnostics roles.

## Disposal proof

The durable cycle preserves the existing C6 evaluator contract. Before the first disposal, all five
classes have non-zero creation counts. After disposal, both the registry report and independent
platform/runtime ledgers are terminal for timer, Worker, audio context, object URL, and GPU resource.
The same holds after the reopened session is disposed. The report also records suspend dwell,
acquisition refusal while suspended, resume generation change, and post-resume activity.

The normal three-control browser path is unchanged: six ordinary cycles, the missing-CREATED
control, and the deliberate Worker/GPU leak control still execute per Host and retain the required
clean/non-clean polarity.

## Frozen FINAL3 builds and B2 review

- Vite output: `apps/vite-example/dist-c6-s52-final3-vite-20260804-1`; 307 files,
  35,040,867 bytes; tree SHA-256
  `a515cbcb336946dd0a565e6720bd3e82a02d4fe5e12bce05a6070d3ac8128bb8`; asset-manifest SHA-256
  `09dfeefbe34b2a8549960541357d1244675322aaf7ed6b050f169bbec477c24a`.
- Next output: `apps/web/.next-c6-s52-final3-next-20260804-1`; 2,613 files,
  247,122,278 bytes; tree SHA-256
  `4fada1582be20cfdfadc102e3dcc7009a8ac42752930d775d2dc4fd983d149e7`; BUILD_ID
  `bkdPLKJK7Ps0LPLLDcsZf`.
- Independent B2 artifact inspection accepted source inventory 714 / attributable closure 266,
  Vite 2,892 emitted modules / 593 web source IDs, and Next 82 route files / 78 maps / 2,557 module
  IDs / 596 source IDs. Emitted/provenance, protected 18-test/95-assertion suite, eight negative
  controls, static topology, and downgrade checks all passed.

The final emitted-assets gate reaccepted these exact directories: Vite has one entry, one
transcription Worker, one editor WASM, and one ORT sidecar; Next has 11 entries, three transcription
Workers, one editor WASM, and one ORT sidecar. Its full negative-control matrix also passed.

## Tests and static tail

- Durable evaluator plus production composition: 14 pass / 0 fail / 57 assertions (5 durable
  tests and 9 composition tests).
- Final focused C6 matrix: 52 pass / 0 fail / 170 assertions across 18 files.
- Session-resource boundary: 714 source modules / 266-module frozen attributable closure, clean;
  every negative control passed.
- Port boundary: 41 contract modules, clean; every negative control passed.
- Session-state boundary: 10/10 factories, 10/10 keys, 52 classified imperative modules, clean;
  every negative control passed.
- Host composition, ESLint, Prettier, Node syntax, targeted `git diff --check`, forbidden native
  storage/private React scan, and emitted normal/negative gates: clean.
- Stable full Bun replay: 390 pass / 8 accepted baseline failures / 2 accepted baseline loader
  errors / 1,328 assertions / 398 tests / 75 files in 43.98 seconds. This is exactly the prior
  386/8/2/1,318 baseline plus four new durable evaluator tests. Log
  `c6-s52-final3-full-bun-20260804-4.log` is 114,632 bytes with SHA-256
  `ca68bf612d9bb9d1267bd25f51baa23ee6081ce913b59dbadb29a6c0ea04f9fc`.

Three earlier aggregate attempts hit nondeterministic Bun 1.2.2 Windows child-process crashes in
isolated wrappers. Each exact crashed child file passed immediately alone. They are retained as
diagnostics and are not the accepted full-suite tail. The stable fourth run contains only the two
reviewed loader errors (`wasm.__wbindgen_start` and the `DEFAULTS` initialization cycle) plus the six
reviewed `ZERO_MEDIA_TIME` placement failures.

## Dedicated final exclusion proof (task 12.13)

A final base-relative audit covered 72 tracked paths plus 24 untracked source/gate paths (96 unique
paths) and exited 0:

```text
PASS c7-headless-paths count=0
PASS e1-elftia-packaging-paths count=0
PASS d2-react-dependency-decision-files count=0
PASS private-port-or-session-type-tracked-diff count=0
PASS private-port-or-session-type-untracked count=0
PASS new-exported-private-port-declarations count=0
PASS rust-api-or-source-tracked-diff count=0
PASS rust-api-or-source-untracked count=0
PASS generated-wasm-identities js=19714428b345a2ac128440319ece8a1c7f3c2f0336d454712189445d427c69f1 wasm=15622cf5f9852c5238cd8326e67a9ec704450d1101a15f2647998501869af9b1
PASS deleted-product-paths count=0
PASS added-durable-store-deletion-calls count=0
PASS audited-final-source-paths count=96 tracked=72 untracked-source=24
PASS base=d6ed4166b5ffb13257d1924851f2fa57d73d349f
```

The audit derives the path set from `git diff --name-only <base>` plus non-ignored untracked files
under the source/script/Rust/dependency roots. It also checks exact generated JS/WASM hashes,
requires no content diff or untracked file under the protected port/session-type and Rust trees,
requires no deleted path, and rejects newly added durable-store deletion calls. Together with the
successful write/dispose/reopen proof above, this establishes that C6 neither enters C7/E1/D2 nor
deletes durable data.

## Rejected attempts

Rejected runs remain available for diagnosis but are not cited as acceptance:

- `c6-s52-final-browser-20260804-1.jsonl`: constructor-name attribution was invalid under Vite
  minification; this led to the exact entry-injected `instanceof` proof.
- `c6-s52-final3-browser-20260804-1.jsonl`: mixed stream containing accepted Vite records followed
  by a rejected standalone Next timeout.
- `c6-s52-final3-next-accepted-20260804-1.jsonl`: rejected first regular-Next attempt with an
  external console/page error before observation emission.

Every rejected server PID was exact-cleaned. Only the two host-separated JSONLs in the accepted
table are acceptance evidence.

## Evidence-tool integrity

- `.rasen/probes/s02-session-disposal/scenario52-durable-reopen/run.mjs`: 15,536 bytes, SHA-256
  `de3393d00681605a79d93b85990b150d33ba4ae9cba72291bfe690bb67780931`.
- `.rasen/probes/s02-session-disposal/scenario52-durable-reopen/start-next.mjs`: 699 bytes, SHA-256
  `6a74e1c7d7566561c3199cbb92322a509ad7b72b00326f31c6c0ff097c6d9efd`.

## Planning and static freeze

- `rasen validate s02-session-disposal --project rocut --strict --json`: exit 0; one change valid,
  one passed, zero failed, zero issues.
- Mechanical checklist recount: 114 checked / 23 unchecked / 137 total. Task 12.13 is checked;
  task 11.10 remains unchecked for a fresh non-author reviewer.
- Product evidence/runner/launcher and planning tasks/handoff/scenario-map/report all pass Prettier;
  the scoped product `git diff --check` passes with only Windows line-ending notices.
- Accepted evidence copies in the planning change are byte-identical to the product capture files.
  Accepted PIDs 17496 and 66124 remain absent; ports 41953 and 31953 remain closed.

No commit, push, PR, integration, spec sync, archive, artifact cleanup, or durable-data cleanup was
performed.
