# Group E1 — deterministic clip-heavy project generator

Deliverable: `apps/electron-host/scripts/generate-clip-project.mjs`

```
node apps/electron-host/scripts/generate-clip-project.mjs --root <dir> [--clips 2000] [--name "Perf 2000"] [--force] [--self-log]
```

- Writes ONE project record into a fresh throwaway store root THROUGH THE REAL
  STORE CLASSES — `FilesystemProjectStore` over `NodeFsStoreBridge`, identity
  `DEFAULT_FILESYSTEM_STORE_IDENTITY` (`opencut-fs-production`), no byte is
  hand-forged: the on-disk `projects/<id>/record.json` envelope is produced by
  the bridge's own `saveRecord`.
- Refuses a non-empty root unless `--force` (fresh-state repeatability).
- Default root (no `--root`):
  `E:/AI/ChatAI/Agents/VibeCodingProjects/elftia/_others/rocut-export-scratch/perf-projects`
  — never under %TEMP%. Scratch roots used for these runs:
  `.../rocut-export-scratch/perf-projects-smoke-200`, `.../perf-projects`,
  `.../perf-projects-determinism-check`.
- Prints the full METHOD block, the project id + name (harness opens
  `?project=<id>`), the store file listing, and — under `--self-log` — the
  final stdout line `REAL_EXIT_CODE:<code>`.

## Persisted-shape facts (what the record actually contains)

- Envelope: JSON, `kind: "opencut-project-record"`, `schemaVersion: 31`,
  `summary {id, name, createdAt, updatedAt}`, `payload` = base64 of the
  bridge's `node:v8` serialization of `{id, schemaVersion, data}`.
  `schemaVersion` is read off the store instance (`store.schemaVersion` =
  `FILESYSTEM_STORE_SCHEMA_VERSION` = `CURRENT_PROJECT_VERSION` = 31), never
  hardcoded in the record.
- `data` mirrors `encodeProject`'s durable shape exactly (verified by the
  exact-shape gate below): keys `metadata {id, name, thumbnail, duration,
  createdAt, updatedAt}`, `scenes`, `currentSceneId`, `settings`, `version
  (31)`, `timelineViewState`; dates as ISO strings; elements carry the full
  24-key `ELEMENT_KEYS` list with `undefined` for absent fields (e.g.
  `mediaId`, `sourceDuration`, `animations`, `masks`, `stickerId` are present
  keys with undefined values); tracks carry `TRACK_KEYS` `{id, name, type,
  elements, muted, hidden}`.
- Track kinds: 1 empty video main track (`"Main Track"`, `muted: false`,
  `hidden: false`), 0 audio tracks, 16 overlay tracks = 8 `text` + 8
  `graphic` (text tracks have `muted: undefined` present, `hidden: false`).
- Element param names:
  - text: `content, fontFamily, fontSize, color, textAlign, fontWeight,
    fontStyle, textDecoration, letterSpacing, lineHeight,
    background.enabled, background.color, background.cornerRadius,
    background.paddingX, background.paddingY, background.offsetX,
    background.offsetY, transform.positionX, transform.positionY,
    transform.scaleX, transform.scaleY, transform.rotate, opacity,
    blendMode`
  - graphic (definitionId `rectangle`, builtin registry): the
    `visualElementParams` seven (`transform.positionX/Y, transform.scaleX/Y,
    transform.rotate, opacity, blendMode`) plus rectangle definition params
    `fill, stroke, strokeWidth, strokeAlign, cornerRadius`.
- Settings mirror classic's new-project defaults: fps `{numerator: 30,
  denominator: 1}`, canvas `{width: 1920, height: 1080}`, `canvasSizeMode:
  "preset"`, `background {type: "color", color: "#000000"}`.

## Method (as printed by the 2000-clip run)

```
--- METHOD ---
command inputs: --root E:/AI/ChatAI/Agents/VibeCodingProjects/elftia/_others/rocut-export-scratch/perf-projects --clips 2000 --name "Perf 2000" (defaults: clips 2000, name "Perf 2000")
store classes: FilesystemProjectStore over NodeFsStoreBridge (../src/store/*), identity DEFAULT_FILESYSTEM_STORE_IDENTITY, schemaVersion read off the store instance (31); record built in the encodeProject durable shape (dates ISO strings, ELEMENT_KEYS/TRACK_KEYS with undefined for absent fields)
determinism: mulberry32(seed=clips), no Math.random; element ids `clip-<i zero-padded 6>`; project/scene/track ids uuidFromRng drawn in order: project, scene, main track, 16 overlay tracks; dates = Date.UTC(2026,0,1) + rng()*86400000 (updated = created + rng()*3600000; scene drawn separately)
project: one main scene "Main scene"; settings mirror classic new-project defaults: fps 30/1, canvas 1920x1080, canvasSizeMode "preset", background {color #000000}; version 31
tracks: main video track "Main Track" EMPTY (no media pipeline), 0 audio tracks; overlay = 8 text tracks ("Text 1".."Text 8") + 8 graphic tracks ("Graphic 1".."Graphic 8")
elements: 2000 total = 1000 text + 1000 graphic
layout formula: element i (0-based) -> overlay track (i % 16), slot floor(i / 16); startTime = slot * 240000 ticks; each element: duration 240000, trimStart 0, trimEnd 0 (2s each; TICKS_PER_SECOND = 120000)
text element (i % 16 < 8): name/content "Clip <i>", fontFamily Arial, fontSize 15+(i%5)*10, color PALETTE[i%6] (#ff5252 #4dff88 #4d9fff #ffd24d #c14dff #ffffff), full DEFAULTS.text.param set (background.*, letterSpacing 0, lineHeight 1.2)
graphic element (i % 16 >= 8): definitionId "rectangle" (builtin registry), fill PALETTE[(i+3)%6], stroke #000000, strokeWidth i%3, strokeAlign "center", cornerRadius (i%4)*10, scale 0.5+((i*7)%10)/10
motion (both kinds): transform.positionX (i*97)%1600-800, transform.positionY (i*131)%800-400, transform.rotate ((i*13)%360)-180, opacity 1, blendMode "normal" — frames differ over time by construction
totals: 125 slots/track * 240000 ticks = 30000000 ticks (250s) timeline; elements per track = 125 or 125 (last track takes remainder)
rng draws consumed: 308
project id: fc379315-3d76-4274-b52d-1673a7a17264
--- /METHOD ---
```

TICKS_PER_SECOND 120000 asserted against the wasm test mock's value; the
generator script never calls into wasm (see Deviations).

## Run 1 — smoke, 200 clips

Command (Git Bash, repo root `apps/electron-host` cwd not required; run from
worktree root):

```
$ node apps/electron-host/scripts/generate-clip-project.mjs --root E:/AI/ChatAI/Agents/VibeCodingProjects/elftia/_others/rocut-export-scratch/perf-projects-smoke-200 --clips 200 --force --self-log
```

Result: exit 0, 18/18 PASS, `REAL_EXIT_CODE:0`. Validation lines:

```
PASS  list() == 1 record with id 4e9b7da6-cc76-4047-a851-ded5de43f8f7
PASS  load() returned the record
PASS  schemaVersion 31 === store.schemaVersion 31 (CURRENT_PROJECT_VERSION 31)
PASS  payload.version === 31
PASS  one main scene, currentSceneId matches
PASS  overlay tracks 16 = 8 text + 8 graphic
PASS  main video track present and empty
PASS  no audio tracks
PASS  element count 200 === clips 200
PASS  kind split text 104 + graphic 96 === 200
PASS  kind split matches formula (text 104, graphic 96)
PASS  element 0: text, startTime 0, duration 240000
PASS  metadata.duration 3120000 === 3120000 ticks (26s)
PASS  every element matches the layout formula (startTime/duration/trimStart/trimEnd; 0 mismatches)
PASS  exact-shape equality: reloaded payload === generated payload (full ELEMENT_KEYS/TRACK_KEYS shape, key order, undefined keys included)
PASS  reloaded payload is a node:v8 serialization fixed point (byte-stable across another round trip)
PASS  durable file written by the store's own bridge: .../perf-projects-smoke-200/projects/4e9b7da6-cc76-4047-a851-ded5de43f8f7/record.json
PASS  on-disk record.json envelope is the store's own (kind=opencut-project-record schemaVersion=31 payloadBytes=186428)
```

## Run 2 — full, 2000 clips (default root)

```
$ node apps/electron-host/scripts/generate-clip-project.mjs --clips 2000 --name "Perf 2000" --self-log
```

Result: exit 0, 18/18 PASS, `REAL_EXIT_CODE:0`. Validation lines:

```
PASS  list() == 1 record with id fc379315-3d76-4274-b52d-1673a7a17264
PASS  load() returned the record
PASS  schemaVersion 31 === store.schemaVersion 31 (CURRENT_PROJECT_VERSION 31)
PASS  payload.version === 31
PASS  one main scene, currentSceneId matches
PASS  overlay tracks 16 = 8 text + 8 graphic
PASS  main video track present and empty
PASS  no audio tracks
PASS  element count 2000 === clips 2000
PASS  kind split text 1000 + graphic 1000 === 2000
PASS  kind split matches formula (text 1000, graphic 1000)
PASS  element 0: text, startTime 0, duration 240000
PASS  metadata.duration 30000000 === 30000000 ticks (250s)
PASS  every element matches the layout formula (startTime/duration/trimStart/trimEnd; 0 mismatches)
PASS  exact-shape equality: reloaded payload === generated payload (full ELEMENT_KEYS/TRACK_KEYS shape, key order, undefined keys included)
PASS  reloaded payload is a node:v8 serialization fixed point (byte-stable across another round trip; 1370068 bytes)
PASS  durable file written by the store's own bridge: E:/AI/ChatAI/Agents/VibeCodingProjects/elftia/_others/rocut-export-scratch/perf-projects/projects/fc379315-3d76-4274-b52d-1673a7a17264/record.json
PASS  on-disk record.json envelope is the store's own (kind=opencut-project-record schemaVersion=31 payloadBytes=1826760)
```

Store file listing (the store's own layout — nothing else written):

```
E:/AI/ChatAI/Agents/VibeCodingProjects/elftia/_others/rocut-export-scratch/perf-projects/
  projects/
    fc379315-3d76-4274-b52d-1673a7a17264/
      record.json
```

Project for the harness: id `fc379315-3d76-4274-b52d-1673a7a17264`, name
`Perf 2000`, open at `?project=fc379315-3d76-4274-b52d-1673a7a17264`.

## Determinism proof (fresh state, fixed clip count)

A third run into a different fresh root
(`.../perf-projects-determinism-check`, `--clips 2000`) produced the SAME
project id, and its `record.json` is byte-identical to the Run 2 file
(`cmp` across roots: identical). Same seed ⇒ same ids, same dates, same
payload bytes, end to end through the real save path.

## Gates

- LF discipline: `tr -dc '\r' < apps/electron-host/scripts/generate-clip-project.mjs
  | wc -c` = 0 (also 0 for this evidence file).
- `node script/check-package-boundary.mjs` — clean, all rules PASS (1153
  files scanned, including the new script; no cross-package specifiers: the
  script's only app imports are the in-package relative
  `../src/store/filesystem-project-store.ts` and
  `../src/store/node-fs-store-bridge.ts`):

```
PASS  acyclic-direction: every cross-package edge points to a strictly lower declared layer (1025 file(s) scanned, 434 cross-package edge(s) examined)
PASS  public-entry-only: a specifier crossing into a package resolves only to a declared exports subpath (1025 file(s) scanned, 433 @opencut/* specifier(s) examined)
PASS  no-internal-reexport: no package's declared entry re-exports a module owned by another package's undeclared internals (872 file(s) scanned)
PASS  no-elftia-import: no package, Host or example imports an Elftia package, protocol identifier or runtime object (1153 file(s) scanned)
PASS  react-free-base: editor-ports and editor-contracts import no React, no DOM global, and no editor-classic module (76 file(s) scanned)
```

- Exit codes: both runs `REAL_EXIT_CODE:0` on the last stdout line
  (matches shell exit status; the fresh-root refusal path was exercised
  accidentally-and-confirmatorily: a re-run without `--force` over a
  populated root refused with exit 1).

## Deviations / findings

1. **Runtime is `node` (24.14), not `bun`.** Bun 1.2.2's runtime cannot load
   `opencut-wasm` (wasm-bindgen sync init throws
   `wasm.__wbindgen_start is not a function`) outside the bundler — the same
   constraint the store conformance test documents when it isolates with
   `evidence/wasm-test-mock`. The script instead registers a `node:module`
   loader (inline data-URL, self-contained in the script) that (a) serves an
   in-memory `opencut-wasm` shim mirroring the house wasm-test-mock export
   list and (b) retries extensionless relative TS specifiers (`.ts`,
   `/index.ts`, `.tsx`, `/index.tsx`) for native type-stripping. The shim
   only unblocks module loading; generation and validation never call into
   wasm, and no store byte is affected by it.
2. **v8 wire-byte equality is not a fixed point for freshly built objects.**
   The original byte-equality gate (serialize(built) vs serialize(reloaded))
   failed although JSON-shape (keys incl. undefined values, order, values)
   was identical: V8's ValueSerializer canonicalizes on the first
   serialize→deserialize cycle (verified in isolation: built ≠ once, but
   once == twice, always). The gate was therefore replaced by (a) exact-shape
   equality over an undefined-preserving stable stringify and (b) a v8
   fixed-point check on the reloaded payload — both PASS in both runs. The
   determinism proof above shows the on-disk bytes are still fully
   reproducible run-over-run.
3. **`--name` default.** Run 1 used the default name "Perf 2000" (its log
   line `command inputs` shows `--clips 200` with default name); the CLI
   takes `--name` explicitly as the task specified.
4. Scratch probe files (loader validation, diff diagnostics) live under
   `.../rocut-export-scratch/probe/` outside the repo — not deliverables.

## LEAD addition (post-E1, before E2): `--layout dense` + `--width/--height`

The staggered default (2000 clips ≈ 250s @ 1080p) implies a ≈46 GB raw export
stream — infeasible on the 13 GB-free E: disk. Added, without touching the
staggered default or any generated byte for it: `--layout dense` (every
track's elements start within its first 2s at 1920-tick steps and run 8s —
all N elements composite in every frame, the per-frame render stress shape)
and `--width/--height` canvas override (canvasSizeMode "custom" when
overridden). Validation gate + method block extended for both. Verified:
dense 200 @720p all-PASS, dense 2000 @720p timeline = 1198080 ticks (9.984s),
REAL_EXIT_CODE:0 (runs above). E2 measures on `--layout dense --width 1280
--height 720` and records the shape choice in its method section.
