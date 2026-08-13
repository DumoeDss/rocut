# Per-feature handling without a server

What happens to each editor feature that depends on something other than static first-party files,
when the editor is built by Vite and served as static output with no Next.js runtime and no API
routes.

Two things this document is careful about:

- **Excluded** means the control is not rendered at all. **Degraded** means the feature is present
  and tells the user why it cannot work. Neither means "left to fail" — a static host answers a
  missing `/api/...` route with `index.html` at HTTP 200, so an unguarded `fetch` succeeds, `res.ok`
  is true, and the user gets a JSON parse error instead of a diagnosis. Every server-backed feature
  therefore gates on **configured endpoint**, never on request failure.
- The remote-dependent rows are **diagnostics, not acceptance**. That a third-party CDN is
  unreachable in a first-party-only run is information about the feature's coupling; it is not
  evidence that the feature works, and no claim of adequacy is made for any of them.

Slice clause: §3.7.

---

| Feature                                            | Depends on                                                                       | Handling                                                                                                                                                                                                                                                    | What the user sees                                                                                                                                                                                                               |
| -------------------------------------------------- | -------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Sounds panel** (Freesound search and top sounds) | `GET /api/sounds/search` — a server-side proxy holding the Freesound credentials | **Degraded.** Both fetch paths read `services.soundSearchEndpoint` from the host and skip entirely when it is unset (patches P-011, P-012).                                                                                                                 | An explicit unavailable state in the panel body. Design D9 assumed an existing error display could be reused; there was none — the store's `error` field was written but read by no component — so an explicit render was added. |
| **Feedback**                                       | `POST /api/feedback`                                                             | **Excluded**, belt and braces. `EditorHeader` renders `FeedbackPopover` only when `services.feedbackEndpoint` is set (P-007), and the popover itself no-ops without one (P-013).                                                                            | No feedback control in the header at all. Nothing to click and no error to misread.                                                                                                                                              |
| **Stickers — flags**                               | _(nothing remote)_                                                               | **Works.** `flagsProvider.resolveUrl` builds a first-party `/flags/<code>.svg` path, and all 271 flag SVGs are copied by the asset allowlist.                                                                                                               | Fully functional offline. Planning expected a remote icon API here; at this pin there is none.                                                                                                                                   |
| **Stickers — shapes**                              | _(nothing remote)_                                                               | **Works.** `shapesProvider` generates its SVG presets in code; nothing is fetched, and `public/shapes/` is deliberately not copied because nothing requests it.                                                                                             | Fully functional offline.                                                                                                                                                                                                        |
| **Stickers — logos**                               | _(nothing remote at this pin)_                                                   | **Empty by upstream design.** `logosProvider.search()` and `.browse()` both return empty results at `cf5e79e9`; the provider is registered but has no catalogue.                                                                                            | An empty logos section. This is upstream behaviour, not a portability loss — worth knowing before it is mistaken for one.                                                                                                        |
| **Platform guide artwork**                         | `https://cdn.brandfetch.io/`                                                     | **Degraded, remote.** The guide definitions point at a third-party CDN. `HostImage` forwards `onError`, so a failed load surfaces the call site's own fallback rather than a broken-image box.                                                              | Guide entries render; their brand artwork does not load first-party-only. Never requested during the parity scenario.                                                                                                            |
| **Font faces**                                     | `https://fonts.googleapis.com/css2`                                              | **Split.** The font _catalogue_ is first-party: `/fonts/font-atlas.json` plus 15 `/fonts/font-chunk-*.avif` sprite chunks (2.4 MB) are copied and were served on every run. Only loading an actual Google-hosted font face is remote.                       | Font pickers and previews work offline from the atlas. Selecting a Google font for real text rendering needs the network.                                                                                                        |
| **Transcription** (subtitles)                      | Hugging Face model download, via `@huggingface/transformers` in a Worker         | **Degraded, remote, and on demand.** The Worker is constructed only when transcription is used. Its 21.6 MB `ort-wasm-simd-threaded.jsep.wasm` is emitted into `dist/` but is **not on the initial load path** — verified three ways in `BOUNDARIES.md` §4. | The panel is present; starting a transcription without network access fails at the model download. Never triggered in the parity scenario.                                                                                       |

Saved sounds and custom graph presets are not shell preferences. They are namespaced durable
library records supplied through the owning session's `EditorHost.store`, so they follow the same
failure, ordering and private-data rules as other durable editor content. The unrelated changelog,
feedback-history, mobile-gate, generic-form, onboarding and persistence-prompt values remain
explicit local UI preferences backed by `localStorage`; C5 does not migrate them opportunistically.

---

## Port roles the host seam carries

The seam this record describes used to carry server endpoints and nothing else. It now carries the
full Host port surface (`apps/web/src/editor/ports/index.ts`), so the record extends to every port
role: what a Host must supply, and what happens when it supplies nothing.

**The answer to "what happens when it is omitted" is the same for all eight, and it is deliberate:**
omission is a TypeScript error at the Host composition root. `EditorHost` extends the complete
`EditorHostPorts` surface; `ResolvedEditorHost` is only a compatibility alias and
`resolveEditorHost()` is an identity function. Neither production Host can inherit the in-memory
store or supply a runtime fallback: each final-overrides it with one stable, explicitly identified
`BrowserProjectStore`.

The complete surface is production-composed. UI consumers keep the narrow `EditorHostBase` context,
while runtime consumers receive the Host through the owning session. Storage calls flow through the
session-owned coordinator, and the browser assets/resources supplied in C4 remain on the same Host
surface.

| Port role                                  | A Host must supply                                                                                                         | What happens when it is omitted        | Notes                                                                                                                                                                                                                                                                                                                                                                                           |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `store` (`ProjectStore`)                   | **Required.** Persistence, as an opaque payload plus a typed summary, plus its own `schemaVersion` and optional `migrate`. | Host construction does not type-check. | The store never sees a schema type. The session invokes migration once per store object; browser-store wrappers coalesce work by durable identity. An unsafe Host storage configuration is reported as generic unavailable before mutation; physical storage identities remain private (see [`BOUNDARIES.md` section 3](BOUNDARIES.md#physical-cleanup-is-authorized-by-mutation-granularity)). |
| `assets` (`AssetResolver`)                 | **Required.** Maps a logical, non-root-absolute asset path to a location this Host serves.                                 | Host construction does not type-check. | This is the role that removes the root-absolute assumption.                                                                                                                                                                                                                                                                                                                                     |
| `assetLoader` (`RuntimeAssetLoader`)       | **Required.** Bytes and JSON for a logical asset path.                                                                     | Host construction does not type-check. | JSON is parsed at the port so a static host answering `200 text/html` to an absent path fails where it is still attributable.                                                                                                                                                                                                                                                                   |
| `runtimeResources` (`RuntimeResourceHost`) | **Required.** Constructs workers, audio contexts and object URLs.                                                          | Host construction does not type-check. | The Host constructs; the editor never does. The worker URL the editor supplies is a **request the Host may rewrite** — this is what makes a same-origin-constrained Host implementable at all.                                                                                                                                                                                                  |
| `exporter` (`ExportProvider`)              | **Required to be present; permitted to report unsupported.**                                                               | Host construction does not type-check. | `{ status: "unsupported", reason }` is a conforming answer, not a stub — the same reasoning as an absent server endpoint: absence must be _declarable_ rather than discovered by a request that appears to succeed. Export semantics are S08's.                                                                                                                                                 |
| `diagnostics` (`DiagnosticsPort`)          | **Required.** Log records and session-scoped events.                                                                       | Host construction does not type-check. | `sessionId` is on the call, not the port, so one Host implementation serves every session and two sessions stay distinguishable in its output. Persistence diagnostics carry stable operation/scope/code fields without payload contents.                                                                                                                                                       |
| `ids` (`IdGenerator`)                      | **Required.** Fresh ids, per scope.                                                                                        | Host construction does not type-check. | Exists so a Host can supply _determinism_; that is what makes a headless or automation run reproducible.                                                                                                                                                                                                                                                                                        |
| `environment` (`EnvironmentCapabilities`)  | **Required.** Declares `{ mode: "detect" }` or `{ mode: "force", rasterizer: "none" }`.                                    | Host construction does not type-check. | The Host **declares**; it never asserts the capability report. The report — rasterizer, selected backend, live-preview count — is produced by the runtime and is not something a Host can fake.                                                                                                                                                                                                 |

`navigation` is listed among the port roles in the Target State's role table under the name
`NavigationHost`, but it is **not** a new port: `EditorHostNavigation` already was one, both Hosts
already implement it, and it is unchanged. Its handling is the existing rows above.

---

## What the parity run actually observed

The §3.3 scenario runs with **every non-first-party host blocked** at the browser (task 9.4), and
the run records every blocked URL.

**The Vite host made zero third-party requests.** Create → import image, video and two audio files
→ place clips on two visual and two audio tracks → drag → trim → split → snap → scrub → play → save
→ full reload → reopen completed with an empty blocked list and **zero console errors**.

**The Next host made exactly one, and it is not the editor's.** `apps/web`'s root layout loads the
Databuddy analytics script from `https://cdn.databuddy.cc/databuddy.js` (`app/layout.tsx`). Blocked,
it produced two `net::ERR_FAILED` console entries and changed nothing else: all ten interactions
still asserted. The Vite example's root deliberately mirrors what the Next layout provides _minus_
`next/font` and the analytics scripts, which is why it requests nothing.

So the editing path itself does not reach for a third party in either host — the single third-party
request belongs to the product shell. The rows above matter for features _outside_ that path —
sounds, brand artwork, Google-hosted font faces, transcription — not for editing.
