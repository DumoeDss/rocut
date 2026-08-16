# Export legal review — codecs, patents, third-party assets (2026-08)

## 0. Scope, disclaimer, and how to read this

For the S08 acceptance owner deciding how production export gets distributed.
**Not legal advice** — items only counsel can close are marked "uncertain,
needs counsel"; even the FSF's FAQ says its publications are not legal advice
(https://www.gnu.org/licenses/gpl-faq.en.html). Every substantive conclusion
carries a source; secondary analysis is marked; where sources conflict, both
are presented. §4 enumerates S08's decisions. Ground reviewed: the adapter
as shipped (design D3) *discovers* FFmpeg (`OPENCUT_FFMPEG_PATH` →
configured location → `PATH`), bundles nothing (no binary ⇒ `canExport`
false); the reference binary is a gyan.dev "full" static build (GPLv3); the
untouched donor path encodes in-renderer via mediabunny/WebCodecs
(`scene-exporter.ts`: `vp9`/webm, `avc`/mp4, `aac`/`opus`).

## 1. FFmpeg licensing families

### 1.1 Three cumulative tiers

1. **Default: LGPL-2.1-or-later** (https://www.ffmpeg.org/legal.html,
   https://github.com/FFmpeg/FFmpeg/blob/master/LICENSE.md).
2. **`--enable-gpl` ⇒ GPL v2+** applies to all of FFmpeg
   (https://www.ffmpeg.org/legal.html). `libx264`/`libx265` — the
   H.264/HEVC encoders — are GPL-only, absent from LGPL builds
   (https://github.com/BtbN/FFmpeg-Builds).
3. **`--enable-nonfree` (e.g. `libfdk-aac`) ⇒ the binary is
   "unredistributable"** (FFmpeg LICENSE.md,
   https://github.com/FFmpeg/FFmpeg/blob/master/LICENSE.md). No
   distribution strategy can use this tier.

### 1.2 The two common Windows build families

- **gyan.dev**: "All builds are 64-bit, static and licensed as GPLv3; the
  release full variant is also available as a shared build"; a separate
  LGPLv3 `tools` package exists (https://www.gyan.dev/ffmpeg/builds/).
- **BtbN**: `lgpl` builds are "lacking libraries that are GPL-only. Most
  prominently libx264 and libx265"; `gpl` adds them; `-shared` variants ship
  `libav*` as DLLs (https://github.com/BtbN/FFmpeg-Builds).

Consequence: **every full-featured static build — anything that can encode
H.264 with x264 — is GPL.** An LGPL build can still mux mp4/webm with
non-GPL codecs (VP9/Opus via libvpx, mpeg4), just not the x264 path.

### 1.3 What bundling each tier forces on a closed-source host

- **LGPL, dynamic (DLLs)** — mildest: convey library source or written
  offer, permit reverse engineering for the library, mark modifications
  (https://www.ffmpeg.org/legal.html).
- **Static GPL build in the app package** — "Linking a GPL covered work
  statically or dynamically with other modules is making a combined work ...
  the terms and conditions of the GNU General Public License cover the whole
  combination" (https://www.gnu.org/licenses/gpl-faq.en.html). Either the
  host opens its source, or co-distribution survives only via §1.4.
- **Nonfree** — no path (§1.1).

### 1.4 Subprocess isolation: supported, with a named limit

The adapter's shape — spawn the discovered binary once at finalize, feed raw
frames + WAV via files, read `-progress pipe:1` — is what the GPL FAQ
addresses: "a main program that uses simple fork and exec to invoke plug-ins
and does not establish intimate communication between them results in the
plug-ins being a separate program"; "pipes, sockets and command-line
arguments" are communications "normally used between two separate programs",
though intimate communication "exchanging complex internal data structures"
could make them combined; co-distribution requires "communicate at arms
length" (https://www.gnu.org/licenses/gpl-faq.en.html).

Assessment (secondary): argv + files + a one-way progress pipe exchange no
FFmpeg-internal data structures, so the separate-programs reading is well
supported **for a binary the user installed themselves**; whether
co-distributing a GPL static binary in the same installer survives the
aggregate test is where the FAQ defers to facts — uncertain, needs counsel.
Clean either way: **exported videos are not GPL-covered** — "the output of
a program is not, in general, covered by the copyright on the code of the
program ... whether you pipe it into a file, make a screenshot, screencast,
or video" (same page).

### 1.5 The discover-binary / download-on-first-use precedents

- **Audacity** states the reason outright: **"Due to patent restrictions,
  FFmpeg cannot be distributed with Audacity itself."**
  (https://support.audacityteam.org/basics/installing-ffmpeg). Users obtain
  a build separately (WinGet/Homebrew/distro packages; BtbN and gyan.dev
  listed), accept the FFmpeg license during install, and the app
  *discovers* the binary. Contrast on the same page: LAME **is** bundled —
  its patents differ; the splitting line is patents, not convenience.
- **Cisco OpenH264** is the bundle-anyway model: Cisco bears the MPEG LA
  cost so binaries are usable at no charge (https://github.com/cisco/openh264);
  Firefox downloads the module on first use rather than shipping in-tree.

The shipped adapter (discover, never bundle) matches Audacity's posture with
none of the exposure: nothing GPL or patent-encumbered leaves this repo.

## 2. Codec patent surfaces

Copyright and patents are independent: an LGPL-clean build still encodes
H.264/AAC. FFmpeg's own page: "anyone claiming a definite no is lying"
(https://www.ffmpeg.org/legal.html).

### 2.1 H.264/AVC — the mp4 default of both export paths

Via LA AVC pool, patent list current 2026-08-01
(https://www.via-la.com/licensing-programs/avc-h-264/):

- **Products/encoders:** first 100k units $0, then $0.20/$0.10 per-unit
  tiers, enterprise annual cap $9.75M — a shipped software encoder is a
  licensable unit under this schedule.
- **Content:** titles ≤ 12 minutes $0; longer titles per-title fees.
- **Internet delivery:** tiered annual fees by service class (OTT $4.5M /
  FAST $3.375M / social $2.25M / cloud gaming $100K) — not a $0 category.
- **Negative finding:** the 2010 MPEG LA moratorium for free-to-end-user
  internet video (secondary:
  https://www.wired.com/2010/08/mpeg-la-extends-web-video-licensing-moratorium-until-the-end-of-time/)
  is **not stated on the current Via LA page** (checked 2026-08). It covered
  content distribution, never encoder products. Relying on it for a 2026
  product — uncertain, needs counsel.

### 2.2 HEVC — not in the export set; recorded for completeness

Via LA: "as of December 15, 2025, Access Advance has acquired this HEVC/VVC
program" (https://www.via-la.com/licensing-programs/hevc-vvc/). The successor
VCL Advance prices 100k units free, then $0.30 (Region 1) / $0.20 (Region 2),
$30M annual cap; Access Advance separately administers the original HEVC
Advance pool, so HEVC is multi-pool by construction
(https://www.accessadvance.com/). Neither export path uses it today.

### 2.3 AAC — the mp4 audio default

Via LA AAC pool (https://www.via-la.com/licensing-programs/aac/): $0.98/unit
(1–500k) declining to $0.10 (75M+); >2 channels = 1.5 units; $15K initial
fee (reduced for small entities); 5-year term. Load-bearing quotes: "no
patent license fees due for the distribution of bit-streams encoded in AAC"
— encoding *products* pay, the produced audio does not; and **no
free-software exemption**: "Manufacturers of Android-based products must
obtain their own AAC patent licenses."

### 2.4 VP9 + Opus — the webm defaults

- **VP9:** Google grants a "perpetual, worldwide, non-exclusive, no-charge,
  royalty-free, irrevocable (except as stated)" patent license to implement
  WebM, terminating only defensively
  (https://www.webmproject.org/license/additional/,
  https://www.webmproject.org/about/faq/) — but it covers **Google's
  patents**. A third-party pool asserts otherwise: Sisvel's VP9 pool lists
  per-product rates (€0.24/display-device standard, lower tiers; content
  distribution royalty-free;
  https://www.sisvel.com/licensing-programmes/audio-and-video-coding-decoding/video-coding-platform/).
  The positions conflict and the Sisvel pool is untested in court
  (secondary) — whether a shipping product needs that license is uncertain,
  needs counsel.
- **Opus:** "totally open, royalty-free" (https://opus-codec.org/, IETF RFC
  6716); no pool currently asserts against it.
- **AV1 (not in the export set):** Sisvel pools AV1 at €0.32/€0.11 standard
  rates (https://www.sisvel.com/licensing-programmes/audio-and-video-coding-decoding/video-coding-platform-av1/);
  if S08 adds AV1, re-run this subsection.

### 2.5 The mediabunny/WebCodecs path: different posture, same question

The donor path encodes with the browser's own codecs (WebCodecs →
Chromium's bundled encoders). Electron ships those codecs and enumerates
their third-party licenses
(`node_modules/electron/dist/LICENSES.chromium.html`), but
Chromium-in-your-product does **not** re-license Google's Chrome patent
deals to your product — "the user's browser already licensed H.264" does
not transfer, because Chrome's proprietary-codec coverage attaches to
Chrome's distribution, not the code (secondary analysis; Electron
discussion:
https://github.com/electron/libchromiumcontent/issues/174). **Posture, not
precedent:** free desktop tools shipping Chromium encoders are ubiquitous
without visible pool enforcement, but a **paid product whose advertised
purpose is producing H.264 videos** is a materially different fact pattern
the public sources do not settle — uncertain, needs counsel. The browser
path cleanly avoids all of §1 though: no FFmpeg, no GPL surface.

## 3. Third-party assets in produced videos

Rule: **rendering an asset into an exported frame is a use; shipping the
asset file is a redistribution.** A video embeds a copy of the artwork (flag
SVG, sticker graphic), so asset-license terms travel into the export even
though the asset file never ships inside the video.

### 3.1 Fonts

Repo reality: Google Fonts CSS loads at runtime from `fonts.googleapis.com`
(`packages/editor-classic/src/fonts/google-fonts.ts`); the web app also
bundles an atlas (`apps/web/public/fonts/font-atlas.json` + 15 `.avif`
chunks).

- The collection is "licensed with permission to redistribute, subject to
  the license terms" — most fonts SIL OFL v1.1, some Apache 2.0, Ubuntu
  fonts UFL v1.0 (https://github.com/google/fonts/blob/main/README.md);
  bundling the atlas is permitted if per-family terms are met.
- OFL is explicit that **video titling is ordinary use**: fonts may be used
  for "any kind of design work ... video titling" with "no additional
  license or permission ... required", and "creating any kind of graphic
  using a font under the OFL does not make the resulting artwork subject to
  the OFL" (https://openfontlicense.org/ofl-faq/, FAQ 1.1–1.2). **Rendered
  text in exported videos carries no OFL obligation.**
- Live caveat: Reserved Font Names (used by "some of the fonts",
  google/fonts README) bite only modified fonts — the editor modifies none.

### 3.2 Stickers

- **Flags** — 271 bundled SVGs whose `flag-icons-*` ids identify them as
  lipis/flag-icons, MIT, "Copyright (c) 2013 Panayiotis Lipiridis"
  (https://github.com/lipis/flag-icons). MIT permits embedding copies into
  videos and bundling the files; no on-screen credit is required, but keep
  the license with redistributed SVGs.
- **Shapes** — first-party vector presets from the graphics registry
  (`packages/editor-classic/src/stickers/providers/shapes.ts`); no
  third-party art, no obligation.
- **Logos** — empty stub today
  (`packages/editor-classic/src/stickers/providers/logos.ts`); if it ever
  returns brand logos, **trademark** (not copyright) becomes the live
  question and the provider needs its own review before ship.

### 3.3 Audio (freesound)

Repo reality: sound search proxies the freesound API
(`apps/web/src/app/api/sounds/search/route.ts`); no audio ships in the app.

- freesound content is CC0 / CC-BY / CC-BY-NC
  (https://freesound.org/help/faq/): CC0 — "you can do pretty much what you
  want"; CC-BY — "you should always mention the original creators of the
  sounds when you use them", i.e. **attribution is owed in the produced
  video** in their stated form ("sound1" by user (url) licensed under
  CCBY...); CC-BY-NC — "you can't earn any money with the piece of work you
  create".
- **Repo bug found:** the route's `commercial_only` allowlist includes
  `"Attribution Noncommercial"` — NC-licensed sounds leak into results the
  UI presents as commercial. Fix before any commercial export feature;
  independently, CC-BY needs an attribution path.
- Same FAQ: raw freesound sounds can trigger YouTube Content ID claims
  (disputable) — worth one line in export docs.

### 3.4 The frame-content rule for S08

Obligations follow the asset's license into the exported file: OFL text →
nothing; MIT flags → nothing on-screen, license ships with the app; CC-BY
sound → credit owed; CC-BY-NC sound → commercial use barred. Surfacing this
in the export UI (per-sound license badge, generated credits text) is an S08
product decision.

## 4. Decisions for S08

1. **FFmpeg distribution posture.** (a) Keep discover-only — ships nothing,
   matches the Audacity precedent whose stated reason is patent restrictions
   (https://support.audacityteam.org/basics/installing-ffmpeg); (b) bundle
   an LGPL **shared** build — convey libav* sources, lose x264
   (https://www.ffmpeg.org/legal.html); (c) co-distribute a GPL build and
   either open-source the host or obtain counsel's aggregate/arm's-length
   sign-off (https://www.gnu.org/licenses/gpl-faq.en.html); (d) wasm form —
   LGPL family, no H.264 encoder. Constraints: x264 builds are GPL
   (https://github.com/BtbN/FFmpeg-Builds); nonfree cannot ship.
2. **Codec set.** Keep `{mp4: H.264+AAC, webm: VP9+Opus}` and accept §2
   product-royalty surfaces, or default webm (VP9+Opus — RF per Google,
   Sisvel disputed) and demote mp4. Constraints: AAC has no bitstream fee
   but no FOSS exemption (§2.3); the AVC page has no free-internet-video
   carve-out (§2.1).
3. **Browser-native path's role.** It sidesteps §1 entirely; its §2.5
   posture (paid product promoting AVC encoding) is what counsel must size
   before it becomes the default for commercial builds.
4. **freesound hygiene.** Fix the NC leak in `commercial_only`; add CC-BY
   attribution plumbing for produced videos
   (https://freesound.org/help/faq/). Product-level; blocks nothing here.
5. **Asset provenance record.** Maintain the per-family font license + RFN
   list (https://github.com/google/fonts/blob/main/README.md), a flag-icons
   MIT entry in third-party notices (https://github.com/lipis/flag-icons),
   and the rule that the logos provider requires review before returning
   anything.
6. **Counsel checkpoint.** The four "uncertain, needs counsel" items (GPL
   aggregate co-distribution; AVC/AAC encoder royalties; Sisvel-vs-Google
   on VP9; Chromium posture for a paid product) go to counsel **before
   first commercial distribution** — not before first code. The
   discover-only design needs none of them answered to ship.

---

*Sources inline. Repo paths reference this worktree's tree as of 2026-08-16.*
