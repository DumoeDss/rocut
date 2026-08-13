// Declared entry "./evidence" (design E1/E4). This is the one entry that
// deliberately re-exports a module living under a `__tests__` directory
// (wasm-test-mock) — evidence/mock infrastructure other Slice children need
// to consume, not an internal leak. See BOUNDARIES.md for the full
// entry-mapping table.
//
// wasm-test-mock is ALSO separately declared as "./evidence/wasm-test-mock"
// (task 5.4 finding): consumers that only need its `mock.module("opencut-wasm"
// | "mediabunny", ...)` import-time side effect must import that narrow entry
// on its own, sequentially awaited, before importing anything else. Bun does
// not guarantee this barrel's `export *` targets evaluate in source order for
// mutually-independent siblings — c6-disposal-harness / surface-evidence-harness
// transitively reach the real `opencut-wasm` package (runtime/wasm-runtime-providers'
// static `import ... from "opencut-wasm"`), and that real wasm init can run
// before this file's mock.module call regardless of where wasm-test-mock sits
// in the list below. See production-composition.test.ts for the working
// pattern.
export * from "../editor/session/c6-disposal-harness";
export * from "../editor/session/c6-durable-reopen";
export * from "../editor/session/headless-proof-control";
export * from "../editor/session/headless-runtime-probe";
export * from "../editor/session/headless-semantic-fixture";
export * from "../editor/session/__tests__/wasm-test-mock";
export * from "../editor/surface/evidence/surface-evidence-harness";
