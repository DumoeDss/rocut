/**
 * @opencutSurface provider — the storage barrel; Classic's own machinery
 */
// Declared entry "./storage" (design E1/E4). Curated, not a full mirror of
// services/storage/ (that directory carries many more internal modules).
// See BOUNDARIES.md for the full entry-mapping table.
//
// The conformance/probe modules (browser-project-store-conformance and its
// four cascade/migration/residual probe siblings) are DELIBERATELY NOT
// re-exported here (S05 P1 task 8.5 finding) — the same class of leak
// "./evidence/wasm-test-mock" was carved out of `../evidence/index.ts` to
// prevent (see that file's comment). Every external consumer of these five
// modules' exports is an evidence/fixture script
// (`apps/vite-example/src/c5-*-harness.ts`,
// `script/fixtures/c5-browser-store-conformance/`), never a production Host,
// but `export *`-ing them from this general barrel meant ANY consumer of
// `BrowserProjectStore` — including `next-editor-host.ts` and
// `vite-host-config.ts` — transitively reached
// `browser-project-store-conformance.ts`'s `import type … from
// "@opencut/editor-ports/conformance"`, which itself reaches
// `UNIMPLEMENTED_RUNTIME_GRAPHICS`: a real production entry point able to
// reach the unimplemented-provider fallback. They remain fully reachable at
// their own narrow declared entry, "./storage/conformance".
export * from "../services/storage/browser-project-store";
export * from "../services/storage/browser-project-store-internals";
export * from "../services/storage/browser-storage-mechanisms";
export * from "../services/storage/indexeddb-adapter";
export * from "../services/storage/migrations";
export * from "../services/storage/migrations/v1-to-v2";
export * from "../services/storage/use-storage-persistence";
