# Ship log — r08-host-ensure-and-runtime

Shipped 2026-08-18 by r08-shipper.

## Commit

- **Branch:** `feat/s08-host-ensure-and-runtime` (from main `00ef74cc`)
- **Commit:** `670b71a5` — `feat(cli): host ensure, project-identity resolution, registry hygiene, runtime bundle`
- **Stat:** 14 files changed, 3224 insertions(+), 126 deletions(-)
  - 6 modified: `.gitignore`, `apps/cli/src/host.ts`, `apps/cli/src/main.ts`,
    `apps/cli/src/target-registry.ts`, `bun.lock`, `package.json`
  - 8 added: `apps/cli/src/ensure.ts`, `apps/cli/src/host-activity.ts`,
    `apps/cli/src/__tests__/{cli-verbs,ensure,host-health,target-registry}.test.ts`,
    `script/pack-runtime.mjs`, `script/__tests__/pack-runtime.test.mjs`
- Excluded as instructed: no `.bun-install*.log` / `.tmp*` present at ship time.

## PR + merge

- **PR:** https://github.com/DumoeDss/rocut/pull/15 (base `main`)
- **CI:** all 4 checks green before merge — `build (ubuntu-latest)` 2m03s,
  `build (windows-latest)` 5m20s, `build (macos-latest)` 5m41s, `sdk-examples` 4m37s
  (run 32140732552). No approvals required.
- **Merge:** `--merge` at 2026-08-18T13:15:29Z; merge commit
  `ce9f1438168f67cf67985fb6059f940bef284a10`.

## Main-checkout sync

`E:\AI\ChatAI\Agents\VibeCodingProjects\elftia\_others\rocut` pulled
`origin/main`: fast-forward `00ef74cc..ce9f1438`, same 14-file stat. Untracked
scratch items (`.rasen/`, `.tmp-digest-check.ts`, `.tmp-probe/`) untouched.

```
ce9f1438 Merge pull request #15 from DumoeDss/feat/s08-host-ensure-and-runtime
670b71a5 feat(cli): host ensure, project-identity resolution, registry hygiene, runtime bundle
00ef74cc chore(rasen): archive s02 + s0304 parent changes (slices reconciled passed)
```

## Deviations (as disclosed in the PR body)

- SSE activity test exercises the exported `revisionEventWriter` seam + structural
  wiring assert (bun 1.2.2 clients cannot consume bun-server SSE; verified
  pre-existing vs the pre-S08 host).
- Packer keeps an `--allow-dirty` escape hatch (dev/test artifact marking); refuses
  a dirty tree by default.
- esbuild 0.27.3 rejects `.mjs` `outExtension` → post-build entry rename.
- Editor-surface copy is opt-in (`--static`); absent surface refuses (skip-surface
  in dev).
- Disclosed pre-existing (not this PR): `check:packages` fails at base —
  `frame-proof.test.ts` imports the undeclared subpath
  `@opencut/editor-classic/timeline/types`; verified identical at `00ef74cc`.

## Archive
**Date:** 2026-08-18T18:45:24.864Z
**Outcome:** archived at E:\AI\ChatAI\Agents\VibeCodingProjects\elftia\_others\rocut\rasen\changes\archive\2026-08-18-r08-host-ensure-and-runtime
**Transaction:** 59608622-49dc-4a9c-9ce5-6738947c1db6
