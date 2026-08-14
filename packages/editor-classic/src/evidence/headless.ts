// Declared entry "./evidence/headless" (S05 P1 review round 2, C7 barrel-leak
// finding). See BOUNDARIES.md for the full entry-mapping table.
//
// The wide "./evidence" barrel (this directory's index.ts) also re-exports
// `c6-disposal-harness` and `surface-evidence-harness`, both of which
// statically import the real, React-based editor surface
// (`editor-root.tsx`, `editor-session-provider.tsx`,
// `session-core-owner.ts`, ...) to construct and dispose a live editor for
// their own evidence-gathering purpose. Because none of `editor-ports`,
// `editor-contracts` or `editor-classic` declare `sideEffects: false`, a
// bundler must statically resolve every `export *` target in a barrel to
// know its exported bindings — it cannot skip loading a sibling export just
// because a given consumer only touches two of the barrel's six members.
// The C7 headless proof's whole purpose is to demonstrate that its bundle
// carries zero React dependency; importing through the wide barrel pulls in
// React, ReactDOM, `scheduler`, `sonner` and the full editor surface as an
// unavoidable side effect of the barrel's shape, not of anything the C7
// entry chain itself needs — measured: `apps/vite-example/src/headless-
// entry.ts` built through the wide barrel emits react-family and
// full-editor-or-browser-composition modules that `check-headless-
// graph.mjs`'s `forbiddenRule()` correctly rejects, on the *neutral*
// control, which must pass clean.
//
// This entry exists so the C7 entry chain (`apps/vite-example/src/headless-
// entry.ts`, `apps/web/src/app/c7-headless/route.ts`) can import exactly the
// modules it uses — proof control and runtime probe — without statically
// reaching the disposal/surface harnesses. Those two consumers are the only
// supported importers of this entry; `c6-disposal-harness` and
// `surface-evidence-harness` remain reachable at their own routes
// (`/c6-disposal`, `/surface-evidence`) through the wide barrel, which is
// correct for them — they need the real editor surface to do their job.
//
// `headless-semantic-fixture` is deliberately NOT re-exported here even
// though the C7 entry chain also uses it: both consumers reach it through a
// *separate* declared entry, "./evidence/headless-semantic-fixture", used
// only for a dynamic `import()` of the "subject under test" (see those
// files' own comments). Folding it into this barrel alongside the two
// statically-imported members reproduces the same defect class this file
// exists to avoid, one level down: Rollup/Vite resolve a module reached by
// both a static and a dynamic import from the *same specifier* into the
// entry's own chunk, and Vite's dynamic-import preload helper still emits
// its `document.head.appendChild(<link rel="modulepreload">)` side effect
// for that already-resident module — a real, measured childList mutation
// (`react.mutationRecords: 1` in the runtime probe) that has nothing to do
// with React but still trips the C7 "clean" gate's zero-DOM-mutation
// requirement. Keeping the dynamic-import target on its own specifier,
// disjoint from anything imported statically, is what the original S02
// entry chain (`be9cfc4e`) did before the S05 package move folded proof-
// control/runtime-probe/semantic-fixture into one barrel; this split
// restores that separation rather than inventing a new one.
export * from "../editor/session/headless-proof-control";
export * from "../editor/session/headless-runtime-probe";
