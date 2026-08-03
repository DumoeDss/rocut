# Handoff - C5 strategy attempt 2 independent reviewer

Date: 2026-08-02  
Worktree: `E:\AI\ChatAI\Agents\VibeCodingProjects\elftia\_others\rocut-wt-c5`  
Base/current HEAD: `0ef35459f685d5d41a25d0ef959aff691b7519cd`  
Full report: `evidence/strategy-attempt-2-review.md`

## Status

**STRATEGY ATTEMPT 2 NOT CONFIRMED - ATTEMPT 3 REQUIRED**

- Blocker: 1
- Major: 0
- Minor: 0
- Test-gap: 1
- Reviewer product/task/prior-evidence edits: 0
- Commit: none

The exact attempt-2 M1 2/2 and M2 6/6 acceptance groups pass in real Chromium.
The strategy-1 M1 6/6 and M2 5/5 groups also remain green. Preserve the strict
tombstone classifier, exact media descriptors/certificates, rev1 fail-closed
behavior, binding-scoped owners, projects-control-plane queue, and v2 media
target authorization.

## Attempt-3 open item

**Bind the library target in v2 all-clear recovery.** The v2 journal stores
exact historical media targets but only a `clearLibrary` boolean. After an
interrupted old-configuration `clear(all)`, retry through a wrapper sharing the
projects control plane but using a new library database/store clears the new
unrelated library and leaves the old committed-clear library intact.

Independent Chromium proof:

```text
before reload: old={marker:"old"}, new={marker:"new"}
after reload through new config: old={marker:"old"}, new=null
```

Attempt 3 must add a versioned exact library binding/target to the journal and
validate it on retry, or refuse a mismatch before library I/O. Add a real-browser
test that interrupts `scope: all`, changes the library configuration, reloads,
and proves the originally journaled library is cleared while the unrelated
current library survives.

## Green evidence to preserve

- Full Chromium config 3/3 on Chrome 151; store 19/19, lifecycle 16/16,
  cascade R1 9/9, cascade R2 prior 11/11 + attempt-2 6/6, corrupt 6/6, abort 7/7.
- Focused Bun 48/48 / 216 expectations; Vite TypeScript and exact-three baseline
  clean.
- Configured attempt-2 ESLint set 0 errors / 0 warnings; Prettier and strict
  diff clean.
- Port/storage/session/Host boundaries clean.
- Disposable browser identity and Playwright marker cleaned; port 4175 free.

