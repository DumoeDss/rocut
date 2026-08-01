# C4 review-loop round 1: exact manifest anti-vacuity

## Scope

- Finding repaired: independent verification Major #3 in `verify-report.md`.
- Product/checker edit: `script/check-asset-manifest.mjs` only.
- The manifest producer in `apps/vite-example/build/editor-assets.ts` already emitted copied and emitted counts/totals correctly and was not changed by this repair.

## Red first

The checker fixtures were extended before the validator. The legal-manifest positive control still passed, while the following eight new corrupt cases were incorrectly accepted by the real `--fixture`/`validateManifest` path and made `node script/check-asset-manifest.mjs --negative-control` exit 1:

- delete one of two `fonts` entries while retaining the `fonts` category;
- duplicate a copied logical path;
- stale copied `fileCount`;
- stale copied `totalBytes`;
- stale emitted `fileCount`;
- stale emitted `totalBytes`;
- mismatch against an independent copied-source allowlist;
- mismatch against an independently enumerated copied output.

Each appeared as `FAIL ... non-zero and named <expected-rule>` in the negative-control runner, proving the prior category-only checker did not reject the defects. An emitted duplicate fixture was added with the implementation to cover both inventories symmetrically.

## Repair

`check-asset-manifest.mjs` now:

- rejects duplicate copied and emitted logical paths;
- recomputes and compares copied/emitted file counts and byte totals;
- owns an explicit copied-asset allowlist independent of the Vite producer;
- recursively enumerates the allowlisted source paths under `apps/web/public`;
- independently enumerates the corresponding copied namespaces in the selected build output;
- requires exact two-way path-set equality between the manifest, source allowlist, and copied output;
- fails if any independent source allowlist entry matches no file.

Existing Windows path normalization, logical/base-relative path rules, MIME families, exact bytes, SHA-256, emitted classifications, atlas/image decoding, and exclusion probes remain intact.

## Green evidence

- `node --check script/check-asset-manifest.mjs`: exit 0.
- `node script/check-asset-manifest.mjs --negative-control`: exit 0. The legal manifest positive control passed and all 17 corrupt fixtures failed non-zero with their named rules, including same-category deletion, copied/emitted duplicates, all four stale aggregate cases, and both independent-inventory mismatches.
- `bunx biome check script/check-asset-manifest.mjs`: exit 0.
- Fresh Vite build with `OPENCUT_PUBLIC_BASE=/c4-manifest/`, `C4_VITE_OUT_DIR=dist-c4-manifest-fix`, and marker `c4-manifest-fix-round1`: exit 0, 2,873 modules, 34.45 s.
- Fresh production preview on exclusive `127.0.0.1:43491`; the positive checker command exited 0 with 298 copied files / 4,481,200 bytes and 7 emitted files / 29,875,432 bytes. MIME, byte length, SHA-256, categories/layers, exact independent source/output equality, atlas/image decoding, served-manifest equality, marker/base, and exclusions all passed.
- `node script/check-runtime-asset-boundary.mjs`: exit 0, 699 production modules and both Host roots/eight required layers present.
- `node script/check-runtime-asset-boundary.mjs --negative-control`: exit 0, all six named violations caught.
- `git diff --check`: exit 0.

The owned preview listener on port 43491 was verified by command line and stopped. The fresh output directory and transient preview logs were removed after the check.
