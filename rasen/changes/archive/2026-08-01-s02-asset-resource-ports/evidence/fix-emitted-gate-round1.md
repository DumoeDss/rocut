# C4 review-loop round 1: Next emitted-output gate repair

## Finding addressed

Independent verification Major #2 showed that `nextInventory()` extracted only already-prefixed editor chunk URLs and passed only those selected JS files plus detected Workers to `scanEscapingUrls()`. This made three classes of output invisible: a root `/_next/...` entry in the client-reference manifest, emitted editor HTML/CSS, and an unselected lazy JS/MJS chunk.

## Failing control before the repair

A filesystem-backed `mixed-next-root-escapes` fixture was first added without changing the inventory/parser. It contained all four required emitted layers and a good prefixed entry, plus root escapes in the same Next client manifest, editor HTML, editor CSS, and a lazy `.mjs` referenced by the good entry. The fixture went through the real `nextInventory()` and `scanEscapingUrls()` functions.

Command:

`node script/check-emitted-runtime-assets.mjs --negative-control`

Pre-repair result: exit 1 because the harness reported `FAIL mixed-next-root-escapes`; the checker itself returned zero for that corrupt graph. All seven pre-existing synthetic violation-object controls still passed. This reproduced the verifier's false-green claim without relying on a directly constructed violation.

## Repair

Only `script/check-emitted-runtime-assets.mjs` was changed.

- Next static references are now parsed without filtering on the expected base first. Both prefixed and root `/_next/static/...` references are retained, so the client-reference manifest itself can expose an escaping URL.
- The scan set is the editor route's emitted HTML/CSS/client-reference manifest plus the transitive browser client graph seeded by manifest references, route browser files, and the detected Worker. References discovered inside reachable HTML/CSS/JS/MJS files are followed recursively.
- Arbitrary Next server bundles are not scanned: unrelated `server/**/*.js` files remain outside the graph. The only server-tree JavaScript admitted is the editor client-reference manifest; route HTML/CSS/MJS are browser output.
- `.mjs` is supported for entry, Worker, scan, and lazy-graph discovery. A referenced but missing client graph file now fails closed with `missing-reachable-next-file`, and an empty browser scan receives an explicit violation.
- `mixed-next-root-escapes` now requires attributable findings for the manifest, HTML, CSS, and lazy `.mjs` path. A matching all-contained fixture exercises the same real parser/scanner as a positive control.

The repaired mixed fixture reports:

- `root-next-entry-url` in `page_client-reference-manifest.js` for `/_next/static/chunks/root-manifest.js`;
- `root-next-entry-url` in the emitted editor CSS;
- `root-next-entry-url` in the emitted editor HTML;
- `root-emitted-entry-url` in `static/chunks/lazy-good.mjs` for `/flags/root-lazy.svg`.

## Verification

- `node --check script/check-emitted-runtime-assets.mjs` — exit 0.
- `node script/check-emitted-runtime-assets.mjs --positive-control` — exit 0; the base-contained manifest/HTML/CSS/lazy graph passed the real parser and scanner.
- `node script/check-emitted-runtime-assets.mjs --negative-control` — exit 0; 8/8 controls passed, including the mixed real-parser control.
- `node script/check-runtime-asset-boundary.mjs` — exit 0; 699 production modules, both Host roots, all eight required layers, and all five rules clean.
- `node script/check-runtime-asset-boundary.mjs --negative-control` — exit 0; 6/6 named controls passed.
- `git diff --check` — exit 0 (only existing Git line-ending warnings).

The exact `.next-c4-final` and `dist-c4-final` artifacts used by the original production proof had already been intentionally removed during cleanup. No stale build was substituted for that evidence. The integration verifier should run the normal emitted gate once against the next fresh exact C4 Vite/Next outputs.

No commit was created. No provenance/task/runstate files were edited.
