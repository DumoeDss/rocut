# Reference sources

This file records every external project consulted while building this repository and the legal
boundary that applies to each. It is enforced mechanically by
[`script/check-reference-boundary.mjs`](script/check-reference-boundary.mjs).

## Source donor — code may be used

| Project | Pin | License | Role |
| --- | --- | --- | --- |
| [OpenCut Classic](https://github.com/OpenCut-app/opencut-classic) | `cf5e79e919144200294fb9fed22a222592a0aeea` | MIT | The code in this repository. See [`UPSTREAM.md`](UPSTREAM.md). |

MIT permits use, modification and redistribution with attribution. The upstream `LICENSE` is
retained byte-identical at the repository root and its copyright line
(`Copyright 2025-2026 OpenCut`) is unmodified.

## Design reference only — code may NOT be used

| Project | Pin | License | Role |
| --- | --- | --- | --- |
| OpenChatCut (`0xsline/OpenChatCut`) | `85ee5dfaf5e78d880a8900bfc7048ab62d77405a` | **AGPL-3.0** | Clean-room **design** reference only. |

### The no-copy boundary

OpenChatCut is licensed under the AGPL. Its copyleft terms would propagate to any work that
incorporates it. This project therefore treats it as a **clean-room design reference**: it may
inform *what* to build, never *how* the code is written.

**Nothing derived from OpenChatCut may enter the distributable graph.** Specifically, none of the
following may be copied, transcribed, adapted, translated, or reconstructed from it:

- source code, in any language, whether copied verbatim or retyped;
- tests, fixtures or test data;
- prompts, instructions or agent configuration;
- stylesheets, design tokens, or component styling;
- assets — images, icons, fonts, audio, video;
- any Remotion-based rendering implementation or an implementation derived from one.

A sibling checkout exists on the original author's machine at `_others/OpenChatCut`. **It must never
be read for implementation purposes and never copied from.** Its presence on disk is not a licence
to use it.

Permissible use is limited to observing externally visible product behaviour and design decisions —
the kind of information a person could obtain by using the published application — and independently
implementing anything so learned.

### Mechanical enforcement

`script/check-reference-boundary.mjs` runs over every tracked file and fails on:

| Rule | Assertion |
| --- | --- |
| `no-openchatcut-reference` | No path or identifier referencing an OpenChatCut checkout appears in any text file. |
| `no-remotion-dependency` | No `remotion` package appears in `bun.lock` or any `package.json`. |
| `no-agpl-header` | No source file carries an AGPL / Affero licence header. |

The provenance documents themselves (this file, `UPSTREAM.md`, `PATCHES.md`, `SBOM.md`, the source
inventory, and the check script) are excluded from the first rule — naming the reference source is
their purpose. The `remotion` and AGPL-header rules still apply to them. Change artifacts under
`rasen/` are review material rather than distributable code and are excluded from the scan.

Run it with:

```
node script/check-reference-boundary.mjs
```

Result at the time of writing: **clean** — 773 of 1,128 tracked files scanned, all three rules pass.
