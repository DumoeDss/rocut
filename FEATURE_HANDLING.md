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

| Feature | Depends on | Handling | What the user sees |
| --- | --- | --- | --- |
| **Sounds panel** (Freesound search and top sounds) | `GET /api/sounds/search` — a server-side proxy holding the Freesound credentials | **Degraded.** Both fetch paths read `services.soundSearchEndpoint` from the host and skip entirely when it is unset (patches P-011, P-012). | An explicit unavailable state in the panel body. Design D9 assumed an existing error display could be reused; there was none — the store's `error` field was written but read by no component — so an explicit render was added. |
| **Feedback** | `POST /api/feedback` | **Excluded**, belt and braces. `EditorHeader` renders `FeedbackPopover` only when `services.feedbackEndpoint` is set (P-007), and the popover itself no-ops without one (P-013). | No feedback control in the header at all. Nothing to click and no error to misread. |
| **Stickers — flags** | *(nothing remote)* | **Works.** `flagsProvider.resolveUrl` builds a first-party `/flags/<code>.svg` path, and all 271 flag SVGs are copied by the asset allowlist. | Fully functional offline. Planning expected a remote icon API here; at this pin there is none. |
| **Stickers — shapes** | *(nothing remote)* | **Works.** `shapesProvider` generates its SVG presets in code; nothing is fetched, and `public/shapes/` is deliberately not copied because nothing requests it. | Fully functional offline. |
| **Stickers — logos** | *(nothing remote at this pin)* | **Empty by upstream design.** `logosProvider.search()` and `.browse()` both return empty results at `cf5e79e9`; the provider is registered but has no catalogue. | An empty logos section. This is upstream behaviour, not a portability loss — worth knowing before it is mistaken for one. |
| **Platform guide artwork** | `https://cdn.brandfetch.io/` | **Degraded, remote.** The guide definitions point at a third-party CDN. `HostImage` forwards `onError`, so a failed load surfaces the call site's own fallback rather than a broken-image box. | Guide entries render; their brand artwork does not load first-party-only. Never requested during the parity scenario. |
| **Font faces** | `https://fonts.googleapis.com/css2` | **Split.** The font *catalogue* is first-party: `/fonts/font-atlas.json` plus 15 `/fonts/font-chunk-*.avif` sprite chunks (2.4 MB) are copied and were served on every run. Only loading an actual Google-hosted font face is remote. | Font pickers and previews work offline from the atlas. Selecting a Google font for real text rendering needs the network. |
| **Transcription** (subtitles) | Hugging Face model download, via `@huggingface/transformers` in a Worker | **Degraded, remote, and on demand.** The Worker is constructed only when transcription is used. Its 21.6 MB `ort-wasm-simd-threaded.jsep.wasm` is emitted into `dist/` but is **not on the initial load path** — verified three ways in `BOUNDARIES.md` §4. | The panel is present; starting a transcription without network access fails at the model download. Never triggered in the parity scenario. |

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
still asserted. The Vite example's root deliberately mirrors what the Next layout provides *minus*
`next/font` and the analytics scripts, which is why it requests nothing.

So the editing path itself does not reach for a third party in either host — the single third-party
request belongs to the product shell. The rows above matter for features *outside* that path —
sounds, brand artwork, Google-hosted font faces, transcription — not for editing.
