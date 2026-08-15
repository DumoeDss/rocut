/**
 * @opencutSurface experimental — surface-evidence harnesses; evidence/test infrastructure, unstable by intent
 */
// Declared entry "./evidence" (design E1/E4). See BOUNDARIES.md for the full
// entry-mapping table.
//
// wasm-test-mock (`editor/session/__tests__/wasm-test-mock.ts`) is
// DELIBERATELY NOT re-exported here (S05 P1 task 6.5 finding). It was
// originally included, on the reasoning that it is evidence/mock
// infrastructure other Slice children need to consume, not an internal leak.
// That reasoning still holds for the file's *purpose*, but not for reaching
// it through this barrel: wasm-test-mock imports `bun:test` at module top
// level and registers `mock.module("opencut-wasm" | "mediabunny", ...)`
// side effects on evaluation — both Bun-test-runtime-only. Because none of
// `editor-ports`, `editor-contracts` or `editor-classic` declare
// `sideEffects: false`, a bundler cannot tree-shake that module out of a
// production bundle for ANY consumer of this barrel, even one that never
// touches wasm-test-mock's own exports. `apps/web`'s production `next build`
// (Turbopack) evaluates every route module during "Collecting page data",
// including `/c7-headless`, `/c6-disposal` and `/surface-evidence` — none of
// which need the mock — and `bun:test` does not resolve under Node, crashing
// the build outright.
//
// wasm-test-mock remains fully reachable at its own narrow declared entry,
// "./evidence/wasm-test-mock" (task 5.4 finding), which is the ONLY supported
// way to obtain its side effect regardless: consumers that need
// `mock.module(...)` to run must import that narrow entry on its own,
// sequentially awaited, before importing anything else. Bun does not
// guarantee an `export *` barrel's targets evaluate in source order for
// mutually-independent siblings — c6-disposal-harness / surface-evidence-harness
// transitively reach the real `opencut-wasm` package (runtime/wasm-runtime-providers'
// static `import ... from "opencut-wasm"`), and that real wasm init can run
// before a mock.module call regardless of where wasm-test-mock sits in an
// `export *` list. See production-composition.test.ts for the working
// pattern — it already imports "./evidence/wasm-test-mock" directly and never
// relied on this wide barrel for it. Removing wasm-test-mock from the list
// below therefore changes no supported consumer's behaviour.
export * from "../editor/session/c6-disposal-harness";
export * from "../editor/session/c6-durable-reopen";
export * from "../editor/session/headless-proof-control";
export * from "../editor/session/headless-runtime-probe";
export * from "../editor/session/headless-semantic-fixture";
export * from "../editor/surface/evidence/surface-evidence-harness";
