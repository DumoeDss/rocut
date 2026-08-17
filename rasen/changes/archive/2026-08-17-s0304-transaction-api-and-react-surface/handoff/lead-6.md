# Handoff: s0304-transaction-api-and-react-surface — LEAD #6

## Original intent

User asked to continue the rocut `auto-decompose` portfolio (same mandate as lead-4/5: Claude Opus, no Codex, one worktree, serialize mutators, local-only ship). After lead-5 captured the R2 Vite-matrix-green state, the session pivoted to **strategic planning**: what comes after the current rocut slice, whether S05 and S06 can parallelize, and what the Elftia platform prerequisites for S06 actually are. This document records findings that are NOT on disk anywhere else.

## Position

Pipeline: `small-feature` portfolio. The rocut code state is **unchanged from lead-5** — R2 apply is at Vite-matrix-green, Next matrix not yet run. Read **lead-5 first** for the full R2 gate state and the 5 product defects fixed this session. This document covers only what changed since.

## Done / Remaining

**Done since lead-5 (code):** minor evidence-quality refinements only:
- `surface-react-identity-probe.tsx`: added docblock explaining it deliberately carries no `consoleErrors` field (an in-page probe cannot observe React's invalid-hook/#321 logging; that coverage lives in the Playwright `page.on("console")` / `page.on("pageerror")` run-wide capture).
- `surface-r2-evidence.ts`: removed the vacuous `consoleErrors: []` assertion on the in-page probe result, matching the above.
- `surface-drag-coordinator.tsx`: added docblock on `inspect()` explaining the listener-count oracle mirrors `addListeners` and is pinned by the focused coordinator test.

**Done since lead-5 (strategic — the new content):** full post-rocut roadmap analysis, recorded below in Key decisions.

**Remaining (rocut, unchanged from lead-5):**
1. Run Next Host Surface matrix (rebuild Next from current source with fresh marker, then `PARITY_HOST=next` Playwright).
2. Full dual-Host parity (`PARITY_SPEC=parity`, both hosts) + snapshot diff against **28/19/9**.
3. Post-browser hash equality + artifact manifest.
4. Implementation report + 17-spec falsification + strict validation.
5. R2 review-loop → local ship → archive → T4 → parent delivery.

## Key decisions (and why)

These are **strategic findings from this session's analysis**, not code changes. A successor continuing rocut work does not need them; a successor planning post-rocut work does.

### 1. Full rocut roadmap: 9 milestones, 3 done-ish

```
S01 Vite baseline      ✅ passed 2026-07-30
S02 Session+Host ports ✅ passed 2026-08-09
S03+S04 (current)      🔄 ~80% (7/9 children archived, R2 nearly done, T4 pending)
S05 Community beta     ⬜ not activated — depends on S03+S04 only
S06 Elftia data plane  ⬜ not activated — depends on S03 + Elftia foundation (see below)
S07 Elftia dogfood     ⬜ depends on S04 + S06
S08 Export/hardening   ⬜ depends on S05 + S07
S09 Provider evolution ⬜ depends on S08
```

### 2. S05 and S06 CAN parallelize, but the real parallel is S05 ∥ Elftia-foundation

- **S05** (community beta + second Host) depends only on the rocut SDK (S03+S04). Can start immediately after the current slice.
- **S06** (Elftia Artifact data plane) depends on S03 **AND** the Elftia-side Artifact/Capability foundation, which **does not exist** (see below).
- The correct parallel window after the current slice: **S05 (rocut) ∥ Elftia Phase 1+2 foundation (elftia)**, not S05 ∥ S06.
- S05∥S06 direct parallelism has one shared-interface risk: the conformance suite (S05 publishes it, S06 must pass it) — the S02 C0b∥C1 "opposite ends of one interface" pattern. Mitigation: freeze the conformance contract as a freeze-child before both run.

### 3. The Elftia platform foundation does NOT exist

Verified by search:
- `adapter-elftia` package: does not exist anywhere.
- `ArtifactRef` / `ArtifactStorage` / `CapabilityBroker` / `ArtifactRuntime` types: zero hits in elftia source (`packages/shared/src`, `packages/`).
- elftia rasen workstreams: only `opencut-agent-editor-sdk` (the rocut SDK work). No platform-composition workstream.
- The existing `PluginCapabilityRegistry` is a **security token mint** (§8.1 of the design doc explicitly distinguishes it from the new behavioral CapabilityBroker).

### 4. The design doc exists but is unreviewed

`docs/design/artifact-surface-composition-and-timeline-foundation-design.md` (2026-07-30, 41 sections, status **"Proposed, 待评审"**):
- **18 confirmed decisions (D1–D18):** Core-protocol-not-domain-implementation, capability-not-plugin-ID dependency, ArtifactRef stable reference, Canvas stores ArtifactRef, stateful-Artifact single Provider, shared transaction seam, 120k ticks, React 18 (not iframe/isolated-root), Artifact Storage as sole SSOT, etc.
- **19 open questions (§36):** most are Timeline-specific (Caption track, Transitions, FFmpeg packaging, magnetic storyline) and do NOT block Phase 1/2. The one that directly affects CapabilityBroker: **#3 permission enforcement alignment**.
- **Written before S03 contract froze** — needs S03's actual frozen output (12 operation kinds, MediaTime, ProjectStore shape) backfilled. At least one open question (#13 React 19 vs 18) is already answered by rocut decision A2 (shared React 18).

### 5. CapabilityBroker + ArtifactRuntime is a PLATFORM investment, not rocut plumbing

The design doc §1 states: "Elftia 应内置的不是 Timeline、Spreadsheet、3D Scene 等具体编辑器，而是让这些能力能够被安装、发现、组合、持久引用和安全调用的通用协议。" rocut is the first consumer/catalyst. The protocol is domain-agnostic: §29's composition examples include Podcast Agent, Subtitle Plugin, GPU Exporter, Beat Analyzer — none are video-editor features. Phase 1+2 work scale is comparable to S02 (cross-process contract freeze + registration/discovery/lifecycle + conformance) but shares **zero code** with S02 — different layer (editor-internal DI vs platform-level plugin composition).

### 6. Concrete path to start Elftia platform work

Two blockers, both small:
1. **Design review:** push the doc from "Proposed" to "Accepted" via office-hours/design-review. Core is settled (18 decisions); review focuses on protocol soundness + open question #3 + S03 backfill.
2. **Open question #3:** decide how CapabilityBroker `requires` interacts with existing plugin permission enforcement.

Phase 0 prerequisites mostly done: app-extension naming ✅, OpenCut pin/SBOM ✅ (rocut S01), 120k ticks ✅ (rocut S03), packaged Electron spike ⚠️ partial (E1). Remaining: Host API version strategy confirmation, permission gate confirmation.

Then: new rasen workstream in elftia repo (e.g. `elftia-composition-platform`), first Slice = Phase 1 CapabilityBroker (contract freeze → manifest parser → broker impl → Main/Renderer/ext-host transport → conformance → lease/hot-disable).

## Dead ends & gotchas

none new (see lead-5 for the session's code-level dead ends).

## Eliminated hypotheses

- "S06 can start right after S03" — ruled out: S06 also depends on the Elftia Artifact/Capability foundation, which has zero implementation.
- "The design doc is ready to project" — ruled out: it's "Proposed, 待评审," written before S03 froze, with one permission question (#3) that directly shapes CapabilityBroker.
- "CapabilityBroker/ArtifactRuntime is rocut-specific plumbing" — ruled out: it's a domain-agnostic platform protocol; rocut is the first consumer.

## Working set

**rocut (unchanged from lead-5):** all R2 source dirty in worktree, Vite matrix green at marker `r2-final-source-20260812-s`, pre-browser hash receipt `c168a38a…` (61 paths). No commits, no push.

**Strategic references:**
- Elftia design doc: `elftia/docs/design/artifact-surface-composition-and-timeline-foundation-design.md`
- rocut roadmap: `elftia/rasen/work/opencut-agent-editor-sdk/roadmap.md` (§2 dependency map, §5 S05/S06 details, §6 S07-S09)
- rocut work.yaml: `elftia/rasen/work/opencut-agent-editor-sdk/work.yaml` (activeSlice = 03-transaction-api-and-react-surface)

## Next action

**If continuing rocut:** read lead-5 first, then run the Next Host Surface matrix (rebuild Next from current source, `PARITY_HOST=next` Playwright). That is the single next step to unblock R2 closure.

**If pivoting to Elftia platform planning:** the user was considering starting the Elftia foundation work in parallel. The immediate next step would be scanning the design doc's 19 open questions to produce a review-readiness checklist (which block Phase 1/2 vs which are Timeline-deferrable vs already answered by rocut decisions). The user has not yet decided whether to start that now or finish rocut first.
